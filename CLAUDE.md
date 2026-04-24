# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What FlowPR is

Autonomous frontend QA agent. A run accepts a preview URL + flow goal, drives browser evidence (TinyFish + Playwright), diagnoses the failure, patches code, re-verifies, and opens a GitHub PR with before/after proof. The sponsor stack (TinyFish, Redis, InsForge, Guild.ai, Senso, Shipables, Akash, WunderGraph, Chainguard) is treated as product infrastructure — see `README.md` for the role of each. Rule from `skills/flowpr-autonomous-frontend-qa/SKILL.md`: **never claim sponsor usage unless a provider artifact exists** in InsForge.

## Common commands

Everything is pnpm workspaces + Turbo. Run from the repo root unless noted.

```bash
# Dashboard (Next.js, port 3000) — intake UI, sponsor status, run detail
pnpm dev:dashboard

# Demo target app (Next.js, port 3100) — the app under test
pnpm dev:demo

# Worker (Redis consumer, drives the state machine)
pnpm worker:dev        # continuous
pnpm worker:once       # exits when the stream is empty; use in scripts/CI

# Workspace-wide
pnpm typecheck         # tsc --noEmit across every package (all "lint"/"build" also run tsc --noEmit)
pnpm build
pnpm lint

# One package at a time
pnpm --filter @flowpr/dashboard typecheck
pnpm --filter @flowpr/agent dev
```

Demo / smoke / eval scripts (all `tsx` entry points in `scripts/`):

```bash
pnpm demo:break        # rewrites apps/demo-target/app/styles.css z-index to hide Pay button on mobile
pnpm demo:reset        # inverse of demo:break
pnpm demo:start-run    # POSTs to the dashboard /api/runs/start with defaults
pnpm redis:smoke       # asserts streams + consumer groups + locks + memory round-trip
pnpm guild:evaluate    # validates guild-agent.json capabilities + permission profile
pnpm skill:dry-run     # healthcheck for skills/flowpr-autonomous-frontend-qa
```

Demo-target Playwright test (the deterministic repro for the seeded bug — single-file entry):

```bash
pnpm --filter @flowpr/demo-target exec playwright install chromium   # first time only
pnpm --filter @flowpr/demo-target test:checkout                      # runs tests/checkout-mobile.spec.ts on mobile-chromium
```

## Environment

`.env` at the repo root is loaded by `loadLocalEnv()` (`packages/tools/src/env.ts`), which walks upward until it finds one. No dotenv dependency — every entry point that needs env calls `loadLocalEnv()` before reading `process.env`. See `.env.example` for the full list. Required keys: `TINYFISH_API_KEY`, `REDIS_URL`, `INSFORGE_API_URL`, `INSFORGE_ANON_KEY`, `GITHUB_TOKEN`. Either `GUILD_AI_API_KEY` or `GUILD_GITHUB_APP_INSTALLED=true` must be set to pass `guild:evaluate`.

## Architecture

### Event loop (the core contract)

Dashboard intake (`apps/dashboard/app/api/runs/start/route.ts`) writes a row to InsForge `qa_runs` and emits `run.started` on the `flowpr:runs` Redis stream. The worker (`packages/agent/src/worker.ts`) consumes via the `flowpr-workers` consumer group and dispatches to `processRedisEvent` in `packages/agent/src/state-machine.ts`.

The state machine walks this fixed phase order (see `packages/schemas/src/run.ts`):

```
queued → loading_repo → discovering_flows → running_browser_qa →
collecting_visual_evidence → triaging_failure → retrieving_policy →
searching_memory → patching_code → running_local_tests →
running_live_verification → creating_pr → publishing_artifacts →
learned → done
```

After each handler finishes it calls `emitNextStep` which XADDs an `agent.step` event to `flowpr:agent_steps` with the next phase — so transitions are durable, re-drivable, and observable in Redis. The ordering lives in `stateOrder` inside `state-machine.ts`; don't skip phases or add them locally, edit the array + the switch in `handleAgentStep`.

### Redis contracts

All stream/lock/memory keys are centralized in `packages/tools/src/redis.ts`:

- Streams: `flowpr:runs`, `flowpr:agent_steps`, `flowpr:browser_results`, `flowpr:patches`, `flowpr:verification`, `flowpr:dead_letter`
- Locks: `flowpr:locks:{run|patch|pr}:{runId}` — `acquireRedisLock`/`releaseRedisLock`
- Memory: `flowpr:memory:bug-signatures:{hash}`, `flowpr:memory:successful-patches:{hash}`
- Run state hash (snapshot, not the source of truth): `flowpr:run_state:{runId}`

