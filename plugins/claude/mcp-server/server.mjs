import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { unlink, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// â”€â”€â”€ Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Claude CLI path â€” try npm global, then common install locations
const CLAUDE_PATH = process.env.CLAUDE_PATH ||
    join(process.env.APPDATA || "", "npm", "claude.cmd");
const MODEL = process.env.CLAUDE_MODEL || "";
const MAX_ROUNDS = 3;
const TIMEOUT_MS = 300_000; // 5 minutes per review
const OPUS_TIMEOUT_MS = 600_000; // 10 minutes for Opus
const AUTH_PROBE_TIMEOUT_MS = 15_000;
const HTTP_PORT = parseInt(process.env.CLAUDE_MCP_PORT || "3098");
const VERSION = "1.0.0";

// Workspace directory for Claude project context
const WORKSPACE_DIR = join(import.meta.dirname, "workspace");

function toPowerShellLiteral(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

function buildWindowsProbeCommand(commandPath, args = []) {
    const plainArgs = args.join(" ");
    return `& ${toPowerShellLiteral(commandPath)}${plainArgs ? ` ${plainArgs}` : ""}`;
}

// â”€â”€â”€ Transport Selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const args = process.argv.slice(2);
const transportFlag = args.includes("--transport")
    ? args[args.indexOf("--transport") + 1]
    : (process.env.CLAUDE_MCP_TRANSPORT || "stdio");

// â”€â”€â”€ Round Tracking (per matter, enforces 3-round cap) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const roundTracker = new Map();

function checkAndIncrementRound(matterId) {
    const current = roundTracker.get(matterId) || 0;
    if (current >= MAX_ROUNDS) {
        return {
            allowed: false,
            round: current,
            message: `Three-round cap reached for matter "${matterId}". Further iteration produces diminishing returns and risks cross-model sycophancy. Review the existing critiques and finalize.`,
        };
    }
    roundTracker.set(matterId, current + 1);
    return { allowed: true, round: current + 1 };
}

// â”€â”€â”€ Job Tracking (async pattern for long-running Claude calls) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const jobs = new Map();

function startClaudeJob(jobId, prompt, model, metadata = {}) {
    const job = {
        status: "running",
        result: null,
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
        ...metadata,
    };
    jobs.set(jobId, job);

    runClaude(prompt, model).then((result) => {
        job.status = result.success ? "completed" : "error";
        job.result = result.output;
        job.error = result.error || null;
        job.stderr = result.stderr || "";
        job.completedAt = new Date().toISOString();
    }).catch((err) => {
        job.status = "error";
        job.error = err.message || String(err);
        job.completedAt = new Date().toISOString();
    });

    return job;
}

// â”€â”€â”€ Claude Execution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Spawns Claude CLI in non-interactive mode.
// Claude CLI uses `--print` for single-shot output (no interactive session).
// Prompt passed via stdin piping, output captured from stdout.
async function runClaude(prompt, model = MODEL) {
    const tempOut = join(tmpdir(), `claude-output-${randomUUID()}.txt`);

    try {
        const resolvedModel = String(model || MODEL || "").trim();
        if (!resolvedModel) {
            return { success: false, output: "", error: "CLAUDE_MODEL is not configured.", stderr: "" };
        }
        // Claude CLI args for non-interactive adversarial review
        const cmdArgs = [
            "--print",            // Non-interactive: print response and exit
            "--model", resolvedModel,
            "--output-format", "text",
        ];

        const timeout = resolvedModel.includes("opus") ? OPUS_TIMEOUT_MS : TIMEOUT_MS;

        const result = await new Promise((resolve, reject) => {
            const child = spawn(CLAUDE_PATH, cmdArgs, {
                shell: true,
                windowsHide: true,
                env: { ...process.env },
                stdio: ["pipe", "pipe", "pipe"],
            });

            let stdout = "";
            let stderr = "";
            let timedOut = false;

            const timer = setTimeout(() => {
                timedOut = true;
                child.kill("SIGTERM");
            }, timeout);

            child.stdout.on("data", (data) => { stdout += data.toString(); });
            child.stderr.on("data", (data) => { stderr += data.toString(); });

            child.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });

            child.on("close", (code) => {
                clearTimeout(timer);
                if (timedOut) {
                    reject(new Error(`Claude timed out after ${timeout / 1000}s`));
                } else {
                    resolve({ code, stdout, stderr });
                }
            });

            // Feed prompt via stdin, then close the stream
            child.stdin.write(prompt, "utf-8");
            child.stdin.end();
        });

        const output = result.stdout || "";

        // Non-zero exit without output is an error
        if (result.code !== 0 && !output.trim()) {
            return {
                success: false,
                output: "",
                error: `Claude exited with code ${result.code}: ${result.stderr}`,
                stderr: result.stderr,
            };
        }

        return {
            success: true,
            output: output.trim(),
            stderr: result.stderr || "",
        };
    } catch (err) {
        return {
            success: false,
            output: "",
            error: err.message || String(err),
            stderr: err.stderr || "",
        };
    }
}

