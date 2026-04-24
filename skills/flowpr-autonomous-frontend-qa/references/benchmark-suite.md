# Benchmark Suite

The `frontend-bugs` suite gates promotion for each FlowPR agent version.

| Fixture | Expected bug type | Risk |
| --- | --- | --- |
| hidden-mobile-cta | blocked_cta | critical |
| signup-route-typo | client_navigation_failure | high |
| keyboard-focus-trap | blocked_cta | high |
| api-route-404 | network_error | high |
| wrong-plan-param | client_navigation_failure | medium |

Promotion rule: FlowPR can open non-draft PRs only if the current agent version has passed every fixture in the suite. Otherwise the worker falls back to draft PRs or investigation-only output.

Run the evaluator with:

```bash
pnpm guild:evaluate
```

Results are attached to each FlowPR run as a `benchmark_evaluations` row and reflected in the dashboard.
