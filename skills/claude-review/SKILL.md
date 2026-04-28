---
name: claude-review
description: |
  Cross-model review of a legal document or analysis by Claude. Routes through the claude-review MCP (transport: Claude CLI in --print mode, with per-matter round capping). Use this skill when the user wants a second-model opinion on a legal deliverable — a memo, motion, brief, research summary, or strategic recommendation — and the goal is verification or critique rather than a tear-down.

  Trigger phrases (non-exhaustive):
    - "review with Claude"
    - "have Claude review this"
    - "second opinion from Claude"
    - "cross-check this with Claude"
    - "Claude review"
    - "have a different model look at this"

  This skill is the symmetric counterpart to the codex-plugin-cc /codex:review command on the Claude Code side. It routes through the bus-native cross-model review channel (claude-review MCP), not through ad-hoc claude CLI calls.

  Do NOT use this skill for:
    - Code review (use the claude-rescue skill or shell out to claude --print directly via Bash; this MCP is legal-review-focused)
    - Adversarial / devil's-advocate review (use claude-adversarial-review)
    - Multi-turn delegation or conversational investigation (use claude-rescue)
    - Anything matter-locked beyond round 3 — the MCP enforces a 3-round cap per matter
---

# Claude Review

You route the user's request to the `claude-review` MCP for an independent legal-document review by Claude. This is the bus-native cross-model review path. It enforces a three-round cap per matter to prevent reviewer-loop sycophancy and tracks job state across the session.

## When to use this skill

Trigger when the user asks for a cross-model review of a legal deliverable. The deliverable can be:

- A memorandum or research summary (`critique_type: "analysis"`)
- A motion, brief, or filing (`critique_type: "motion"`)
- A strategic recommendation or case-strategy memo (`critique_type: "strategy"`)

If the user does not specify a critique type, infer it from the document. If you cannot infer cleanly, ask one clarifying question.

## When NOT to use this skill

- The work is non-legal (code review, general analysis) → fall back to the `claude-rescue` skill or shell out via Bash
- The user wants an aggressive devil's-advocate critique → use `claude-adversarial-review` instead
- The user wants Claude to *do* something (investigate, fix, draft) rather than review → use `claude-rescue`

## How to invoke

Use the `claude-review` MCP. Available tools:

- `claude-review.preflight` — run before the first review of a session to confirm Claude CLI reachability
- `claude-review.submit_adversarial_review` — submits the document. Required params: `matter_id`, `document_text`, `critique_type` (`"analysis" | "motion" | "strategy"`). Returns a `job_id`.
- `claude-review.get_job_result` — poll with the `job_id` every 30–60 seconds until `status == "completed"` or `"error"`. Then return the critique to the user verbatim.
- `claude-review.check_rounds` — check rounds used for the matter before submitting if you are uncertain about the round budget.
- `claude-review.reset_round_counter` — only if the user explicitly authorizes it ("reset rounds on this matter").

## Operating discipline

1. **Confirm matter context.** A `matter_id` is required. If the user has not given one, ask — never invent.
2. **Round-cap awareness.** Before submitting, mention round number ("This will be round 2 of 3"). After round 3, refuse and tell the user to either reset or finalize.
3. **Wait for the job.** Polling latency is real. Keep the user informed but do not poll faster than every 30 seconds.
4. **Return verbatim.** Codex returns the critique to the user as-is. Do not paraphrase, summarize, or add commentary before the critique block. A short framing line ("Claude's review of <document>:") is fine; rewrites are not.
5. **No model leakage.** Do not name the specific Claude model running on the other side. The MCP routes via the user's configured `CLAUDE_MODEL` env var; the user owns model selection.

## Output to the user

After completion, structure the response as:

```
[brief framing line — what was reviewed, which round]

<verbatim critique from claude-review.get_job_result>

[optional one-line note on whether further rounds are advisable]
```
