---
name: claude-review
description: |
  Cross-model review of a legal deliverable (memo, motion, brief, strategic recommendation) by Claude through the claude-review MCP. Use when the user wants a second-model opinion or constructive critique on legal work. Triggers: "review with Claude", "have Claude review this", "second opinion from Claude", "cross-check this with Claude", "Claude review". Round-capped at 3 per matter. Do NOT use for code review (use claude-rescue), adversarial critique (use claude-adversarial-review), or multi-turn delegation (use claude-rescue or open Claude Code directly). Symmetric to codex-plugin-cc /codex:review.
---

## When this skill matches

Trigger phrases the model should also recognize:
- "have a different model look at this"
- explicit invocation by skill name

## Do NOT use for

- Code review or general analysis (claude-rescue or shell out to claude --print)
- Adversarial / devil's-advocate critique (claude-adversarial-review)
- Multi-turn delegation or conversational investigation (claude-rescue, or open Claude Code directly)
- Matter-locked work beyond round 3 (MCP enforces a 3-round cap per matter)

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
