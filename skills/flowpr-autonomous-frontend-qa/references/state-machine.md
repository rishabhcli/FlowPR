# FlowPR State Machine

FlowPR advances a run through a fixed sequence. Each transition is triggered by a Redis `agent.step` event emitted by the previous handler; handlers are idempotent and protected by Redis locks.

```
queued
 → loading_repo
 → discovering_flows
 → running_browser_qa
 → collecting_visual_evidence
 → triaging_failure
 → retrieving_policy
 → searching_memory
 → patching_code
 → running_local_tests
 → running_live_verification
 → creating_pr
 → publishing_artifacts
 → learned
 → done
```

## Side effects by phase

| Phase | Sponsors touched | Typical artifact types |
| --- | --- | --- |
| loading_repo | GitHub, InsForge | `worker_repository_lookup` |
| running_browser_qa | TinyFish, Playwright, InsForge | `browser_flow_test`, `trace_capture` |
| collecting_visual_evidence | InsForge, Redis | `browser_evidence_indexed` |
| triaging_failure | InsForge | `triage_diagnosis` |
| retrieving_policy | Senso, InsForge | `policy_context` |
| searching_memory | Redis, InsForge | `memory_lookup` |
| patching_code | GitHub, Guild.ai, WunderGraph, Redis | `patch_commit`, `action_gate_generate_patch`, `safe_operation_execution` |
| running_local_tests | Playwright, WunderGraph | `local_verification` |
| running_live_verification | TinyFish, WunderGraph | `live_reverification` |
| creating_pr | GitHub, Guild.ai, WunderGraph, Redis | `pull_request`, `action_gate_create_pull_request` |
| publishing_artifacts | Redis, InsForge | `stream_snapshot` |
| learned | Redis, InsForge, Guild.ai | `memory_write`, `agent_session_trace` |

Failure in any phase writes a `flowpr:dead_letter` event after three retries and marks the run `failed` while preserving collected evidence.
