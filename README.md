# FlowPR

FlowPR is an autonomous frontend QA engineer for developers and software teams. It opens a real version of an app, tests an important user flow, captures visual evidence, diagnoses the failure, prepares a focused code change, verifies the fix, and opens a GitHub pull request with proof.

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
- rerun the same flow after the code patch
- capture after screenshots and verification proof
- feed the PR evidence packet with before/after browser results

The demo should make TinyFish obvious: show the live browser failure first, then show TinyFish verification passing after the fix.

## Guild.ai Role

Guild.ai is a first-class part of the product, not a CLI wrapper. It governs the FlowPR agent itself:

- which FlowPR agent version ran
- which permission profile was active
- which tool calls and actions happened
- which patch and PR gates were allowed or denied
- whether the agent version passed the frontend bug benchmark suite

The demo should show Guild.ai proof before the PR is opened: agent version, benchmark status, session trace, and action-gate approval.
