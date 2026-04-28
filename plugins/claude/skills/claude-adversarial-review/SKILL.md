---
name: claude-adversarial-review
description: |
  Aggressive devil's-advocate review of a legal document by Claude. Routes through the claude-review MCP. Use this skill when the user explicitly wants the work torn apart — every weakness flagged, every assumption challenged, no balanced "what works well" framing. The goal is to surface defects before opposing counsel or a court does.

  Trigger phrases (non-exhaustive):
    - "Claude critique"
    - "have Claude tear this apart"
    - "adversarial review with Claude"
    - "stress-test this with Claude"
    - "have Claude challenge this"
    - "Claude devil's advocate"
    - "what would Claude attack here"
    - "find the holes"

  This is the symmetric counterpart to the codex-plugin-cc /codex:adversarial-review command. Distinct from claude-review (constructive) and claude-rescue (delegation). All three exist in this ALP-aware Codex environment so the user can choose review posture explicitly.
---

# Claude Adversarial Review

You route the user's request to the `claude-review` MCP and instruct Claude to perform a hostile critique. The MCP is the same as `claude-review` — the difference is the prompt framing and the way you describe results back to the user.

## When to use this skill

Trigger when the user wants:

- A defect-only critique with no positive framing
- Pre-mortem on a draft before submission to opposing counsel
- Stress-testing of legal arguments, citations, or strategic positioning
- "What would the other side attack here?"

## When NOT to use this skill

- Constructive review (use `claude-review` instead)
- Delegation or investigation (use `claude-rescue`)
- Non-legal work (this MCP is legal-focused)

## How to invoke

Same MCP, same tools as `claude-review`:

- `claude-review.submit_adversarial_review` with `critique_type` set per the document type. The MCP's adversarial mode is the default — no separate flag is needed. The skill name is what tells you to frame results as defect-only.
- Required params: `matter_id`, `document_text`, `critique_type` (`"analysis" | "motion" | "strategy"`).
- Optional: pass `focus` in the prompt body if the user has named a specific weakness to probe ("focus on the choice-of-law analysis", "focus on the statute-of-limitations argument").

## Operating discipline

1. **Be explicit about the posture.** When you tell the user you are submitting, frame it as: "Claude will review this adversarially — it will only report defects and challenges, not strengths."
2. **Round-cap awareness.** Adversarial rounds count against the 3-round-per-matter cap just like constructive rounds. Tell the user before submitting.
3. **Return verbatim.** Same as claude-review — do not soften, hedge, or balance Claude's critique. The whole point is the unedited adversarial output.
4. **Do not simulate opposing counsel theatrics.** Adversarial review surfaces real defects. If Claude returns balanced output instead of a defect list, that is a signal Claude judged the work substantially clean — pass that signal through.

## Output to the user

```
Adversarial review of <document>, round <N> of 3:

<verbatim critique>

[optional one-line: whether the user should treat this as actionable defect list or as confirmation the work is clean]
```
