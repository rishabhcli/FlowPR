import type {
  BrowserObservation,
  BugHypothesis,
  PatchRecord,
  PolicyHit,
  PullRequestRecord,
  RunDetail,
  VerificationResult,
} from '@flowpr/schemas';
import {
  hasPullRequestArtifact,
  isLocalPreviewUrl,
  isRemoteLocalhostReachabilityObservation,
  isBlockedPullRequestAttempt,
} from '@flowpr/schemas';
import { pickPrimaryFailureObservation } from './visual-triage';

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

function tableCell(value: unknown): string {
  if (value == null || value === '') return 'not recorded';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function yesNo(value: boolean): string {
  return value ? 'complete' : 'missing';
}

function shortenCause(value: string | undefined, limit = 240): string | undefined {
  if (!value) return undefined;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 1)}…`;
}

function valueFromArtifact(artifacts: Record<string, unknown>[] | undefined, keys: string[]): string | undefined {
  for (const artifact of artifacts ?? []) {
    for (const key of keys) {
      const value = artifact[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function formatDiffStat(patch: PatchRecord | undefined): string {
  if (!patch) return '_No patch diff was recorded._';

  const filesChanged = Number(patch.diffStat.filesChanged ?? patch.filesChanged.length);
  const insertions = Number(patch.diffStat.insertions ?? 0);
  const deletions = Number(patch.diffStat.deletions ?? 0);

  if (Number.isFinite(filesChanged) && Number.isFinite(insertions) && Number.isFinite(deletions)) {
    return `${filesChanged} files changed (+${insertions} / -${deletions})`;
  }

  return tableCell(JSON.stringify(patch.diffStat));
}

function formatChangedFiles(patch: PatchRecord | undefined): string {
  if (!patch || patch.filesChanged.length === 0) return '_No changed-file metadata was recorded._';

  return patch.filesChanged.map((file) => {
    const path = typeof file.path === 'string' ? file.path : 'unknown file';
    const action = typeof file.action === 'string' ? file.action : 'changed';
    const summary = typeof file.summary === 'string' ? file.summary : 'no summary recorded';
    return `- \`${path}\` (${action}) — ${summary}`;
  }).join('\n');
}

function verificationSteps(result: VerificationResult | undefined): Record<string, unknown>[] {
  if (!result) return [];

  if (Array.isArray(result.raw?.steps)) {
    return result.raw.steps.filter((step): step is Record<string, unknown> =>
      typeof step === 'object' && step != null,
    );
  }

  if (Array.isArray(result.artifacts) && result.artifacts.length > 0) {
    return result.artifacts;
  }

  if (result.testCommand) {
    return [{ step: result.provider, status: result.status, command: result.testCommand }];
  }

  return [];
}

function formatVerificationTable(result: VerificationResult | undefined): string {
  if (!result) return '_No verification result was recorded._';

  const steps = verificationSteps(result);
  if (steps.length === 0) {
    return `Overall: **${result.status}** — ${result.summary}`;
  }

  return [
    '| Step | Status | Command | Duration |',
    '| --- | --- | --- | --- |',
    ...steps.map((step) => {
      const label = step.step ?? result.provider;
      const status = step.status ?? result.status;
      const command = step.command ?? result.testCommand ?? 'not recorded';
      const durationMs = Number(step.durationMs ?? 0);
      const duration = Number.isFinite(durationMs) && durationMs > 0
        ? `${Math.round(durationMs / 1000)}s`
        : 'not recorded';
      return `| ${tableCell(label)} | ${tableCell(status)} | \`${tableCell(command)}\` | ${tableCell(duration)} |`;
    }),
    '',
    `Overall: **${result.status}** — ${result.summary}`,
  ].join('\n');
}

function gateFromBlockedPullRequest(pullRequest: PullRequestRecord | undefined): Record<string, unknown> | undefined {
  const gate = pullRequest?.raw?.gate;
  if (gate && typeof gate === 'object' && !Array.isArray(gate)) {
    return gate as Record<string, unknown>;
  }
  return undefined;
}

