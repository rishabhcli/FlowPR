# Demo Runbook

```bash
# 1. Reset the demo-target so the bug is seeded.
pnpm demo:reset
pnpm demo:break

# 2. Start the demo target and dashboard.
pnpm dev:demo      # terminal A, port 3100
pnpm dev:dashboard # terminal B, port 3000

# 3. Start the agent worker.
pnpm worker:dev    # terminal C

# 4. Trigger a run.
pnpm demo:start-run

# 5. Reconstruct the durable/runtime state for the latest run.
pnpm run:replay -- --fail-on-not-ready

# 6. Run the full operator preflight gate: Redis, evidence integrity,
# PR packet, recovery guidance, skill health, dashboard health, and replay readiness.
pnpm demo:preflight

# 7. Observe the dashboard at http://localhost:3000.
```

FlowPR should transition through every phase and end with either a GitHub PR or a human handoff report, depending on the active Guild.ai permission profile. On localhost previews, TinyFish may record remote reachability failures while Playwright/local verification provides the actionable proof. Stop and check `/health` when a required provider is unavailable without a local fallback or next-action reason.
