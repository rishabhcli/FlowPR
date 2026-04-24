# Phase 3 Redis Runtime Runbook

FlowPR uses Redis as the autonomous agent runtime in Phase 3. Dashboard intake writes a `run.started`
event to `flowpr:runs`; the worker consumes it through the `flowpr-workers` consumer group and drives the
deterministic state machine through Redis events.

## Required Streams

- `flowpr:runs`
- `flowpr:agent_steps`
- `flowpr:browser_results`
- `flowpr:patches`
- `flowpr:verification`
- `flowpr:dead_letter`

## Smoke Check

```bash
pnpm redis:smoke
```

The smoke check creates missing consumer groups, verifies stream stats, exercises a patch lock, and round-trips
a Redis bug-signature memory entry.

## Run A Worker Pass

```bash
pnpm worker:once
```

For a continuous worker:

```bash
pnpm worker:dev
```

## Inspect Streams

```bash
redis-cli -u "$REDIS_URL" XRANGE flowpr:runs - + COUNT 5
redis-cli -u "$REDIS_URL" XRANGE flowpr:agent_steps - + COUNT 10
redis-cli -u "$REDIS_URL" XINFO GROUPS flowpr:agent_steps
redis-cli -u "$REDIS_URL" XRANGE flowpr:dead_letter - + COUNT 5
```

## Runtime Keys

- Run state hash: `flowpr:run_state:{runId}`
- Patch lock: `flowpr:locks:patch:{runId}`
- PR lock: `flowpr:locks:pr:{runId}`
- Bug memory: `flowpr:memory:bug-signatures:{hash}`
- Patch memory: `flowpr:memory:successful-patches:{hash}`

## Dashboard Proof

Open the dashboard, select the run, and inspect:

- Timeline rows with Redis stream IDs.
- Provider artifacts with sponsor `redis`.
- The Redis Runtime evidence panel.
- Dead-letter timeline rows if an event fails three times.

## Failure Case

To force a dead-letter for an existing run without mutating code, add an invalid third-attempt agent step:

```bash
redis-cli -u "$REDIS_URL" XADD flowpr:agent_steps '*' \
  runId "$RUN_ID" eventType agent.step phase unsupported_phase attempt 3 \
  dedupeKey "phase3.deadletter.$RUN_ID" createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
pnpm worker:once
```

The worker moves the event to `flowpr:dead_letter`, marks the run failed, and records a Redis provider artifact.
