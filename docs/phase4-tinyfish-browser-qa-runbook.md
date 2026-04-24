# Phase 4 TinyFish Browser QA Runbook

Phase 4 runs the requested frontend flow through three evidence paths:

- TinyFish Agent API streaming run with stealth browser, US proxy, live progress, and strict JSON findings.
- TinyFish Browser API CDP session driven by Playwright for direct screenshot evidence.
- Local Playwright mobile trace capture for deterministic repros and InsForge artifact upload.

## Required Environment

Set these before running the worker:

```bash
TINYFISH_API_KEY=...
INSFORGE_BASE_URL=...
INSFORGE_ANON_KEY=...
REDIS_URL=...
```

## Local Verification

```bash
pnpm --filter @flowpr/demo-target exec playwright install chromium
pnpm typecheck
pnpm phase4:checkout-test
```

The demo checkout test is expected to fail while the target bug is present because the mobile cookie banner covers the fixed Pay now CTA. FlowPR stores the same kind of failure as a `browser_observations` row with screenshot and trace links in InsForge.

## Live Flow

Start the dashboard and worker, then create a run from the dashboard using a public preview URL:

```bash
pnpm dev:dashboard
pnpm worker:dev
```

The dashboard should show:

- TinyFish `browser_flow_test` provider artifact with run ID and streaming URL when returned.
- TinyFish `browser_session_created` and `browser_session_screenshot` artifacts.
- Playwright `trace_capture` artifact with screenshot and trace URLs.
- Browser evidence cards with provider, status, failed step, visible error, screenshot, and trace.
- A `phase4_tinyfish_live_browser_qa` benchmark evaluation.
