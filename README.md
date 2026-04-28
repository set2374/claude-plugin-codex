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
├── .agents/plugins/marketplace.json     Codex marketplace manifest
├── plugins/claude/                       The plugin
│   ├── .codex-plugin/plugin.json         Codex plugin manifest
│   ├── .mcp.json                         MCP server registration (auto-loaded by Codex)
│   ├── mcp-server/                       Bundled claude-review MCP server source
│   │   ├── server.mjs                    Server implementation
│   │   ├── package.json                  Node deps; run `npm install` here once
│   │   ├── package-lock.json
│   │   └── .gitignore                    Excludes node_modules
│   └── skills/
│       ├── claude-review/SKILL.md
│       ├── claude-adversarial-review/SKILL.md
│       └── claude-rescue/SKILL.md
├── README.md                             This file
├── CHANGELOG.md                          Version history
├── LICENSE                               Apache-2.0
└── .gitignore
```

## Prerequisites

- **Codex CLI** installed (`codex --version` works)
- **Claude CLI** installed and authenticated (`claude --version` works)
- **Node.js ≥ 18.18** for the `claude-review` MCP server (bundled inside this plugin)

The MCP server is bundled — you do **not** need the LitigusAI repository cloned. You do need to run `npm install` once inside `plugins/claude/mcp-server/` to install the server's runtime dependencies.

## Installation

### Option A — Install via Codex marketplace (preferred)

```bash
# 1. Clone the repository
git clone https://github.com/set2374/claude-plugin-codex.git ~/Documents/GitHub/claude-plugin-codex

# 2. Install the bundled MCP server's runtime dependencies (once)
cd ~/Documents/GitHub/claude-plugin-codex/plugins/claude/mcp-server && npm install

# 3. Add the local marketplace to Codex
codex plugin marketplace add ~/Documents/GitHub/claude-plugin-codex

# 4. Enable the plugin (one-time edit to ~/.codex/config.toml)
cat >> ~/.codex/config.toml <<'EOF'

[plugins."claude@claude-plugin-codex"]
enabled = true
EOF

# 5. Start a new Codex session; the plugin's three skills and the
#    claude-review MCP auto-load.
```

The plugin's `.mcp.json` registers `claude-review` against the bundled server. If you already have a `claude-review` MCP registered with Codex pointing elsewhere (e.g., a development copy in a sibling repository), you should remove it via `codex mcp remove claude-review` before enabling this plugin to avoid the registration colliding.

### Option B — Symlink skills directly into Codex's skills directory

If you do not want to register the marketplace and just want the skills (you handle MCP registration yourself):

```bash
git clone https://github.com/set2374/claude-plugin-codex.git ~/Documents/GitHub/claude-plugin-codex
cd ~/Documents/GitHub/claude-plugin-codex/plugins/claude/mcp-server && npm install
cd ~

for skill in ~/Documents/GitHub/claude-plugin-codex/plugins/claude/skills/*/; do
  name="$(basename "$skill")"
  ln -sfn "$skill" ~/.codex/skills/"$name"
done

# Register the MCP yourself
codex mcp add claude-review \
  -- node "$HOME/Documents/GitHub/claude-plugin-codex/plugins/claude/mcp-server/server.mjs"
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

- **v0.1 — released 2026-04-27:** Three skills shipped as a Codex plugin with marketplace manifest. Routes through the existing `claude-review` MCP and the `claude` CLI. Required out-of-band MCP registration.
- **v0.2 — released 2026-04-28 (current):** Bundled `claude-review` MCP server source inside the plugin. Plugin ships `.mcp.json` so the MCP auto-registers when the plugin is enabled. The plugin is no longer dependent on the LitigusAI repository being cloned. Skill descriptions tightened to fit Codex's 1024-character frontmatter limit (fixed a silent load failure on `claude-review` and `claude-rescue` from v0.1). See `CHANGELOG.md`.
- **v0.3 (planned):** Resumable threads in the underlying MCP, mirroring `codex-plugin-cc`'s `--resume-last` capability for `claude-rescue`. Removes the one-shot constraint for multi-turn delegation.
- **v0.4 (planned):** Marketplace publishing — list under a discoverable Codex marketplace URL once Codex's remote-marketplace fetcher is generally available. Auto-`npm install` for the bundled MCP server's dependencies on plugin install.

## License

Apache-2.0 (matches `openai/codex-plugin-cc`).

## Author

Built as part of the [LitigusAI](https://litigusai.com) ALP framework. Symmetric to OpenAI's `codex-plugin-cc`.