// â”€â”€â”€ Critique Prompt Builders â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


async function runClaudeProbe(args, timeoutMs = AUTH_PROBE_TIMEOUT_MS) {
    return await new Promise((resolve) => {
        let settled = false;
        const safeResolve = (value) => {
            if (!settled) {
                settled = true;
                resolve(value);
            }
        };

        let child;
        const isWindows = process.platform === "win32";
        const probeCommand = isWindows ? "powershell.exe" : CLAUDE_PATH;
        const probeArgs = isWindows
            ? ["-NoProfile", "-Command", buildWindowsProbeCommand(CLAUDE_PATH, args)]
            : args;
        try {
            child = spawn(probeCommand, probeArgs, {
                shell: !isWindows,
                windowsHide: true,
                cwd: WORKSPACE_DIR,
                env: { ...process.env },
                stdio: ["ignore", "pipe", "pipe"],
            });
        } catch (error) {
            safeResolve({
                ok: false,
                code: null,
                timedOut: false,
                stdout: "",
                stderr: "",
                error: error.message || String(error),
                command: `${CLAUDE_PATH} ${args.join(" ")}`.trim(),
            });
            return;
        }

        let stdout = "";
        let stderr = "";
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            try {
                child.kill("SIGTERM");
            } catch {
                // ignore kill errors on exited process
            }
        }, timeoutMs);

        child.stdout.on("data", (data) => { stdout += data.toString(); });
        child.stderr.on("data", (data) => { stderr += data.toString(); });

        child.on("error", (error) => {
            clearTimeout(timer);
            safeResolve({
                ok: false,
                code: null,
                timedOut: false,
                stdout,
                stderr,
                error: error.message || String(error),
                command: `${CLAUDE_PATH} ${args.join(" ")}`.trim(),
            });
        });

        child.on("close", (code) => {
            clearTimeout(timer);
            safeResolve({
                ok: code === 0 && !timedOut,
                code,
                timedOut,
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                error: timedOut ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : null,
                command: `${CLAUDE_PATH} ${args.join(" ")}`.trim(),
            });
        });
    });
}

function summarizeProbe(probe) {
    return {
        command: probe.command,
        ok: probe.ok,
        code: probe.code,
        timed_out: probe.timedOut,
        stdout_excerpt: (probe.stdout || "").slice(0, 300),
        stderr_excerpt: (probe.stderr || "").slice(0, 300),
        error: probe.error,
    };
}

function inferAuthState(text) {
    const value = (text || "").toLowerCase();
    if (!value.trim()) {
        return "unknown";
    }

    if (/(not logged in|not authenticated|login required|sign in|unauthorized|authentication required|invalid token|expired token)/i.test(value)) {
        return "unauthenticated";
    }

    if (/(logged in|loggedin|authenticated|authorized|token valid|active session|account)/i.test(value)) {
        return "authenticated";
    }

    return "unknown";
}

