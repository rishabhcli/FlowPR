# Guild.ai Agent Descriptor

FlowPR registers itself as:

```json
{
  "agent": "flowpr-autonomous-frontend-qa",
  "version": "1.0.0",
  "owner": "FlowPR",
  "permissionProfile": "draft-pr-only",
  "capabilities": [
    "browser_evidence",
    "repo_read",
    "patch_generation",
    "local_verification",
    "draft_pull_request"
  ],
  "approvalRequiredFor": [
    "private_repository",
    "protected_branch",
    "auth_or_payment_file",
    "more_than_three_files_changed"
  ]
}
```

## Permission profiles

| Profile | PR mode | Risk allowances |
| --- | --- | --- |
| `investigation-only` | no PR | Browser evidence + triage only |
| `draft-pr-only` | draft PR | Up to 3 files changed, no auth/payment files |
| `verified-pr` | open PR | Passing live verification required |

## Action gates

`generate_patch`, `push_branch`, `create_pull_request`, `live_verification`, and `close_session` are all gated. Each gate decision is recorded in InsForge as an `action_gates` row and mirrored as a `provider_artifacts` entry with sponsor `guildai`.