function formatGate(gate: Record<string, unknown> | undefined): string {
  if (!gate) return '_No Guild.ai PR gate decision was recorded._';

  const decision = gate.decision ?? 'unknown';
  const reason = gate.reason ?? 'no reason recorded';
  const providerDecisionId = gate.providerDecisionId ?? 'not recorded';
  const permissionProfile = gate.permissionProfile ?? 'not recorded';

  return [
    `- **Decision:** ${decision}`,
    `- **Reason:** ${reason}`,
    `- **Provider decision ID:** \`${providerDecisionId}\``,
    `- **Permission profile:** ${permissionProfile}`,
  ].join('\n');
}

function formatEvidenceChecklist(input: {
  primaryFailure?: BrowserObservation;
  localVerification?: VerificationResult;
  liveVerification?: VerificationResult;
  policyHitCount: number;
  previewUrl: string;
  gate?: Record<string, unknown>;
}): string {
  const beforeScreenshot = input.primaryFailure?.screenshotUrl ?? input.primaryFailure?.screenshotKey;
  const trace = input.primaryFailure?.traceUrl ?? input.primaryFailure?.traceKey;
  const afterScreenshot = valueFromArtifact(input.liveVerification?.artifacts, ['screenshotUrl', 'screenshotKey', 'artifactUrl']);
  const localProofFallback = !afterScreenshot
    && isLocalPreviewUrl(input.previewUrl)
    && input.localVerification?.status === 'passed'
    && input.liveVerification?.status === 'passed';
  const afterProofDetail = afterScreenshot ?? (
    localProofFallback
      ? `Localhost live verification used local proof fallback: ${input.liveVerification?.summary}`
      : undefined
  );

  const checks = [
    { label: 'Before screenshot', complete: Boolean(beforeScreenshot), detail: beforeScreenshot },
    { label: 'Playwright trace', complete: Boolean(trace), detail: trace },
    { label: 'After screenshot / local proof', complete: Boolean(afterScreenshot) || localProofFallback, detail: afterProofDetail },
    {
      label: 'Local verification',
      complete: input.localVerification?.status === 'passed',
      detail: input.localVerification?.summary,
    },
    {
      label: 'Live re-verification',
      complete: input.liveVerification?.status === 'passed',
      detail: input.liveVerification?.summary,
    },
    { label: 'Policy context', complete: input.policyHitCount > 0, detail: `${input.policyHitCount} citation(s)` },
    { label: 'Guild.ai gate', complete: Boolean(input.gate), detail: input.gate?.reason },
  ];

  return [
    '| Evidence | Status | Detail |',
    '| --- | --- | --- |',
    ...checks.map((check) => `| ${check.label} | ${yesNo(check.complete)} | ${tableCell(check.detail)} |`),
  ].join('\n');
}

