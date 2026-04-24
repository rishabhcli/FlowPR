# FlowPR MCP Plan

Available sponsor MCPs found during setup:

- TinyFish: hosted MCP endpoint `https://agent.tinyfish.ai/mcp` (installed globally in Codex with OAuth)
- Redis: `@modelcontextprotocol/server-redis` (enabled in Codex; local Redis runs at `redis://127.0.0.1:6379`)
- InsForge: `@insforge/mcp` (installed globally in Codex by the InsForge dashboard installer)
- Akash: `akash-mcp` (enabled in Codex with this repo as `cwd`, but startup requires wallet auth)

Akash note: the available Akash MCP package requires wallet credentials before it will start. Configure either `AKASH_MNEMONIC` or `AKASH_PRIVATE_KEY_HEX`; `AKASH_API_KEY` alone is not sufficient for `akash-mcp`.

Useful non-sponsor MCP for FlowPR browser verification:

- Playwright: `@playwright/mcp` (enabled in Codex)

No sponsor-specific npm MCP package was found for Senso, Guild.ai, Shipables, Chainguard, or WunderGraph during this pass. Those integrations should use their API/CLI/SDK surfaces unless an official MCP endpoint is provided by the sponsor dashboard.
