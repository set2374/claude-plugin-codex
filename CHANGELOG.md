# Changelog

All notable changes to `claude-plugin-codex` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-04-28

### Added
- **Bundled MCP server.** The `claude-review` MCP server source (`server.mjs`, `package.json`, `package-lock.json`) is now shipped inside the plugin at `plugins/claude/mcp-server/`. The plugin is no longer dependent on the LitigusAI repository being cloned.
- **`.mcp.json` manifest.** The plugin now ships a `.mcp.json` registering `claude-review` against the bundled server, referenced from `plugin.json` via the `mcpServers` field. Codex will auto-register the MCP when the plugin is enabled. Honors `CLAUDE_PATH` env var for non-default Claude CLI locations.
- **CHANGELOG.md.**

### Changed
- Plugin version bumped to `0.2.0`.
- Skill description fields tightened to fit Codex's 1024-character frontmatter limit. Verbose discipline notes that previously lived in the description remain in the body of each `SKILL.md`.

### Fixed
- `claude-review` and `claude-rescue` skill descriptions previously exceeded Codex's silent 1024-char description limit, causing them to fail to load. Only `claude-adversarial-review` had been loading. Tightened to ~600 chars each. Verified via `codex exec` enumeration.

### Installation note
After installing this version, run `npm install` inside `plugins/claude/mcp-server/` once to install the MCP server's runtime dependencies. This is documented in the README. Future versions may automate this.

## [0.1.0] — 2026-04-27

### Added
- Initial release. Three Codex skills shipped as a packaged Codex plugin with marketplace manifest:
  - `claude-review` — cross-model review of legal deliverables through the `claude-review` MCP. Round-capped at 3 per matter.
  - `claude-adversarial-review` — devil's-advocate critique through the same MCP. Defect-only output.
  - `claude-rescue` — general task delegation via the `claude --print` CLI for code, debugging, alternative drafts, and non-legal investigation. One-shot only.
- Marketplace manifest at `.agents/plugins/marketplace.json` for installation via `codex plugin marketplace add`.
- README with installation instructions, architecture notes, and roadmap.
- Apache-2.0 license.

### Architecture
- Two-transport routing: legal deliverables go through the round-capped `claude-review` MCP; general tasks go through direct `claude --print` CLI invocation.
- Symmetric counterpart to OpenAI's [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc).
