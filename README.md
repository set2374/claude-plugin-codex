# claude-plugin-codex

Claude-side skills for Codex — the symmetric counterpart to OpenAI's [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc).

`codex-plugin-cc` lets you call Codex from Claude Code via slash commands like `/codex:review`, `/codex:adversarial-review`, and `/codex:rescue`. This repository provides the inverse: Codex-side skills that let you call Claude with predictable, scoped invocation patterns from inside a Codex session.

> **Status:** Early — skills layer (described below) is functional. A full Codex plugin (manifest, marketplace, slash-command surface) is planned as a follow-on once the prompt shapes have been validated in real use.

## What's in here

Three Codex skills that mirror the codex-plugin-cc command surface:

| Skill | Purpose | Transport |
|---|---|---|
| `claude-review` | Cross-model review of a legal deliverable (memo, motion, brief, strategic recommendation). Constructive framing. | `claude-review` MCP — `submit_adversarial_review` with `critique_type` per document |
| `claude-adversarial-review` | Devil's-advocate critique of legal work. Defect-only output, no balanced "what works well" framing. | Same MCP, adversarial framing |
| `claude-rescue` | General task delegation to Claude — code, debugging, alternative drafts, deep non-legal investigation. | Direct `claude --print` CLI invocation via Bash |

Selection rule: legal-deliverable review routes through the MCP (round-capped at 3 per matter); everything else routes through the CLI.

## Prerequisites

- **Codex CLI** installed (`codex --version` works)
- **Claude CLI** installed and authenticated (`claude --version` works)
- **Node.js ≥ 18.18** for the `claude-review` MCP server
- **`claude-review` MCP** registered with Codex. Verify with `codex mcp get claude-review`. If absent, register it (the MCP server source is at `2 - MCP Servers/claude-review-mcp/server.mjs` in the LitigusAI repository).

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/<owner>/claude-plugin-codex.git ~/Documents/GitHub/claude-plugin-codex

# 2. Symlink each skill into Codex's skills directory
for skill in ~/Documents/GitHub/claude-plugin-codex/skills/*/; do
  name="$(basename "$skill")"
  ln -sfn "$skill" ~/.codex/skills/"$name"
done

# 3. Restart Codex (or start a new session) to pick up the skills
```

After installation, `codex` in any Codex session will auto-discover the three skills and route to them based on natural-language triggers ("have Claude review this", "delegate to Claude", etc.) or skill name.

## Triggers

Each skill defines trigger phrases in its `SKILL.md` description:

- **claude-review:** "review with Claude", "have Claude review this", "second opinion from Claude", "cross-check this with Claude"
- **claude-adversarial-review:** "Claude critique", "have Claude tear this apart", "adversarial review with Claude", "stress-test this", "Claude devil's advocate"
- **claude-rescue:** "ask Claude to investigate", "delegate this to Claude", "Claude rescue", "hand this to Claude", "have Claude figure this out"

Triggers are deliberately overlapping — Codex's skill discovery is fuzzy, and multiple natural phrasings increase reliability.

## Architecture

### Why two transports?

The `claude-review` MCP is purpose-built for legal-document adversarial review with a fixed three-round protocol per matter. It is not a general-purpose Claude transport. Forcing all Claude calls through it would either:

1. Burn rounds on non-legal work (since the cap is per matter, not per session), or
2. Apply legal-review prompt shapes to code or general analysis (mismatched framing).

So `claude-review` and `claude-adversarial-review` route through the MCP for legal deliverables, while `claude-rescue` shells out to `claude --print` directly for everything else. Both paths are real Claude calls; only the routing differs.

### One-shot, not multi-turn

`claude-rescue` invokes `claude --print` non-interactively. Each call is a fresh Claude process with no prior session memory. For sustained iteration ("debug this with Claude across many turns"), open Claude Code directly. The skill explicitly recommends this when conversations head toward 3+ turns.

A future enhancement could add resumable threads to the underlying MCP, but resumable rescue is out of scope for this initial skills release.

### Symmetry with codex-plugin-cc

Both directions of the bus now have:

| | Claude → Codex | Codex → Claude |
|---|---|---|
| Tool transport | `codex` CLI wrapped by `codex-plugin-cc` plugin | `claude-review` MCP for legal review; `claude --print` CLI for general delegation |
| Slash-style invocation | Yes (`/codex:review`, etc.) | Skill-based discovery (`claude-review`, etc.) |
| Round capping | Plugin job state | `roundTracker` in `claude-review-mcp`, 3 rounds per matter |
| Subagent | `codex:codex-rescue` | (planned — full Codex plugin will add `claude:rescue` subagent) |
| Lifecycle hooks | SessionStart/SessionEnd, optional Stop review gate | (planned — full Codex plugin) |

The skills layer is the "v0" of this symmetry. The full Codex plugin (with marketplace manifest, lifecycle hooks, and proper slash commands) is the "v1" follow-on.

## Roadmap

- **v0 (this release):** Skills-based invocation. Three skills covering the codex-plugin-cc command surface.
- **v1:** Full Codex plugin with marketplace manifest. Slash commands `/claude:review`, `/claude:adversarial-review`, `/claude:rescue`. Codex-side `claude-rescue` subagent for multi-turn delegation. Lifecycle hooks if useful.
- **v2:** Resumable threads in the underlying MCP, mirroring `codex-plugin-cc`'s `--resume-last` capability.

## License

Apache-2.0 (matches `openai/codex-plugin-cc`).

## Author

Built as part of the [LitigusAI](https://litigusai.com) ALP framework. Symmetric to OpenAI's `codex-plugin-cc`.
