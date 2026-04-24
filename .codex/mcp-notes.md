# FlowPR MCP Plan

Available sponsor MCPs found during setup:

- TinyFish: hosted MCP endpoint `https://agent.tinyfish.ai/mcp` (installed globally in Codex with OAuth)
- Redis: `@modelcontextprotocol/server-redis` (installed globally in Codex)
- InsForge: `@insforge/mcp` (installed globally in Codex by the InsForge dashboard installer)
- Akash: `akash-mcp` (installed globally in Codex, currently disabled until wallet auth is configured)

Akash note: the saved Akash Console API key is present in the local `.env`, but the available Akash MCP packages found on npm (`akash-mcp` and `@iflow-mcp/akash-mcp`) require wallet credentials for deployment operations. Configure either `AKASH_MNEMONIC` or `AKASH_PRIVATE_KEY_HEX` before enabling Akash MCP.

Useful non-sponsor MCP for FlowPR browser verification:

- Playwright: `@playwright/mcp`

No sponsor-specific npm MCP package was found for Senso, Guild.ai, Shipables, Chainguard, or WunderGraph during this pass. Those integrations should use their API/CLI/SDK surfaces unless an official MCP endpoint is provided by the sponsor dashboard.