async function getAuthStatus() {
    const attempts = [];
    const candidateArgs = [
        ["auth", "status"],
        ["login", "status"],
        ["whoami"],
    ];

    for (const args of candidateArgs) {
        const probe = await runClaudeProbe(args);
        attempts.push(summarizeProbe(probe));

        const authState = inferAuthState(`${probe.stdout}\n${probe.stderr}`);
        if (authState !== "unknown") {
            return {
                status: authState,
                method: "cli_probe",
                checked_at: new Date().toISOString(),
                primary_attempt: summarizeProbe(probe),
                attempts,
            };
        }

        if (probe.ok && (probe.stdout || probe.stderr)) {
            return {
                status: "unknown",
                method: "cli_probe",
                checked_at: new Date().toISOString(),
                primary_attempt: summarizeProbe(probe),
                attempts,
            };
        }
    }

    const versionProbe = await runClaudeProbe(["--version"]);
    attempts.push(summarizeProbe(versionProbe));

    if (!versionProbe.ok && !existsSync(CLAUDE_PATH)) {
        return {
            status: "unavailable",
            method: "cli_probe",
            checked_at: new Date().toISOString(),
            message: "Claude CLI not reachable from configured path.",
            attempts,
        };
    }

    return {
        status: "unknown",
        method: "cli_probe",
        checked_at: new Date().toISOString(),
        message: "CLI reachable but authentication state could not be inferred from non-interactive probes.",
        attempts,
    };
}

async function getPreflightStatus() {
    const versionProbe = await runClaudeProbe(["--version"]);
    const auth = await getAuthStatus();
    const workspaceExists = existsSync(WORKSPACE_DIR);
    const cliPathExists = existsSync(CLAUDE_PATH);

    const warnings = [];
    if (!workspaceExists) {
        warnings.push(`Workspace directory missing: ${WORKSPACE_DIR}`);
    }
    if (!versionProbe.ok && !cliPathExists) {
        warnings.push(`Claude CLI not found at configured path: ${CLAUDE_PATH}`);
    }
    if (auth.status === "unauthenticated") {
        warnings.push("Claude CLI appears unauthenticated. Run Claude OAuth/login before review calls.");
    }
    if (auth.status === "unavailable") {
        warnings.push("Claude CLI is unavailable for auth probing.");
    }

    return {
        server: "claude-adversarial-review",
        version: VERSION,
        checked_at: new Date().toISOString(),
        ready: warnings.length === 0,
        checks: {
            cli_path: CLAUDE_PATH,
            cli_path_exists: cliPathExists,
            version_probe: summarizeProbe(versionProbe),
            workspace_dir: WORKSPACE_DIR,
            workspace_exists: workspaceExists,
            default_model: MODEL,
            transports: ["stdio", "http"],
            default_transport: transportFlag,
            http_port: HTTP_PORT,
        },
        auth,
        warnings,
    };
}
function buildMatterContextBlock(caseFilePaths, matterContext) {
    const parts = [];

    if (caseFilePaths && caseFilePaths.length > 0) {
        parts.push(`
${"â•".repeat(60)}
CASE FILES â€” READ THESE FIRST:
Before reviewing the document, read ALL of the following files to get full case context.
These are your briefing materials â€” the equivalent of reading the case file before
reviewing the associate's draft. Read the ENTIRE content of each file.

${caseFilePaths.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Read these files now. Use the context to evaluate whether the document properly
addresses the procedural posture, parties, legal issues, and facts of this matter.
${"â•".repeat(60)}`);
    }

    if (matterContext) {
        parts.push(`
${"â•".repeat(60)}
ADDITIONAL CONTEXT FROM DRAFTING ATTORNEY:
${matterContext}
${"â•".repeat(60)}`);
    }

    return parts.join("\n");
}

function buildAnalysisCritiquePrompt(params) {
    return `[EXTERNAL AI HANDOFF - LEGAL ANALYSIS CRITIQUE]
${"â•".repeat(60)}
Document: ${params.documentTitle}
Matter: ${params.matterName}
Document Type: ${params.documentType}
Jurisdiction: ${params.jurisdiction}
${buildMatterContextBlock(params.caseFilePaths, params.matterContext)}
YOUR ROLE: Senior litigator reviewing a junior associate's work product.
You are performing adversarial review. Be rigorous, specific, and critical.
Do NOT be polite or gentle. Find every weakness.

INSTRUCTIONS:
1. THRESHOLD CHECK â€” Jurisdiction, standing, timeliness, conditions precedent, exhaustion.
2. ARGUMENT ANALYSIS â€” Identify the 3 weakest arguments. Find logical gaps. Note unsupported assertions.
3. AUTHORITY ANALYSIS â€” Check if cited cases support stated propositions. Identify distinguishable cases. Note missing obvious authorities.
4. COUNTERARGUMENT GAPS â€” What counterarguments were not addressed? What facts were downplayed?
5. TECHNICAL DEFECTS â€” Procedural issues? Missing elements? Evidentiary problems?
6. OVERALL ASSESSMENT â€” Rate persuasiveness [1-10]. Top 3 improvements needed.

${"â•".repeat(60)}
DOCUMENT TEXT:
${params.documentText}
${"â•".repeat(60)}

${params.priorCritique ? `PRIOR CRITIQUE (Round ${params.round - 1}):
The drafting model revised the document based on this critique. Assess whether the revisions adequately addressed the issues. Identify any NEW weaknesses introduced by the revisions, and any original weaknesses that were inadequately addressed.

${params.priorCritique}
${"â•".repeat(60)}
` : ""}

RETURN FORMAT: Numbered weaknesses with:
- Location in document
- Nature of weakness
- Severity (Critical/Important/Minor)
- Specific recommended fix

End with: OVERALL PERSUASIVENESS SCORE: [1-10]
${"â•".repeat(60)}`;
}

