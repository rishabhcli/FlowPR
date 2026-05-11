# FlowPR Demo Runbook

## Pre-flight (5 minutes before the demo)

1. `pnpm redis:smoke` — confirm Redis streams, consumer groups, locks, memory are reachable.
2. `pnpm guild:evaluate` — run the executable `frontend-bugs` fixtures and confirm the current agent version is promoted.
3. `pnpm evidence:integrity` — confirm browser observations, verification rows, and PR records require matching provider artifacts.
4. `pnpm pr:packet-smoke` — confirm a gate-held PR path still writes a complete reviewer-facing evidence packet.
5. `pnpm recovery:smoke` — confirm stuck runs and dead-letter rows include actionable recovery guidance.
6. `pnpm benchmark:recovery` — confirm Guild.ai can evaluate the runtime-recovery fixture contract.
7. `pnpm skill:dry-run` — confirm the Shipables skill bundle is intact.
8. `pnpm run:replay -- --fail-on-not-ready` — reconstruct the latest run from InsForge/local fallback state plus Redis progress, and stop the pre-flight if run readiness is missing or partial.
9. `pnpm demo:preflight` — run the combined Redis, evidence, PR packet, recovery, skill, dashboard health, and replay-readiness gate.
10. Open `http://localhost:3000/health` — required runtime checks should be `configured`, `live`, or explicitly in local fallback with an actionable reason. Optional sponsors may be `not_configured` if the demo path does not depend on them.
11. Confirm the demo-target is in the broken state: `grep -n "z-index: 10" apps/demo-target/app/styles.css` returns a hit under `.pay-button`.

## Live demo sequence (≈3 minutes)

1. Open `/demo` in the dashboard. Narrate the three columns: intake, timeline, sponsor rail.
2. Open `http://localhost:3100/checkout?plan=pro` on a 390x844 viewport. Show the cookie banner covering Pay now.
3. Back in the dashboard, click **Start run**. Confirm:
   - A new entry appears under Recent Runs.
   - Redis stream artifacts begin populating (timeline phase `queue` → `running_browser_qa`).
   - TinyFish provider ID appears as a chip.
4. Wait for `triaging_failure` → `retrieving_policy` → `searching_memory`. Call out:
   - FlowPR diagnosed `blocked_cta` critical severity.
   - Senso returned the mobile checkout acceptance rule.
5. When the phase reaches `patching_code`, show the Fix Records panel:
   - Branch name `flowpr/*-blocked-cta`.
   - Files changed include `apps/demo-target/app/styles.css` + the regression test.
6. `running_local_tests` and `running_live_verification` should both pass. For localhost previews, point out that TinyFish live verification is skipped with the explicit "cannot reach localhost" reason and that local verification plus Playwright trace is the proof source. For public previews, point out the TinyFish after-screenshot.
7. Call out the Guild.ai `create_pull_request` gate result. In `investigation-only`, the gate holds PR creation and FlowPR writes a human handoff report. In `draft-pr-only` or `verified-pr`, FlowPR may open a PR if GitHub credentials and gates allow it.
8. If a PR opens, open the GitHub PR URL. If the gate holds, open the handoff report. Narrate the evidence packet sections:
   - Root cause, before screenshot, Playwright trace, diff, verification table, policy citations, governance block.
9. Switch back to `/health` to show runtime truth after the live run: Redis and worker health, provider statuses, any local fallback, and next actions for unavailable integrations.

## Resetting between takes

```bash
pnpm demo:reset
pnpm demo:break
pnpm demo:start-run
pnpm demo:preflight
```

## Failure safe talking points

If TinyFish is rate-limited, emphasise:

- Redis retries (look at the dead letter stream row count).
- `/health` shows the recovery queue: stuck runs, unresolved dead letters, and the exact replay/worker command to run next.
- InsForge holds the last artifact when the backend is reachable. If the backend is down, FlowPR records an `insforge:local_fallback_store` artifact and persists run detail plus screenshots under the ignored `.flowpr-workspaces/` local store.
- `pnpm run:replay <runId> --fail-on-not-ready` reconstructs durable run detail, live Redis progress, worker heartbeats, live stream URLs, and run-specific dead letters without opening the dashboard, then exits nonzero if readiness is missing or partial.
- Guild.ai session records why the gate stopped or succeeded.
- PR creation only happens after verification passes and the Guild.ai gate allows it. Otherwise the handoff report is the expected artifact, not a failure.
