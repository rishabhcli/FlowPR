# FlowPR

FlowPR is an autonomous frontend QA engineer for developers and software teams. It opens a real version of an app, tests an important user flow, captures visual evidence, diagnoses the failure, prepares a focused code change, verifies the fix, and opens a GitHub pull request with proof when the configured action gates allow it.

## Run it locally

### Prerequisites

- Node.js 20+ and `pnpm` 10
- A Redis instance reachable at `REDIS_URL` (local: `brew install redis && brew services start redis`)
- API keys in `.env` (copy from `.env.example`). The run loop needs, at minimum:
  - `TINYFISH_API_KEY` — browser runner
  - `REDIS_URL` — event stream + locks + heartbeats
  - `INSFORGE_API_URL` + `INSFORGE_ANON_KEY` — durable store for runs, observations, artifacts
  - `GITHUB_TOKEN` — PR creation
  - Either `GUILD_AI_API_KEY` or `GUILD_GITHUB_APP_INSTALLED=true` — governance gates
- Optional but recommended: `SENSO_API_KEY` (policy retrieval), `WUNDERGRAPH_API_KEY` (safelisted operations).

### Install

```bash
git clone https://github.com/rishabhcli/FlowPR.git
cd FlowPR
pnpm install
cp .env.example .env   # then fill in keys
```

### Start the stack

Three long-running processes. Open each in its own terminal:

```bash
pnpm dev:dashboard     # Next.js UI on http://localhost:3000
pnpm worker:dev        # Redis consumer that drives the state machine
pnpm dev:demo          # optional: seeded target app on http://localhost:3100
```

Dashboard pages:
- `/` — Command Center (start runs, watch live state)
- `/runs/[id]` — full run detail with phase stepper, before/after, TinyFish live iframe, SSE-driven progress feed
- `/demo` — presenter view
- `/health` — env readiness, sponsor pings, Redis streams, worker heartbeats, dead-letter queue

### Kick off a run

Either click **Start autonomous run** on the dashboard, or fire a request directly:

```bash
curl -s -X POST http://localhost:3000/api/runs/start \
  -H 'Content-Type: application/json' \
  -d '{
    "repoUrl": "https://github.com/<owner>/<repo>",
    "previewUrl": "https://your-preview.example.com",
    "baseBranch": "main",
    "flowGoal": "On mobile, complete the checkout flow and reach the success screen.",
    "riskLevel": "medium"
  }'
```

Then open the returned run id at `http://localhost:3000/runs/<id>`. The TinyFish live iframe appears within a few seconds of the `running_browser_qa` phase. For localhost previews, remote TinyFish may record a reachability failure; FlowPR preserves that provider evidence while using local Playwright screenshots and traces as the actionable proof source.

### Smoke tests + eval

```bash
pnpm redis:smoke         # asserts streams, consumer groups, locks, memory
pnpm run:replay          # reconstructs the latest run from InsForge/local store + Redis runtime state
pnpm run:replay -- --fail-on-not-ready  # exits nonzero when latest run readiness is missing/partial
pnpm demo:preflight      # runs Redis, evidence, PR packet, recovery, skill, health, and replay readiness gates
pnpm evidence:integrity  # checks evidence rows have matching provider artifacts
pnpm pr:packet-smoke     # checks gate-held handoff reports keep the PR evidence packet shape
pnpm recovery:smoke      # checks stuck-run and dead-letter recovery guidance
pnpm benchmark:fixtures  # executes the frontend-bugs Playwright benchmark fixtures
pnpm benchmark:recovery  # evaluates runtime-recovery benchmark fixtures through Guild.ai
pnpm guild:evaluate      # validates Guild metadata and runs benchmark verification before promotion
pnpm typecheck           # tsc --noEmit across every package
pnpm --filter @flowpr/dashboard build   # production build
```

### Demo loop against the seeded bug

```bash
pnpm demo:break          # hides the Pay button on mobile via a z-index swap
pnpm demo:start-run      # POSTs to /api/runs/start with defaults
pnpm run:replay          # summarize the latest run, evidence, gates, progress, and debug pointers
# watch the run progress on http://localhost:3000
pnpm demo:reset          # restore the demo-target app
```

## Sponsor Stack

FlowPR uses sponsors as product infrastructure, not as logo badges. TinyFish is the largest visible product integration because FlowPR's core promise depends on real browser execution:

- **TinyFish:** the primary live-browser engine. It runs the target user flow, reproduces frontend failures, captures screenshots and browser evidence, and reruns the flow after a patch to prove the fix worked.
- **Redis:** event-driven autonomous run state, retries, locks, and short-term bug memory.
- **InsForge:** durable system of record for runs, observations, artifacts, patches, and PR metadata.
- **WunderGraph:** safelisted operations for controlled agent actions.
- **Guild.ai:** agent control plane for FlowPR versions, permission profiles, session traces, action gates, benchmark promotion, and rollback readiness.
- **Senso:** product specs, QA policy, accessibility rules, and PR-writing context.
- **Shipables:** reusable FlowPR agent skill package.
- **Chainguard:** secure Node container and SBOM evidence.
- **Akash:** public deployment path through SDL.

GitHub and Playwright are essential product infrastructure, but they are not treated as sponsor tools.

## TinyFish Role

TinyFish gives FlowPR eyes and hands in the browser. FlowPR should not feel like a static code analyzer guessing from files; it should feel like an autonomous QA engineer using the app the way a customer would.

TinyFish powers the main product loop:

- run the first live browser test against the preview URL
- reproduce the bug at the correct viewport, especially mobile
- capture before screenshots, DOM evidence, console errors, network errors, and failed steps
- provide provider IDs/session IDs for the evidence panel
- rerun the same flow after the code patch when the preview is publicly reachable
- capture after screenshots and verification proof, or record an honest localhost reachability skip backed by local verification
- feed the PR or human-handoff evidence packet with browser results

The demo should make provider truth obvious: show the TinyFish live attempt first, then the actionable Playwright failure proof, then local verification passing. On public previews, TinyFish can also provide after-fix live verification. On localhost previews, the dashboard should explain the remote reachability limitation instead of pretending TinyFish verified the local URL.

## Guild.ai Role

Guild.ai is a first-class part of the product, not a CLI wrapper. It governs the FlowPR agent itself:

- which FlowPR agent version ran
- which permission profile was active
- which tool calls and actions happened
- which patch and PR gates were allowed or denied
- whether the agent version passed the frontend bug benchmark suite

The demo should show Guild.ai proof before PR handoff: agent version, benchmark status, session trace, and the action-gate decision. If the profile is `investigation-only`, FlowPR should produce a human handoff report instead of claiming a PR was opened.