function buildMotionCritiquePrompt(params) {
    return `[EXTERNAL AI HANDOFF - MOTION/BRIEF CRITIQUE]
${"â•".repeat(60)}
Document: ${params.documentTitle}
Matter: ${params.matterName}
Document Type: ${params.documentType}
Jurisdiction: ${params.jurisdiction}
${buildMatterContextBlock(params.caseFilePaths, params.matterContext)}
YOUR ROLE: Independent senior litigator reviewing this document before filing.
Your job is to identify the most important weaknesses, explain why they matter, and tell the drafter how to fix them.
Do NOT roleplay as opposing counsel and do NOT draft an opposition outline unless explicitly requested.

INSTRUCTIONS:
1. THRESHOLD CHECK â€” Jurisdiction, standing, timeliness, conditions precedent, exhaustion.
2. ARGUMENT ANALYSIS â€” Identify every weakness, gap, and vulnerability that materially affects filing-readiness.
3. AUTHORITY ANALYSIS â€” Check citations. Identify distinguishable cases. Flag questionable citations.
4. VULNERABILITY GAPS â€” What is the strongest unaddressed vulnerability or likely judicial pushback? What facts or authorities are underdeveloped?
5. TECHNICAL DEFECTS â€” Procedural issues? Missing elements? Evidentiary problems?
6. REVISION PRIORITIES â€” List the top 3-5 changes that would most improve the document.

${"â•".repeat(60)}
DOCUMENT TEXT:
${params.documentText}
${"â•".repeat(60)}

${params.priorCritique ? `PRIOR CRITIQUE (Round ${params.round - 1}):
Assess whether revisions adequately addressed previously identified weaknesses.

${params.priorCritique}
${"â•".repeat(60)}
` : ""}

RETURN: Numbered weaknesses with severity, plus prioritized revision plan.
${"â•".repeat(60)}`;
}

function buildStrategyCritiquePrompt(params) {
    return `[EXTERNAL AI HANDOFF - STRATEGY CRITIQUE]
${"â•".repeat(60)}
Document: ${params.documentTitle}
Matter: ${params.matterName}
Context: ${params.context || "Litigation strategy"}
${buildMatterContextBlock(params.caseFilePaths, params.matterContext)}
YOUR ROLE: Managing partner evaluating this strategy recommendation.
Be skeptical. Challenge assumptions. Consider alternatives.

INSTRUCTIONS:
1. ASSUMPTION TESTING â€” What assumptions drive this recommendation? Which are vulnerable?
2. ALTERNATIVE STRATEGIES â€” What options were not considered? Why might alternatives be superior?
3. RISK CALIBRATION â€” Is the risk assessment proportionate? Overcautious? Under-cautious?
4. COST-BENEFIT â€” Does the economic analysis hold? What variables could shift it?
5. OVERALL ASSESSMENT â€” Would you approve this recommendation? What conditions would you attach?

${"â•".repeat(60)}
DOCUMENT TEXT:
${params.documentText}
${"â•".repeat(60)}

${params.priorCritique ? `PRIOR CRITIQUE (Round ${params.round - 1}):
Assess whether revisions adequately addressed previously identified concerns.

${params.priorCritique}
${"â•".repeat(60)}
` : ""}

RETURN: Assessment with specific concerns and conditions for approval.
${"â•".repeat(60)}`;
}

