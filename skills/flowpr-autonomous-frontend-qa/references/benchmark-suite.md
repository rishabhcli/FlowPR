# Benchmark Suite

The `frontend-bugs` suite gates promotion for each FlowPR agent version. The `runtime-recovery` suite is a non-promotion quality gate for recovery and readiness behavior.

Each fixture must define the full promotion contract:

| Contract area | Required fields |
| --- | --- |
| Scenario | `name`, `flowGoal`, `viewport`, `fixtures.previewUrl` |
| Expected evidence | `expectedEvidence.providers`, `expectedEvidence.artifacts`, `expectedEvidence.signals` |
| Diagnosis | `expectedBugType`, `expectedDiagnosis.bugType`, `expectedDiagnosis.severity`, `expectedDiagnosis.likelyFiles` |
| Patch signature | `expectedPatch.filesChanged`, and `expectedPatch.regressionTest` for critical fixtures |
| Verification | `verification.command`, `verification.testName`, `verification.successCondition` |
| Runtime recovery fixtures | `expectedReadiness.overall`, `expectedReadiness.requiredSignals`, `expectedRecovery.signals`, `expectedRecovery.nextActions`, `expectedRecovery.commands` |

| Fixture | Expected bug type | Risk | Patch signature |
| --- | --- | --- | --- |
| hidden-mobile-cta | blocked_cta | critical | `apps/demo-target/app/styles.css`, checkout regression test |
| signup-route-typo | client_navigation_failure | high | `apps/demo-target/app/signup/page.tsx` |
| keyboard-focus-trap | blocked_cta | high | `apps/demo-target/app/checkout/page.tsx` |
| api-route-404 | network_error | high | `apps/demo-target/app/api/checkout/route.ts` |
| wrong-plan-param | client_navigation_failure | medium | `apps/demo-target/app/page.tsx` |

Runtime recovery fixtures:

| Fixture | Expected issue | Risk | Recovery proof |
| --- | --- | --- | --- |
| stuck-run-recovery | stuck_run | high | stale active run classification plus replay/worker next action |
| dead-letter-next-action | dead_letter_recovery | high | unresolved, historical, and orphaned dead-letter next actions |

The local executable benchmark is `pnpm benchmark:fixtures`. `pnpm guild:evaluate` runs each unique fixture verification command and only promotes the agent version when the fixture contract passes, the command passes, and the named `verification.testName` appears in the command output.

Promotion rule: FlowPR can open non-draft PRs only if the current agent version has passed every fixture in the suite. Otherwise the worker falls back to draft PRs or investigation-only output.

Run the evaluator with:

```bash
pnpm benchmark:fixtures
pnpm benchmark:recovery
pnpm guild:evaluate
pnpm guild:evaluate -- --agent-version 0.2.0 --suite frontend-bugs
pnpm guild:evaluate -- --suite runtime-recovery
```

Results are attached to each FlowPR run as a `benchmark_evaluations` row and reflected in the dashboard.
