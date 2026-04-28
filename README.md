# claude-plugin-codex

Claude-side plugin for Codex — the symmetric counterpart to OpenAI's [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc).

`codex-plugin-cc` lets you call Codex from Claude Code via slash commands like `/codex:review`, `/codex:adversarial-review`, and `/codex:rescue`. This repository provides the inverse: a Codex plugin that exposes three skills inside Codex sessions, letting you call Claude with predictable, scoped invocation patterns.

The repository is structured as both a **plugin** (under `plugins/claude/`) and a **local marketplace** (manifest at `.agents/plugins/marketplace.json`). It can be installed via `codex plugin marketplace add` against either a local clone or the GitHub URL once Codex's marketplace fetcher supports remote sources.

## What's in here

The plugin (named `claude`) exposes three Codex skills:

| Skill | Purpose | Transport |
|---|---|---|
| `claude-review` | Cross-model review of a legal deliverable (memo, motion, brief, strategic recommendation). Constructive framing. | `claude-review` MCP — `submit_adversarial_review` with `critique_type` per document |
| `claude-adversarial-review` | Devil's-advocate critique of legal work. Defect-only output, no balanced "what works well" framing. | Same MCP, adversarial framing |
| `claude-rescue` | General task delegation to Claude — code, debugging, alternative drafts, deep non-legal investigation. | Direct `claude --print` CLI invocation via Bash |

Selection rule: legal-deliverable review routes through the MCP (round-capped at 3 per matter); everything else routes through the CLI.

## Repository layout

```
claude-plugin-codex/
├── .agents/plugins/marketplace.json    Codex marketplace manifest
├── plugins/claude/                      The plugin
│   ├── .codex-plugin/plugin.json        Codex plugin manifest
│   └── skills/
│       ├── claude-review/SKILL.md
│       ├── claude-adversarial-review/SKILL.md
│       └── claude-rescue/SKILL.md
├── README.md                            This file
├── LICENSE                              Apache-2.0
└── .gitignore
```

## Prerequisites

- **Codex CLI** installed (`codex --version` works)
- **Claude CLI** installed and authenticated (`claude --version` works)
- **Node.js ≥ 18.18** for the `claude-review` MCP server
- **`claude-review` MCP** registered with Codex. Verify with `codex mcp get claude-review`. If absent, register it from the MCP server source (the LitigusAI repository contains it at `2 - MCP Servers/claude-review-mcp/server.mjs`).

## Installation

### Option A — Install via Codex marketplace (preferred)

```bash
# Clone the repository
git clone https://github.com/set2374/claude-plugin-codex.git ~/Documents/GitHub/claude-plugin-codex

# Add the local marketplace
codex plugin marketplace add ~/Documents/GitHub/claude-plugin-codex

# Restart Codex (or start a new session); the plugin's skills auto-discover.
```

### Option B — Symlink skills directly into Codex's skills directory

If you do not want to register the marketplace and just want the skills:

```bash
git clone https://github.com/set2374/claude-plugin-codex.git ~/Documents/GitHub/claude-plugin-codex

for skill in ~/Documents/GitHub/claude-plugin-codex/plugins/claude/skills/*/; do
  name="$(basename "$skill")"
  ln -sfn "$skill" ~/.codex/skills/"$name"
done
```

Either way, `codex` will auto-discover the three skills and route to them based on natural-language triggers ("have Claude review this", "delegate to Claude", etc.) or skill name.

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

A future enhancement could add resumable threads to the underlying MCP, but resumable rescue is out of scope for this initial release.

### Symmetry with codex-plugin-cc

Both directions of the bus now have:

| | Claude → Codex | Codex → Claude |
|---|---|---|
| Tool transport | `codex` CLI wrapped by `codex-plugin-cc` plugin | `claude-review` MCP for legal review; `claude --print` CLI for general delegation |
| Invocation surface | Slash commands (`/codex:review`, etc.) | Skill discovery (`claude-review`, etc.) |
| Round capping | Plugin job state | `roundTracker` in `claude-review-mcp`, 3 rounds per matter |
| Subagent | `codex:codex-rescue` | (planned for v0.2 — Codex-side rescue subagent) |
| Lifecycle hooks | SessionStart / SessionEnd, optional Stop review gate | (planned for v0.2 — depends on Codex hook surface) |

Codex's plugin model is centered on skills and MCP servers rather than slash commands and subagents (which are Claude Code-specific concepts), so this plugin is structurally different from `codex-plugin-cc` — it is the natural Codex idiom rather than a literal mirror.

## Roadmap

- **v0.1 (this release):** Three skills shipped as a Codex plugin with marketplace manifest. Routes through the existing `claude-review` MCP and the `claude` CLI.
- **v0.2:** Codex-side rescue-subagent equivalent. Optional bundled MCP registration so the plugin can ship its own `.mcp.json` rather than depending on out-of-band MCP registration.
- **v0.3:** Resumable threads in the underlying MCP, mirroring `codex-plugin-cc`'s `--resume-last` capability.
- **v0.4:** Marketplace publishing — list under a discoverable Codex marketplace URL once Codex's remote-marketplace fetcher is generally available.

## License

Apache-2.0 (matches `openai/codex-plugin-cc`).

## Author

Built as part of the [LitigusAI](https://litigusai.com) ALP framework. Symmetric to OpenAI's `codex-plugin-cc`.