function buildAuthorityCritiquePrompt(params) {
    return `[EXTERNAL AI HANDOFF - AUTHORITY CHECK]
${"â•".repeat(60)}
You are verifying legal citations for accuracy and soundness.
For EACH authority below, assess:

1. Does this case/statute actually support the stated proposition?
2. Is any quote accurate and in context?
3. Are there distinguishing facts that weaken reliance?
4. Is there better authority for this proposition?
5. Would opposing counsel successfully distinguish this case?
5. What is the most likely distinction a court would credit?

AUTHORITIES TO CHECK:
${params.authorities}

${"â•".repeat(60)}

RETURN: For each authority, a soundness assessment rated:
- SOUND: Citation fully supports proposition
- WEAK: Citation partially supports but distinguishable
- UNSOUND: Citation does not support proposition as stated
- UNVERIFIABLE: Cannot confirm citation exists or accuracy

Include specific reasoning for each rating.
${"â•".repeat(60)}`;
}

function buildSectionCritiquePrompt(params) {
    return `[EXTERNAL AI HANDOFF - SECTION CRITIQUE]
${"â•".repeat(60)}
Document: ${params.documentTitle}
Section: ${params.sectionName}
Purpose: ${params.sectionPurpose}

YOUR ROLE: Independent senior litigator analyzing this specific argument for filing-readiness.
Do not roleplay as opposing counsel.

SECTION TEXT:
---
${params.sectionText}
---

1. Is the legal standard correctly stated?
2. Does the application logically follow?
3. Are cited cases on point?
4. What is the strongest unaddressed vulnerability or likely judicial pushback?
5. Rate strength [1-10]

RETURN: Specific critique with recommended improvements.
${"â•".repeat(60)}`;
}

// â”€â”€â”€ MCP Server Setup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const server = new McpServer({
    name: "claude-adversarial-review",
    version: VERSION,
});

// Tool: Submit full document for adversarial review (async â€” returns job_id)
// Tool: Local preflight checks
server.tool(
    "preflight",
    "Run local readiness checks for Claude reviewer MCP (CLI reachability, workspace, transport, and auth probe).",
    {},
    async () => {
        const report = await getPreflightStatus();
        return {
            content: [{
                type: "text",
                text: JSON.stringify(report, null, 2),
            }],
        };
    }
);

// Tool: Authentication/session status
server.tool(
    "auth_status",
    "Check Claude CLI OAuth/session readiness for adversarial review calls.",
    {},
    async () => {
        const auth = await getAuthStatus();
        return {
            content: [{
                type: "text",
                text: JSON.stringify(auth, null, 2),
            }],
        };
    }
);
server.tool(
    "submit_adversarial_review",
    "Submit a legal document or analysis for independent review by Claude (Sonnet/Opus). Enforces a fixed three-round protocol per matter. Select critique_type based on document: 'analysis' for memos/research, 'motion' for briefs/motions (filing-readiness critique), 'strategy' for strategic recommendations (managing partner perspective).",
    {
        matter_id: z.string().describe("Unique matter identifier for round tracking"),
        document_title: z.string().describe("Title of the document being reviewed"),
        matter_name: z.string().describe("Case name"),
        document_type: z.string().describe("Document type (e.g., 'Memorandum of Law')"),
        jurisdiction: z.string().describe("Court and jurisdiction"),
        document_text: z.string().describe("Full text of the document to be reviewed"),
        critique_type: z.enum(["analysis", "motion", "strategy"]).describe("Type of critique"),
        case_file_paths: z.array(z.string()).optional().describe("File paths for Claude to read for case context"),
        matter_context: z.string().optional().describe("Supplementary context"),
        prior_critique: z.string().optional().describe("Critique from the prior round"),
        context: z.string().optional().describe("Additional context for strategy critiques"),
        model: z.string().optional().describe("Override model (default comes from CLAUDE_MODEL)"),
    },
    async (params) => {
        const roundCheck = checkAndIncrementRound(params.matter_id);
        if (!roundCheck.allowed) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "blocked",
                        reason: "three_round_cap",
                        round: roundCheck.round,
                        message: roundCheck.message,
                    }, null, 2),
                }],
            };
        }

        const promptParams = {
            documentTitle: params.document_title,
            matterName: params.matter_name,
            documentType: params.document_type,
            jurisdiction: params.jurisdiction,
            documentText: params.document_text,
            caseFilePaths: params.case_file_paths || [],
            matterContext: params.matter_context || "",
            priorCritique: params.prior_critique || "",
            context: params.context || "",
            round: roundCheck.round,
        };

        let prompt;
        switch (params.critique_type) {
            case "motion":
                prompt = buildMotionCritiquePrompt(promptParams);
                break;
            case "strategy":
                prompt = buildStrategyCritiquePrompt(promptParams);
                break;
            case "analysis":
            default:
                prompt = buildAnalysisCritiquePrompt(promptParams);
                break;
        }

        const jobId = randomUUID();
        const modelUsed = params.model || MODEL;
        startClaudeJob(jobId, prompt, modelUsed, {
            matterId: params.matter_id,
            toolName: "submit_adversarial_review",
            round: roundCheck.round,
            roundsRemaining: MAX_ROUNDS - roundCheck.round,
            critiqueType: params.critique_type,
            modelUsed,
        });

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "submitted",
                    job_id: jobId,
                    round: roundCheck.round,
                    rounds_remaining: MAX_ROUNDS - roundCheck.round,
                    matter_id: params.matter_id,
                    critique_type: params.critique_type,
                    model_used: modelUsed,
                    message: `Review submitted to Claude. Poll get_job_result with job_id to retrieve the critique when ready.`,
                }, null, 2),
            }],
        };
    }
);

