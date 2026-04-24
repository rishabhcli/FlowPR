## Inspiration

A lot of frontend bugs are tedious to chase but easy to describe. "Pay button doesn't show up on mobile checkout." A person has to open the preview, reproduce it, poke at the DOM, find the CSS that broke, patch it, and screenshot the before/after for the PR. Most of that is mechanical.

We built FlowPR because an agent can do the mechanical part. Drive the browser, take the screenshots, read the DOM, write a patch, re-run the flow, open the PR. The human still reviews — they just don't start from zero.

## What it does

FlowPR takes a preview URL and a flow goal and returns a draft GitHub PR with evidence.

Given something like "complete checkout on mobile", it reproduces the failure in a real browser, pulls visual and DOM evidence, forms a hypothesis about the broken code, writes a patch, runs the local tests, verifies the flow again against the preview, and opens a draft PR with before/after screenshots and a full timeline of what it did.

The demo ships a deterministic regression: `pnpm demo:break` rewrites a z-index in `apps/demo-target/app/styles.css` so the Pay button disappears on a 390×844 viewport. `pnpm demo:start-run` kicks off a run. The Playwright spec at `apps/demo-target/tests/checkout-mobile.spec.ts` is the same ground truth a human would write, which is what the agent verifies against.

## How we built it

pnpm workspaces + Turbo. Three pieces: a Next.js dashboard for intake and observability, a Redis-driven worker that runs the agent loop, and InsForge as the durable store for everything the agent produces.

The loop is a fixed-order state machine:

```
queued → loading_repo → discovering_flows → running_browser_qa →
collecting_visual_evidence → triaging_failure → retrieving_policy →
searching_memory → patching_code → running_local_tests →
running_live_verification → creating_pr → publishing_artifacts →
learned → done
```

Each handler finishes, XADDs the next `agent.step` onto `flowpr:agent_steps`, and the worker picks it up. If a worker dies mid-run, the next one resumes off the stream. Handlers are wrapped in `startIdempotentOperation` keyed by `dedupeKey`, so retries don't double-apply. Failed events retry up to 3 times; the third failure goes to `flowpr:dead_letter` with both a timeline event and a provider artifact, so the dashboard can show the failure with the same fidelity as a success.

For browser evidence we run three paths against the same preview URL:

1. TinyFish Agent API with a stealth profile and US proxy, via `client.agent.stream`.
2. TinyFish Browser API connected to Playwright over CDP, for direct remote screenshots.
3. Local Playwright at 390×844 with trace capture, uploaded to InsForge storage.

Each one records a separate observation. If they disagree, that disagreement is visible in the run detail — we didn't want a single screenshot to be the whole story.

InsForge is the system of record. Every side effect — timeline event, browser observation, bug hypothesis, verification result, action gate, provider artifact — goes through helpers in `packages/tools/src/insforge.ts`. Screenshots and traces upload to the `flowpr-artifacts` bucket. The schema lives in `infra/insforge/schema.sql` and the row types live alongside the helpers.

Guild.ai handles governance. `guild-agent.json` pins the permission profile to `draft-pr-only`, declares required capabilities, and lists `approvalRequiredFor` gates (protected branches, auth/payment files, more than 3 files changed). `pnpm guild:evaluate` fails the build if any of that drifts. `recordActionGate` calls in the state machine — `tinyfish_live_browser_run`, `redis_patch_lock`, `redis_pr_lock` — are the runtime enforcement.

There's a house rule we enforce in the skill definition: don't claim a sponsor was used unless there's a provider artifact for it in InsForge. The dashboard reads the artifact rows directly, so the sponsor list on a run is never aspirational.

## Challenges we ran into

**Agent evidence has to be worth trusting.** One screenshot is trivial to misread. Running three browser paths per run and attributing each artifact to the provider that produced it made the evidence something a reviewer can actually weigh.

**Ordering vs. parallelism.** The state machine has to be strictly ordered so the timeline is auditable, but the three browser paths want to run in parallel. We kept the ordering in one place (`stateOrder` in `state-machine.ts`) and let handlers fan out internally. `emitNextStep` is the only way a phase advances, which keeps the timeline linear even when the work isn't.

**The demo bug had to be real.** A contrived "flip a boolean and the agent finds it" demo wouldn't have told us anything. A z-index regression that only reproduces at a specific mobile viewport, verified by an actual Playwright spec, is a real thing to repro and a real thing to fix.

**Dead letters, not silent failures.** The first version dropped retry-exhausted events. The current version writes a dead-letter timeline entry and a provider artifact, which made the agent itself debuggable.

**Governance shaped the product.** `draft-pr-only` plus the approval gates meant we had to assume from day one that the agent cannot merge, cannot push to protected branches, and cannot touch auth or payment files without a human gate. That constraint made everything downstream simpler.

## Accomplishments that we're proud of

The loop works end to end on the demo. Preview URL in, draft PR out, with screenshots and traces attached and a timeline in InsForge that a reviewer can scroll through.

`pnpm guild:evaluate` runs in CI. Governance is executable config, not a policy doc.

Dead-lettered runs render in the dashboard the same way successful ones do, which turned out to matter more than we expected while we were building the agent itself.

## What we learned

Most of the work wasn't the agent. It was the surface around it — the state machine, the streams, the locks, the idempotency keys, the artifact schema, the governance config. Skip any of those and you have a demo, not something you'd trust with a PR.

Durability is the thing that earns trust. Redis streams plus InsForge rows plus a strictly ordered state machine means any run can be replayed, re-driven, and audited. It's boring, and that's why it works.

The right shape for this kind of agent is a draft PR with proof, not a merge. The agent compresses the grunt work before review. It doesn't replace the reviewer.

## What's next

- Flow discovery. `exerciseFlow` currently pattern-matches on pricing / signup / checkout. Next step is letting the agent discover flows from a sitemap plus a goal description.
- Using the memory we already store. `flowpr:memory:bug-signatures:*` and `flowpr:memory:successful-patches:*` exist; we want them retrieved during `patching_code` so similar past fixes actually influence the patch.
- More approval gates — schema migrations, infra files, dependency bumps — and per-repo permission profiles.
- Multi-repo runs that coordinate evidence across services and open linked PRs.
- Continuous benchmarking. `recordBenchmarkEvaluation` is in the schema but not yet on a loop. Running it against a held-out set of seeded bugs would score every state-machine change against the same ground truth.

The goal is for FlowPR to be the first responder on a frontend regression — it does the boring part, and hands the human a PR they can decide on in a minute.