export function buildInvestigationReport(input: InvestigationReportInput): InvestigationReport {
  const generatedAt = new Date().toISOString();
  const primaryFailure = pickPrimaryFailureObservation(input.browserObservations, input.run.previewUrl);
  const remoteReachabilityFailures = input.browserObservations.filter((observation) =>
    isRemoteLocalhostReachabilityObservation(input.run.previewUrl, observation),
  );
  const latestHypothesis = input.bugHypotheses[input.bugHypotheses.length - 1];
  const hypothesisEvidence = (latestHypothesis?.evidence ?? {}) as Record<string, unknown>;
  const bugType = (hypothesisEvidence.bugType as string | undefined) ?? 'unknown';
  const likelyFiles = Array.isArray(hypothesisEvidence.likelyFiles)
    ? (hypothesisEvidence.likelyFiles as unknown[]).filter((value): value is string => typeof value === 'string')
    : [];
  const latestPatch = input.patches[input.patches.length - 1];
  const localVerification = input.verificationResults.find((result) => result.provider === 'local');
  const liveVerification = input.verificationResults.find((result) => result.provider === 'tinyfish-live');
  const latestVerification = liveVerification ?? localVerification ?? input.verificationResults[input.verificationResults.length - 1];
  const policyCitations = input.policyHits.slice(0, 5);
  const openedPullRequests = input.pullRequests.filter(hasPullRequestArtifact);
  const blockedPullRequestAttempts = input.pullRequests.filter(isBlockedPullRequestAttempt);
  const blockedPullRequestAttempt = blockedPullRequestAttempts[blockedPullRequestAttempts.length - 1];
  const gate = gateFromBlockedPullRequest(blockedPullRequestAttempt);
  const verifiedButGated = openedPullRequests.length === 0
    && blockedPullRequestAttempts.length > 0
    && (liveVerification ?? latestVerification)?.status === 'passed';

  const evidenceChecklist = formatEvidenceChecklist({
    primaryFailure,
    localVerification,
    liveVerification,
    policyHitCount: policyCitations.length,
    previewUrl: input.run.previewUrl,
    gate,
  });

  const summary = verifiedButGated
    ? `Verified patch ready; pull request was held by the action gate. ${input.reason}`
    : latestHypothesis
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

${remoteReachabilityFailures.length > 0
  ? `## Remote browser reachability note
${formatList(remoteReachabilityFailures.map((observation) =>
    `${observation.provider} could not reach ${input.run.previewUrl} (${observation.failedStep ?? 'unknown step'}). This is preserved as provider context, not the primary app failure.`,
  ))}`
  : ''}

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

## Evidence completeness
${evidenceChecklist}

## Patch packet
${latestPatch
  ? `- **Branch:** ${latestPatch.branchName ?? '—'}
- **Commit:** ${latestPatch.commitSha ?? '—'}
- **Patch status:** ${latestPatch.status}
- **Patch summary:** ${latestPatch.summary}
- **Diff stats:** ${formatDiffStat(latestPatch)}`
  : '_No patch was prepared._'}

${formatChangedFiles(latestPatch)}

## Local verification
${formatVerificationTable(localVerification)}

## Live re-verification
${formatVerificationTable(liveVerification)}

## Policy and acceptance criteria
${policyCitations.length > 0
  ? policyCitations
      .map((hit) => `- ${hit.title ?? hit.provider}${hit.summary ? ` — ${hit.summary}` : ''}`)
      .join('\n')
  : '_No policy grounding was recorded._'}

## Governance
${formatGate(gate)}

## Residual risk
${verifiedButGated
  ? 'The patch was verified, but PR creation was intentionally held by the configured action gate.'
  : 'A human should review the incomplete evidence above before creating or merging a PR.'}

## Rollback
Revert the patch branch or commit above. No database migrations or irreversible operations are included.

## Suggested next steps
1. Re-run the browser test yourself against ${input.run.previewUrl} on a mobile-sized viewport.
2. Start with the files above and compare the DOM to the failing screenshot.
3. If the fix is small, re-run FlowPR in verified-pr mode to have it prepare and verify the change.

_Generated automatically by FlowPR on ${generatedAt}._`;

  const structured = {
    runId: input.run.id,
    reason: input.reason,
    bugType,
    likelyFiles,
    hypothesisId: latestHypothesis?.id,
    patchId: latestPatch?.id,
    primaryFailureObservationId: primaryFailure?.id,
    primaryFailureProvider: primaryFailure?.provider,
    remoteReachabilityObservationIds: remoteReachabilityFailures.map((observation) => observation.id),
    localVerificationStatus: localVerification?.status,
    liveVerificationStatus: liveVerification?.status,
    pullRequestCount: input.pullRequests.length,
    openedPullRequestCount: openedPullRequests.length,
    blockedPullRequestAttemptCount: blockedPullRequestAttempts.length,
    gateDecision: gate?.decision,
    evidenceChecklist,
  };

  return {
    runId: input.run.id,
    generatedAt,
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
    (pr) => hasPullRequestArtifact(pr) && (pr.status === 'open' || pr.status === 'draft' || pr.status === 'merged'),
  );
  const blockedPrAttempt = input.pullRequests.find(isBlockedPullRequestAttempt);
  const liveVerification = input.verificationResults.find((result) => result.provider === 'tinyfish-live');

  if (!hadFailure) {
    return { needed: false, reason: 'The journey passed — no investigation needed.' };
  }

  if (openedPr) {
    return { needed: false, reason: 'A pull request was opened — the fix is already handed off.' };
  }

  if (blockedPrAttempt && liveVerification?.status === 'passed') {
    const gate = (blockedPrAttempt.raw?.gate ?? {}) as { reason?: unknown };
    const gateReason = typeof gate.reason === 'string'
      ? gate.reason.replace(/[.!?]+$/, '')
      : 'the configured action gate blocked PR creation';
    return {
      needed: true,
      reason: `Local and live verification passed, but FlowPR did not open a pull request because ${gateReason}. This report is the human handoff packet.`,
    };
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