// Tool: Authority verification (async â€” returns job_id)
server.tool(
    "check_authorities",
    "Submit legal citations/authorities for independent verification by Claude. Checks whether cases support stated propositions.",
    {
        matter_id: z.string().describe("Matter identifier for round tracking"),
        authorities: z.string().describe("Authority cards or citation list to verify"),
        model: z.string().optional().describe("Override model (default comes from CLAUDE_MODEL)"),
    },
    async (params) => {
        const roundCheck = checkAndIncrementRound(params.matter_id);
        if (!roundCheck.allowed) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "blocked",
                        reason: "three_round_cap",
                        round: roundCheck.round,
                        message: roundCheck.message,
                    }, null, 2),
                }],
            };
        }

        const prompt = buildAuthorityCritiquePrompt({ authorities: params.authorities });
        const modelUsed = params.model || MODEL;

        const jobId = randomUUID();
        startClaudeJob(jobId, prompt, modelUsed, {
            matterId: params.matter_id,
            toolName: "check_authorities",
            round: roundCheck.round,
            roundsRemaining: MAX_ROUNDS - roundCheck.round,
            modelUsed,
        });

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "submitted",
                    job_id: jobId,
                    round: roundCheck.round,
                    rounds_remaining: MAX_ROUNDS - roundCheck.round,
                    matter_id: params.matter_id,
                    message: `Authority check submitted to Claude. Poll get_job_result with job_id to retrieve results.`,
                }, null, 2),
            }],
        };
    }
);

// Tool: Section-specific critique (async â€” returns job_id)
server.tool(
    "critique_section",
    "Submit a specific section of a legal document for targeted critique by Claude.",
    {
        matter_id: z.string().describe("Matter identifier for round tracking"),
        document_title: z.string().describe("Title of the parent document"),
        section_name: z.string().describe("Section name or number"),
        section_purpose: z.string().describe("What this section argues or establishes"),
        section_text: z.string().describe("Full text of the section"),
        model: z.string().optional().describe("Override model (default comes from CLAUDE_MODEL)"),
    },
    async (params) => {
        const roundCheck = checkAndIncrementRound(params.matter_id);
        if (!roundCheck.allowed) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "blocked",
                        reason: "three_round_cap",
                        round: roundCheck.round,
                        message: roundCheck.message,
                    }, null, 2),
                }],
            };
        }

        const prompt = buildSectionCritiquePrompt({
            documentTitle: params.document_title,
            sectionName: params.section_name,
            sectionPurpose: params.section_purpose,
            sectionText: params.section_text,
        });

        const modelUsed = params.model || MODEL;
        const jobId = randomUUID();
        startClaudeJob(jobId, prompt, modelUsed, {
            matterId: params.matter_id,
            toolName: "critique_section",
            round: roundCheck.round,
            roundsRemaining: MAX_ROUNDS - roundCheck.round,
            modelUsed,
        });

        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "submitted",
                    job_id: jobId,
                    round: roundCheck.round,
                    rounds_remaining: MAX_ROUNDS - roundCheck.round,
                    matter_id: params.matter_id,
                    message: `Section critique submitted to Claude. Poll get_job_result with job_id to retrieve results.`,
                }, null, 2),
            }],
        };
    }
);

