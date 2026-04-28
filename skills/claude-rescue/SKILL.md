---
name: claude-rescue
description: |
  Delegate an investigation, analysis, or task to Claude when Codex is stuck, wants a second implementation pass, or the work is better suited to Claude's reasoning style. This is the symmetric counterpart to the codex-plugin-cc /codex:rescue command on the Claude side. Unlike claude-review and claude-adversarial-review (which route through the legal-review MCP), this skill shells out to the `claude` CLI directly via Bash for general-purpose task delegation — code, analysis, drafting, debugging, or anything that does not fit the legal-document-review shape.

  Trigger phrases (non-exhaustive):
    - "ask Claude to investigate"
    - "delegate this to Claude"
    - "Claude rescue"
    - "hand this to Claude"
    - "have Claude figure this out"
    - "I'm stuck — Claude help"
    - "second implementation pass from Claude"
    - "Claude take a crack at this"

  Use one-shot. Resumable / multi-turn rescue is not yet supported in this skill (the underlying transport is `claude --print`); for sustained iteration with Claude, switch to Claude Code directly.
---

# Claude Rescue

You route the user's request to the `claude` CLI via Bash for general-purpose delegation. This is *not* the legal-review MCP path — it is direct CLI invocation, suitable for:

- Code review or implementation pass
- Debugging a tricky problem
- Producing an alternative draft or analysis
- Deep research on a non-legal topic
- "Get me unstuck" requests where Claude's reasoning style helps

## When to use this skill

Trigger when the user wants Claude to *do* something or *figure something out*, not just review a legal deliverable. If the task is legal-deliverable review, route via `claude-review` or `claude-adversarial-review` instead.

## When NOT to use this skill

- Legal-document review of a memo, motion, or brief → use `claude-review`
- Adversarial critique of legal work → use `claude-adversarial-review`
- The user wants you (Codex) to do the work yourself, not delegate
- The task requires multi-turn iteration with Claude across many turns — that is better done by switching to Claude Code directly

## How to invoke

Use Bash to call the `claude` CLI in non-interactive mode:

```bash
claude --print --output-format text <<< "<the prompt>"
```

Or, when the prompt contains shell-special characters or is long, write the prompt to a temp file and pipe:

```bash
claude --print --output-format text < /tmp/claude-rescue-prompt.txt
```

The `claude` binary is on PATH (~/bin/node + nvm Node 24.15). The CLI auto-discovers CLAUDE.md and skills from the working directory; if you want Claude to operate inside the litigusai-v3 repo context, run from `~/Documents/GitHub/litigusai-v3`. For other contexts (e.g., another repo), `cd` first.

## Prompt construction

Hand Claude a single, self-contained prompt. Claude has no prior session memory in `--print` mode, so include:

1. **The task.** What do you want Claude to do? Be specific.
2. **The relevant context.** File paths, code snippets, or text blocks that Claude needs to see. Paste them inline.
3. **The expected output shape.** "Return a unified diff", "Return a JSON object with these fields", "Return a 200-word summary", etc.
4. **Any constraints.** "Do not modify files outside /path/to/dir", "Use only the standard library", "Match this style".

## Operating discipline

1. **One-shot only.** This skill does not support `--resume` or follow-up turns. If the user wants a multi-turn conversation with Claude, switch to Claude Code directly. Tell the user this if they ask for follow-ups.
2. **Confirm before invoking large tasks.** Claude calls have latency and consume tokens. For tasks expected to take more than ~30 seconds, restate the task and confirm with the user before firing.
3. **Return verbatim.** Show Claude's output to the user as-is. A short framing line is fine; rewriting is not.
4. **No model leakage.** The CLI's effective model is set by the user's Claude Code configuration. Do not name the specific model in user-facing output. If pressed, refer to it generically ("the Claude profile").
5. **Workspace awareness.** If the task requires Claude to read or write files, mention which directory Claude was run from. If files outside that directory are needed, either copy them in or use absolute paths in the prompt.

## Output to the user

```
[brief framing — what was delegated, what was expected]

<verbatim Claude output>

[optional one-line on whether the user should run the suggested change, follow up, or treat this as exploratory]
```

## When the user wants iteration

If the user asks a follow-up like "ask Claude to refine that" or "have Claude continue", you have two options:

1. **Re-invoke `claude --print`** with the original prompt + Claude's prior output + the new instruction inline. This works for small refinements.
2. **Tell the user to switch to Claude Code.** For sustained iteration ("debug this with Claude over many turns"), the user gets a much better experience working in Claude Code directly than fighting one-shot CLI calls. Recommend this whenever the conversation is heading toward 3+ turns of back-and-forth.
