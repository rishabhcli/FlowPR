import type {
  BrowserObservation,
  BugHypothesis,
  PatchRecord,
  PolicyHit,
  PullRequestRecord,
  RunDetail,
  VerificationResult,
} from '@flowpr/schemas';

export interface InvestigationReportInput {
  run: RunDetail['run'];
  browserObservations: BrowserObservation[];
  bugHypotheses: BugHypothesis[];
  patches: PatchRecord[];
  pullRequests: PullRequestRecord[];
  verificationResults: VerificationResult[];
  policyHits: PolicyHit[];
  reason: string;
}

export interface InvestigationReport {
  runId: string;
  generatedAt: string;
  reason: string;
  summary: string;
  markdown: string;
  structured: Record<string, unknown>;
}

function formatList(items: string[]): string {
  if (items.length === 0) return '_none_';
  return items.map((item) => `- ${item}`).join('\n');
}

function shortenCause(value: string | undefined, limit = 240): string | undefined {
  if (!value) return undefined;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

export function buildInvestigationReport(input: InvestigationReportInput): InvestigationReport {
  const primaryFailure = input.browserObservations.find(
    (observation) => observation.status === 'failed' || observation.status === 'errored',
  );
  const latestHypothesis = input.bugHypotheses[input.bugHypotheses.length - 1];
  const hypothesisEvidence = (latestHypothesis?.evidence ?? {}) as Record<string, unknown>;
  const bugType = (hypothesisEvidence.bugType as string | undefined) ?? 'unknown';
  const likelyFiles = Array.isArray(hypothesisEvidence.likelyFiles)
    ? (hypothesisEvidence.likelyFiles as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
  const latestPatch = input.patches[input.patches.length - 1];
  const latestVerification = input.verificationResults[input.verificationResults.length - 1];
  const policyCitations = input.policyHits.slice(0, 5);

  const summary = latestHypothesis
    ? `FlowPR stopped before opening a pull request. Root cause: ${shortenCause(latestHypothesis.suspectedCause) ?? latestHypothesis.summary}`
    : `FlowPR stopped before opening a pull request. Reason: ${input.reason}`;

  const markdown = `# FlowPR investigation report

_${input.run.owner}/${input.run.repo} — run ${input.run.id.slice(0, 8)}_

FlowPR did not open a pull request for this run. This report captures what FlowPR saw so a developer can take over.

## Why FlowPR stopped
${input.reason}

## Flow goal
${input.run.flowGoal}

## Observed failure
${primaryFailure
  ? `- **Provider:** ${primaryFailure.provider}
- **Step:** ${primaryFailure.failedStep ?? '—'}
- **What the user saw:** ${primaryFailure.observedBehavior ?? '—'}
- **Screenshot:** ${primaryFailure.screenshotUrl ?? '—'}
- **Trace:** ${primaryFailure.traceUrl ?? '—'}`
  : '_No failing browser observation was recorded._'}

## Diagnosis
${latestHypothesis
  ? `- **Summary:** ${latestHypothesis.summary}
- **Suspected cause:** ${latestHypothesis.suspectedCause ?? '—'}
- **Severity:** ${latestHypothesis.severity}
- **Confidence:** ${latestHypothesis.confidence}
- **Bug type:** ${bugType.replace(/_/g, ' ')}`
  : '_No diagnosis was recorded before FlowPR stopped._'}

## Likely files to investigate
${formatList(likelyFiles)}

## What FlowPR tried
${latestPatch
  ? `- **Branch:** ${latestPatch.branchName ?? '—'}
- **Commit:** ${latestPatch.commitSha ?? '—'}
- **Patch status:** ${latestPatch.status}
- **Patch summary:** ${latestPatch.summary}`
  : '_No patch was prepared._'}

${latestVerification
  ? `## Last verification
- **Provider:** ${latestVerification.provider}
- **Status:** ${latestVerification.status}
- **Summary:** ${latestVerification.summary}`
  : ''}

## Policy and acceptance criteria
${policyCitations.length > 0
  ? policyCitations
      .map((hit) => `- ${hit.title ?? hit.provider}${hit.summary ? ` — ${hit.summary}` : ''}`)
      .join('\n')
  : '_No policy grounding was recorded._'}

## Suggested next steps
1. Re-run the browser test yourself against ${input.run.previewUrl} on a mobile-sized viewport.
2. Start with the files above and compare the DOM to the failing screenshot.
3. If the fix is small, re-run FlowPR in verified-pr mode to have it prepare and verify the change.

_Generated automatically by FlowPR on ${new Date().toISOString()}._`;

  const structured = {
    runId: input.run.id,
    reason: input.reason,
    bugType,
    likelyFiles,
    hypothesisId: latestHypothesis?.id,
    patchId: latestPatch?.id,
    primaryFailureObservationId: primaryFailure?.id,
    verificationStatus: latestVerification?.status,
    pullRequestCount: input.pullRequests.length,
  };

  return {
    runId: input.run.id,
    generatedAt: new Date().toISOString(),
    reason: input.reason,
    summary,
    markdown,
    structured,
  };
}

export function shouldProduceInvestigationReport(input: {
  pullRequests: PullRequestRecord[];
  browserObservations: BrowserObservation[];
  verificationResults: VerificationResult[];
}): { needed: boolean; reason: string } {
  const hadFailure = input.browserObservations.some(
    (observation) => observation.status === 'failed' || observation.status === 'errored',
  );
  const openedPr = input.pullRequests.some(
    (pr) => pr.status === 'open' || pr.status === 'draft' || pr.status === 'merged',
  );
  const liveVerification = input.verificationResults.find((result) => result.provider === 'tinyfish-live');

  if (!hadFailure) {
    return { needed: false, reason: 'The journey passed — no investigation needed.' };
  }

  if (openedPr) {
    return { needed: false, reason: 'A pull request was opened — the fix is already handed off.' };
  }

  if (liveVerification?.status === 'failed' || liveVerification?.status === 'errored') {
    return {
      needed: true,
      reason: 'Live verification did not pass after the patch, so FlowPR chose not to open a pull request. A human should review the evidence below.',
    };
  }

  return {
    needed: true,
    reason: 'FlowPR could not safely prepare or verify a fix. The run was held for human review.',
  };
}