// Tool: Poll for job results
server.tool(
    "get_job_result",
    "Check status and retrieve results of a submitted adversarial review job. Returns 'running' if Claude is still processing, or the full critique when complete. Poll every 30-60 seconds.",
    {
        job_id: z.string().describe("Job ID returned by submit_adversarial_review, check_authorities, or critique_section"),
    },
    async (params) => {
        const job = jobs.get(params.job_id);
        if (!job) {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "not_found",
                        job_id: params.job_id,
                        message: "No job found with this ID. Jobs are cleared on server restart.",
                    }, null, 2),
                }],
            };
        }

        if (job.status === "running") {
            const elapsed = Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000);
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        status: "running",
                        job_id: params.job_id,
                        tool: job.toolName,
                        matter_id: job.matterId,
                        elapsed_seconds: elapsed,
                        message: `Claude is still processing. Started ${elapsed}s ago. Try again in 30-60 seconds.`,
                    }, null, 2),
                }],
            };
        }

        const response = {
            status: job.status,
            job_id: params.job_id,
            tool: job.toolName,
            matter_id: job.matterId,
            round: job.round,
            rounds_remaining: job.roundsRemaining,
            started_at: job.startedAt,
            completed_at: job.completedAt,
            model_used: job.modelUsed,
        };

        if (job.status === "completed") {
            response.critique = job.result;
        } else {
            response.error = job.error;
        }

        return {
            content: [{
                type: "text",
                text: JSON.stringify(response, null, 2),
            }],
        };
    }
);

// Tool: Reset round counter
server.tool(
    "reset_round_counter",
    "Reset the three-round counter for a matter.",
    {
        matter_id: z.string().describe("Matter identifier to reset"),
    },
    async (params) => {
        const previous = roundTracker.get(params.matter_id) || 0;
        roundTracker.delete(params.matter_id);
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    status: "success",
                    matter_id: params.matter_id,
                    previous_rounds: previous,
                    message: `Round counter reset for "${params.matter_id}". Three rounds available for next review.`,
                }, null, 2),
            }],
        };
    }
);

// Tool: Check round status
server.tool(
    "check_rounds",
    "Check how many adversarial review rounds have been used for a matter.",
    {
        matter_id: z.string().describe("Matter identifier to check"),
    },
    async (params) => {
        const used = roundTracker.get(params.matter_id) || 0;
        return {
            content: [{
                type: "text",
                text: JSON.stringify({
                    matter_id: params.matter_id,
                    rounds_used: used,
                    rounds_remaining: MAX_ROUNDS - used,
                    cap: MAX_ROUNDS,
                }, null, 2),
            }],
        };
    }
);

// â”€â”€â”€ Transport: HTTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runHTTP() {
    const app = express();
    app.use(express.json());

    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            server: "claude-adversarial-review",
            version: VERSION,
            transport: "http",
            port: HTTP_PORT,
            active_jobs: [...jobs.values()].filter(j => j.status === "running").length,
        });
    });

    app.post("/mcp", async (req, res) => {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        res.on("close", () => transport.close());
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    });

    app.listen(HTTP_PORT, () => {
        console.error(`[claude-adversarial-review] HTTP server running on http://localhost:${HTTP_PORT}/mcp`);
    });
}

// â”€â”€â”€ Transport: stdio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runStdio() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[claude-adversarial-review] Running on stdio transport");
}

// â”€â”€â”€ Start Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (transportFlag === "http") {
    runHTTP().catch((error) => {
        console.error("[claude-adversarial-review] HTTP server error:", error);
        process.exit(1);
    });
} else {
    runStdio().catch((error) => {
        console.error("[claude-adversarial-review] stdio server error:", error);
        process.exit(1);
    });
}
