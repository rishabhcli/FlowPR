# FlowPR Demo Runbook

## Pre-flight (5 minutes before the demo)

1. `pnpm redis:smoke` — confirm Redis streams, consumer groups, locks, memory are reachable.
2. `pnpm guild:evaluate` — confirm the current agent version is promoted for the `frontend-bugs` suite.
3. `pnpm skill:dry-run` — confirm the Shipables skill bundle is intact.
4. Open `http://localhost:3000/health` — all sponsors should be `configured` or `live`.
5. Confirm the demo-target is in the broken state: `grep -n "z-index: 10" apps/demo-target/app/styles.css` returns a hit under `.pay-button`.

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
6. `running_local_tests` and `running_live_verification` should both pass. Point out the green TinyFish after-screenshot.
7. Guild.ai action gate `create_pull_request` is approved, FlowPR opens the PR.
8. Open the GitHub PR URL. Narrate the evidence packet sections:
   - Root cause, before screenshot, Playwright trace, diff, verification table, policy citations, governance block.
9. Switch back to `/health` to show every sponsor chip is green after the live run.

## Resetting between takes

```bash
pnpm demo:reset
pnpm demo:break
pnpm demo:start-run
```

## Failure safe talking points

If TinyFish is rate-limited, emphasise:

- Redis retries (look at the dead letter stream row count).
- InsForge still holds the last artifact (provider artifact table).
- Guild.ai session records why the gate stopped or succeeded.
- PR creation only happens after verification passes — no silent autopush.
