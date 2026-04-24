import {
  createGitHubPullRequest,
  findOpenPullRequestForHead,
  pushBranch,
  type PullRequestSummary,
} from '@flowpr/tools';
import type { TriageOutput } from './visual-triage';
import type { GenerateDemoPatchResult } from './patcher';
import type { LocalVerificationResult } from './verifier';
import type { LiveVerificationResult } from './live-verifier';

export interface PullRequestContextInput {
  runId: string;
  owner: string;
  repo: string;
  baseBranch: string;
  previewUrl: string;
  flowGoal: string;
  triage: TriageOutput;
  patch: GenerateDemoPatchResult;
  localVerification: LocalVerificationResult;
  liveVerification?: LiveVerificationResult;
  tinyfishRunId?: string;
  traceUrl?: string;
  beforeScreenshotUrl?: string;
  afterScreenshotUrl?: string;
  policyCitations: Array<{ title: string; url?: string; excerpt?: string }>;
  guildSessionTraceUrl?: string;
  guildSessionId?: string;
  gateDecision?: { decision: string; reason: string; providerDecisionId: string; requiresApproval: boolean };
  draft?: boolean;
}

export interface PullRequestOutcome {
  summary: PullRequestSummary;
  body: string;
  prBranch: string;
  pushed: boolean;
}

function renderVerificationTable(result: LocalVerificationResult): string {
  const rows = result.steps.map(
    (step) => `| ${step.step} | ${step.status} | \`${step.command}\` | ${Math.round(step.durationMs / 1000)}s |`,
  );

  return ['| Step | Status | Command | Duration |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function renderPolicySection(citations: PullRequestContextInput['policyCitations']): string {
  if (!citations.length) return '_No Senso policy citations were retrieved; fallback policy applied._';

  return citations
    .slice(0, 5)
    .map((citation) => {
      const title = citation.url ? `[${citation.title}](${citation.url})` : citation.title;
      return `- ${title}${citation.excerpt ? ` — ${citation.excerpt}` : ''}`;
    })
    .join('\n');
}

function renderFilesChanged(patch: GenerateDemoPatchResult): string {
  if (patch.plan.files.length === 0) return '_No files changed._';

  return patch.plan.files
    .map((file) => `- \`${file.path}\` (${file.action}) — ${file.summary}`)
    .join('\n');
}

function renderLiveVerification(result: LiveVerificationResult | undefined): string {
  if (!result) return '_Live re-verification not executed._';

  return `Status: **${result.status}**\nAttempts: ${result.attempts}\nSummary: ${result.summary}`;
}

export function renderPullRequestBody(input: PullRequestContextInput): string {
  return `# FlowPR fix: ${input.triage.bugType.replace(/_/g, ' ')}

FlowPR detected and repaired \`${input.triage.bugType}\` on flow _${input.flowGoal}_.

## What FlowPR tested
- Preview URL: \`${input.previewUrl}\`
- Flow goal: ${input.flowGoal}
- Viewport: mobile 390x844
- TinyFish run: ${input.tinyfishRunId ? `\`${input.tinyfishRunId}\`` : '_not recorded_'}

## Root cause
${input.triage.hypothesis}

Suspected cause: ${input.triage.suspectedCause}

## Evidence before fix
- Before screenshot: ${input.beforeScreenshotUrl ? `[screenshot](${input.beforeScreenshotUrl})` : '_not captured_'}
- Playwright trace: ${input.traceUrl ? `[trace](${input.traceUrl})` : '_not captured_'}
- Confidence: ${input.triage.confidence} (${Math.round(input.triage.confidenceScore * 100)}%)

## What changed
Branch: \`${input.patch.plan.branchName}\`
Commit: \`${input.patch.commitSha}\`

${renderFilesChanged(input.patch)}

Diff stats: ${input.patch.diffStat.filesChanged} files changed (+${input.patch.diffStat.insertions} / −${input.patch.diffStat.deletions}).

## Local verification

${renderVerificationTable(input.localVerification)}

Overall: **${input.localVerification.overallStatus}** — ${input.localVerification.summary}

## Live re-verification
${renderLiveVerification(input.liveVerification)}
After screenshot: ${input.afterScreenshotUrl ? `[screenshot](${input.afterScreenshotUrl})` : '_not captured_'}

## Policy & acceptance criteria
${renderPolicySection(input.policyCitations)}

## Governance
- Guild.ai session: ${input.guildSessionId ? `\`${input.guildSessionId}\`` : '_unscoped_'}
- Gate decision: ${input.gateDecision ? `**${input.gateDecision.decision}** — ${input.gateDecision.reason}` : '_n/a_'}
- Trace: ${input.guildSessionTraceUrl ?? '_local trace only_'}

## Rollback
Revert this PR. No database migrations or irreversible operations are included.

_Generated autonomously by FlowPR._`;
}

export async function createPullRequestForRun(input: PullRequestContextInput): Promise<PullRequestOutcome> {
  const body = renderPullRequestBody(input);
  const head = input.patch.plan.branchName;
  let pushed = false;

  try {
    await pushBranch({ dir: input.patch.workspace.dir, branchName: head });
    pushed = true;
  } catch (error) {
    // Fall through — may be push-blocked (protected branch, wrong remote perms); we still try to find an existing PR.
    pushed = false;
    console.warn('pushBranch failed; continuing to PR creation fallback.', error instanceof Error ? error.message : error);
  }

  const existing = await findOpenPullRequestForHead({
    owner: input.owner,
    repo: input.repo,
    head,
    base: input.baseBranch,
  });

  if (existing) {
    return { summary: existing, body, prBranch: head, pushed };
  }

  if (!pushed) {
    throw new Error(`Branch ${head} was not pushed and no existing PR was found; refusing to fabricate a GitHub PR record.`);
  }

  const summary = await createGitHubPullRequest({
    owner: input.owner,
    repo: input.repo,
    title: `FlowPR fix: ${input.triage.bugType.replace(/_/g, ' ')} on ${input.previewUrl}`,
    body,
    head,
    base: input.baseBranch,
    draft: Boolean(input.draft),
  });

  return { summary, body, prBranch: head, pushed };
}