Every handler is wrapped in `startIdempotentOperation(redis, event.dedupeKey)` → complete/fail. Worker failures are retried up to 3 attempts (`worker.ts:maxAttempts`); attempt 3 goes to `flowpr:dead_letter` and writes both a dead-letter timeline event and a `dead_letter_event` provider artifact. When adding a new phase or eventType, also update `FlowPrRedisEventType` and `parseMessage` in `redis.ts`.

### InsForge is the durable system of record

Every side effect in the state machine mirrors Redis activity into InsForge rows through helpers in `packages/tools/src/insforge.ts`: `appendTimelineEvent`, `recordProviderArtifact`, `recordBrowserObservation`, `recordBugHypothesis`, `recordVerificationResult`, `recordActionGate`, `recordBenchmarkEvaluation`, `recordAgentMemory`, `updateRunStatus`, etc. Uploads (screenshots, traces) go through `uploadRunArtifact` to storage bucket `flowpr-artifacts`. Schema lives in `infra/insforge/schema.sql`. InsForge inserts require array payloads (`[{...}]`) — see `AGENTS.md`.

**Pattern**: a new capability typically needs (a) a schema change in `infra/insforge/schema.sql`, (b) a row type + helper in `packages/tools/src/insforge.ts`, (c) a schema type in `packages/schemas/src/run.ts`, and (d) handler calls from `state-machine.ts`. Anything stream-related also needs entries in `redis.ts` (stream name + event type + `parseMessage`) and a branch in `processRedisEvent`.

### Browser QA: three evidence paths

`handleRunningBrowserQa` runs all three against the same preview URL and records each as separate observations/artifacts (`packages/tools/src/tinyfish.ts`, `packages/tools/src/playwright.ts`):

1. `runAgentFlow` — TinyFish Agent API streaming (`client.agent.stream`) with stealth profile + US proxy. Goal prompt built in `buildTinyFishQaGoal` asks for strict JSON. Up to 2 attempts, 120s timeout.
2. `runRemoteBrowserSessionEvidence` — connects Playwright to TinyFish Browser API via CDP (`createBrowserSession` → `chromium.connectOverCDP`), for direct screenshot evidence; always terminates the session in `finally`.
3. `runLocalFlowTest` — local Playwright on a mobile 390×844 viewport, uploads screenshot + trace to InsForge storage.

All three use the shared `exerciseFlow` in `playwright.ts` (pattern-matches on `flowGoal`: pricing/signup/checkout). The mobile viewport 390×844 is load-bearing — the seeded bug only reproduces on mobile.

### Package boundaries

- `packages/schemas` — pure types + helpers. No runtime deps. `FlowPrRun`, `RunStatus`, `RunDetail`, `parseRunStartInput`, `parseGitHubRepoUrl`, artifact key helpers.
- `packages/tools` — every external integration. Barrel `src/index.ts` re-exports everything; the dashboard and agent only ever import from `@flowpr/tools`.
- `packages/agent` — worker + state machine. `src/providers/*.ts` are pure re-exports of `@flowpr/tools` grouped by sponsor; this is a deliberate separation so the agent can later swap providers without touching the state machine.
- `apps/dashboard` — Next.js 15 / React 19. `next.config.ts` sets `transpilePackages: ['@flowpr/schemas', '@flowpr/tools']` because those packages ship `.ts` sources with no build step. API routes under `app/api` pin `runtime = 'nodejs'`.
- `apps/demo-target` — the app under test. `app/styles.css` contains the z-index knob that `demo:break`/`demo:reset` flip.

### TypeScript setup

Shared `tsconfig.base.json` uses `moduleResolution: "Bundler"`, `noEmit: true`, strict mode, and path aliases `@flowpr/schemas` / `@flowpr/tools` → `packages/*/src`. All packages are `"type": "module"`. There is no build output — `typecheck`/`lint`/`build` scripts all run `tsc --noEmit`; the dashboard transpiles workspace packages from source at runtime.

## Guild.ai governance

`guild-agent.json` at the repo root declares the agent identity, `permissionProfile: "draft-pr-only"`, required `capabilities`, and `approvalRequiredFor` gates (protected branch, auth/payment files, >3 files changed). `pnpm guild:evaluate` will fail the build if capabilities are missing or approval gates are removed. `recordActionGate` calls in the state machine (e.g. `tinyfish_live_browser_run`, `redis_patch_lock`, `redis_pr_lock`) are the runtime enforcement surface.

## Runbooks and references

- `docs/phase3-redis-runbook.md` — Redis smoke test, stream inspection, forcing a dead-letter.
- `docs/phase4-tinyfish-browser-qa-runbook.md` — the three-evidence browser QA path.
- `README.md` — sponsor stack and TinyFish/Guild roles.
- `AGENTS.md` — InsForge SDK usage rules (SDK vs. MCP, Tailwind 3.4 lock, array inserts).
- `.codex/mcp-notes.md` — which sponsor MCPs are available and how they authenticate.
