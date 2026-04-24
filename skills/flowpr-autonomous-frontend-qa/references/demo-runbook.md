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

# 5. Observe the dashboard at http://localhost:3000.
```

FlowPR should transition through every phase and end with a draft PR on `rishabhcli/FlowPR`. Stop and check `/health` if any sponsor reports `not_configured` before the demo.
