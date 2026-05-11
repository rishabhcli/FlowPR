---
name: flowpr-autonomous-frontend-qa
description: Test frontend flows in live browsers, diagnose visual failures, patch code, verify fixes, and create GitHub pull requests or human handoff reports with evidence.
license: MIT
compatibility: Full loop requires network access, GitHub token or app, TinyFish API key, Redis, InsForge, Guild.ai, and optional Senso; degraded local mode can still capture Playwright proof and record honest skipped provider paths.
metadata:
  version: "1.0.0"
---

# FlowPR Autonomous Frontend QA

Use this skill when a coding agent must verify a frontend flow, collect browser evidence, modify source code, add regression tests, rerun verification, and open a PR or produce a governed handoff packet.

## When to use

- A preview URL exists for the failing flow and you have (or can clone) the source repo.
- You have at least one configured live browser provider (TinyFish or Playwright) and a backend (InsForge or compatible).
- You can operate under a `draft-pr-only` or `verified-pr` Guild.ai permission profile.

## What the skill does

1. Accepts `{ repoUrl, previewUrl, flowGoal, baseBranch, riskLevel }` and emits a Redis `run.started` event.
2. Runs TinyFish Agent + Browser API and Playwright against the preview URL, capturing structured observations.
3. Queries Senso for acceptance criteria, PR requirements, and severity guidance.
4. Uses Redis memory to search for prior bug signatures and successful patches.
5. Generates a structured bug hypothesis with bug type, severity, likely files, and confidence.
6. Clones the repo, writes a minimal patch + regression test, and runs local verification.
7. Re-verifies the fix with TinyFish when the preview is reachable; for localhost previews, records an explicit reachability skip backed by local verification.
8. Opens a draft/non-draft GitHub PR when the Guild.ai gate allows it, or writes a human handoff report when the gate holds PR creation.
9. Writes successful patch signatures to Redis memory and closes the Guild.ai session trace.

## Rules

1. Never claim a sponsor was used unless a provider artifact exists in InsForge.
2. Use TinyFish for live browser evidence.
3. Use Redis Streams for autonomous run state.
4. Store durable records in InsForge.
5. Use WunderGraph safe operations instead of arbitrary backend writes.
6. Use Guild.ai to record agent sessions, action gates, and benchmark promotion status.
7. Use Senso policy context before final diagnosis or PR writing.
8. Create a PR only when the configured Guild.ai gate allows it; otherwise produce a human handoff report.
9. Include before/after screenshots or honest local-proof fallback plus verification in the PR body or handoff report.
10. Stop before PR creation if the Guild.ai gate denies the action.

## Inputs

| Field | Required | Description |
| --- | --- | --- |
| `repoUrl` | yes | Full GitHub URL or `owner/repo` shorthand. |
| `previewUrl` | yes | Preview/production URL for the flow to test. |
| `flowGoal` | yes | Natural-language goal the browser agent should accomplish. |
| `baseBranch` | no (default `main`) | Base branch for the PR. |
| `riskLevel` | no (default `medium`) | `low`/`medium`/`high`/`critical`. |

## Outputs

- Redis stream events on `flowpr:runs`, `flowpr:agent_steps`, `flowpr:browser_results`, `flowpr:patches`, `flowpr:verification`.
- InsForge rows in `qa_runs`, `browser_observations`, `bug_hypotheses`, `patches`, `verification_results`, `pull_requests`, and `provider_artifacts`.
- GitHub pull request with FlowPR evidence body, or a human handoff report when PR creation is gated.

## References

- [State machine](references/state-machine.md)
- [Sponsor map](references/sponsor-map.md)
- [PR template](references/pr-template.md)
- [Guild agent](references/guild-agent.md)
- [Benchmark suite](references/benchmark-suite.md)
- [Demo runbook](references/demo-runbook.md)
