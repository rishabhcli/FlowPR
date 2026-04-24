# FlowPR PR Template

Every PR is rendered from stored evidence, not hand-written. Sections below must be present whenever FlowPR opens a PR.

```md
# FlowPR fix: {bug_type}

FlowPR detected and repaired `{bug_type}` on flow _{flow_goal}_.

## What FlowPR tested
- Preview URL: `{preview_url}`
- Flow goal: {flow_goal}
- Viewport: {viewport}
- TinyFish run: `{tinyfish_run_id}`

## Root cause
{hypothesis}

Suspected cause: {suspected_cause}

## Evidence before fix
- Before screenshot: {before_screenshot_url}
- Playwright trace: {trace_url}
- Confidence: {confidence_label} ({confidence_score})

## What changed
Branch: `{branch_name}`
Commit: `{commit_sha}`

{files_changed_list}

Diff stats: {files_changed_count} files changed (+{insertions} / −{deletions}).

## Local verification

{verification_table}

Overall: **{overall_status}** — {summary}

## Live re-verification
Status: **{live_status}** (attempts: {live_attempts})
Summary: {live_summary}

## Policy & acceptance criteria
{senso_citations}

## Governance
- Guild.ai session: `{guild_session_id}`
- Gate decision: **{gate_decision}** — {gate_reason}

## Rollback
Revert this PR. No database migrations or irreversible operations are included.
```
