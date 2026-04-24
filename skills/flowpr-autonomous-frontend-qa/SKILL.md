---
name: flowpr-autonomous-frontend-qa
description: Test frontend flows in live browsers, diagnose visual failures, patch code, verify fixes, and create GitHub pull requests with evidence.
license: MIT
compatibility: Requires network access, GitHub token or app, TinyFish API key, Redis, InsForge, Guild.ai, and optional Senso.
metadata:
  version: "0.1.0"
---

# FlowPR Autonomous Frontend QA

Use this skill when a coding agent must verify a frontend flow, collect browser evidence, modify source code, add regression tests, rerun verification, and open a PR.

Rules:

1. Use TinyFish for live browser evidence.
2. Use Redis Streams for autonomous run state.
3. Store durable records in InsForge.
4. Use WunderGraph safe operations instead of arbitrary backend writes.
5. Use Guild.ai to record agent sessions, action gates, and benchmark promotion status.
6. Use Senso policy context before final diagnosis or PR writing.
7. Create a PR, not an auto-merge.
8. Include before/after screenshots and verification in the PR body.
9. Never claim sponsor usage unless a provider artifact exists.

