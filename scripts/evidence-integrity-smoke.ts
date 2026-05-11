import assert from 'node:assert/strict';
import {
  validateRunEvidenceIntegrity,
  type BrowserObservation,
  type EvidenceIntegrityIssue,
  type ProviderArtifact,
  type PullRequestRecord,
  type RunDetail,
  type VerificationResult,
} from '@flowpr/schemas';
import { summarizeRunReadiness } from '@flowpr/tools/readiness';

const runId = 'evidence-integrity-smoke-run';
const now = '2026-05-11T12:00:00.000Z';

function providerArtifact(
  input: Pick<ProviderArtifact, 'id' | 'sponsor' | 'artifactType'> & Partial<ProviderArtifact>,
): ProviderArtifact {
  return {
    runId,
    requestSummary: {},
    responseSummary: {},
    createdAt: now,
    ...input,
  };
}

function expectSingleIssue(
  issues: EvidenceIntegrityIssue[],
  expected: Pick<EvidenceIntegrityIssue, 'kind' | 'severity' | 'recordId' | 'expectedArtifact'>,
): void {
  assert.equal(issues.length, 1, JSON.stringify(issues, null, 2));
  assert.equal(issues[0].kind, expected.kind);
  assert.equal(issues[0].severity, expected.severity);
  assert.equal(issues[0].recordId, expected.recordId);
  assert.equal(issues[0].expectedArtifact, expected.expectedArtifact);
}

const observation: BrowserObservation = {
  id: 'observation-playwright-before',
  runId,
  provider: 'playwright',
  providerRunId: 'playwright-session-before',
  status: 'failed',
  severity: 'high',
  failedStep: 'tap checkout',
  expectedBehavior: 'checkout CTA remains clickable',
  observedBehavior: 'accept button covers the primary CTA',
  viewport: { width: 390, height: 844, deviceScaleFactor: 3 },
  screenshotUrl: 'artifact://runs/evidence/browser-before.png',
  traceUrl: 'artifact://runs/evidence/browser-before.zip',
  domSummary: 'CTA center is obstructed',
  consoleErrors: [],
  networkErrors: [],
  result: {
    passed: false,
    failedStep: 'tap checkout',
    finalUrl: 'http://127.0.0.1:3100/checkout',
  },
  createdAt: now,
};

const localVerification: VerificationResult = {
  id: 'verification-local',
  runId,
  provider: 'local',
  status: 'passed',
  summary: 'Local checkout regression passed.',
  testCommand: 'pnpm phase4:checkout-test',
  artifacts: [{ outputs: [{ storageKey: 'runs/evidence/local-verification.json' }] }],
  raw: { proof: { providerId: 'local-proof-1' } },
  createdAt: now,
};

const playwrightVerification: VerificationResult = {
  id: 'verification-playwright',
  runId,
  provider: 'playwright',
  status: 'passed',
  summary: 'Playwright trace captured after verification.',
  testCommand: 'pnpm phase4:checkout-test',
  artifacts: [],
  raw: {
    nested: {
      traceUrl: 'artifact://runs/evidence/browser-after.zip',
    },
  },
  createdAt: now,
};

const tinyfishLiveVerification: VerificationResult = {
  id: 'verification-tinyfish-live',
  runId,
  provider: 'tinyfish-live',
  status: 'passed',
  summary: 'TinyFish live verification recorded.',
  testCommand: 'tinyfish live browser rerun',
  artifacts: [],
  raw: {},
  createdAt: now,
};

const unmappedPassedVerification: VerificationResult = {
  id: 'verification-unmapped-ai-browser',
  runId,
  provider: 'ai-browser',
  status: 'passed',
  summary: 'An unmapped provider claimed success.',
  testCommand: 'ai-browser verify',
  artifacts: [],
  raw: {},
  createdAt: now,
};

const unmappedSkippedVerification: VerificationResult = {
  ...unmappedPassedVerification,
  id: 'verification-unmapped-skipped',
  status: 'skipped',
  summary: 'An unmapped provider skipped verification.',
};

const openedPullRequest: PullRequestRecord = {
  id: 'pull-request-opened',
  runId,
  provider: 'github',
  patchId: 'patch-1',
  number: 17,
  title: 'Fix obstructed checkout CTA',
  branchName: 'flowpr/fix-checkout-cta',
  baseBranch: 'main',
  url: 'https://github.com/example/flowpr/pull/17',
  status: 'open',
  raw: {},
  createdAt: now,
  updatedAt: now,
};

const blockedPullRequest: PullRequestRecord = {
  id: 'pull-request-blocked',
  runId,
  provider: 'github',
  patchId: 'patch-2',
  title: 'Hold risky checkout change',
  branchName: 'flowpr/hold-risky-checkout-change',
  baseBranch: 'main',
  status: 'failed',
  raw: {
    attemptType: 'gate_denied',
    gate: {
      decision: 'denied',
      providerDecisionId: 'guild-gate-create-pr-1',
    },
  },
  createdAt: now,
  updatedAt: now,
};

const cleanDetail: Pick<
  RunDetail,
  'browserObservations' | 'verificationResults' | 'pullRequests' | 'providerArtifacts'
> = {
  browserObservations: [observation],
  verificationResults: [localVerification, playwrightVerification, tinyfishLiveVerification],
  pullRequests: [openedPullRequest, blockedPullRequest],
  providerArtifacts: [
    providerArtifact({
      id: 'artifact-observation',
      sponsor: 'playwright',
      artifactType: 'browser_observation',
      providerId: 'playwright-session-before',
      artifactUrl: 'artifact://runs/evidence/browser-before.png',
    }),
    providerArtifact({
      id: 'artifact-local-verification',
      sponsor: 'playwright',
      artifactType: 'local_verification',
      storageKey: 'runs/evidence/local-verification.json',
      responseSummary: { verificationId: localVerification.id },
    }),
    providerArtifact({
      id: 'artifact-trace-capture',
      sponsor: 'playwright',
      artifactType: 'trace_capture',
      artifactUrl: 'artifact://runs/evidence/browser-after.zip',
    }),
    providerArtifact({
      id: 'artifact-live-reverification',
      sponsor: 'tinyfish',
      artifactType: 'live_reverification',
      providerId: 'tinyfish-live-session-1',
    }),
    providerArtifact({
      id: 'artifact-opened-pr',
      sponsor: 'github',
      artifactType: 'pull_request',
      artifactUrl: openedPullRequest.url,
      responseSummary: { number: openedPullRequest.number },
    }),
    providerArtifact({
      id: 'artifact-blocked-pr-gate',
      sponsor: 'guildai',
      artifactType: 'action_gate_create_pull_request',
      providerId: 'guild-gate-create-pr-1',
    }),
  ],
};

function withoutArtifact(id: string): typeof cleanDetail {
  return {
    ...cleanDetail,
    providerArtifacts: cleanDetail.providerArtifacts.filter((artifact) => artifact.id !== id),
  };
}

assert.deepEqual(validateRunEvidenceIntegrity(cleanDetail), []);

const cleanReadiness = summarizeRunReadiness(cleanDetail);
assert.equal(cleanReadiness.evidenceIntegrity.state, 'ready');
assert.equal(cleanReadiness.evidenceIntegrity.issueCount, 0);
assert.equal(cleanReadiness.items[0].sponsor, 'flowpr');
assert.equal(cleanReadiness.items[0].artifactType, 'evidence_integrity');
assert.equal(cleanReadiness.items[0].state, 'ready');

const brokenReadiness = summarizeRunReadiness(withoutArtifact('artifact-observation'));
assert.equal(brokenReadiness.evidenceIntegrity.state, 'missing');
assert.equal(brokenReadiness.evidenceIntegrity.dangerCount, 1);
assert.equal(brokenReadiness.items[0].state, 'missing');

const gateHeldReadiness = summarizeRunReadiness({
  ...cleanDetail,
  pullRequests: [blockedPullRequest],
  providerArtifacts: [
    ...cleanDetail.providerArtifacts.filter((artifact) => artifact.id !== 'artifact-opened-pr'),
    providerArtifact({
      id: 'artifact-human-handoff',
      sponsor: 'insforge',
      artifactType: 'investigation_report',
      storageKey: 'runs/evidence/handoff.md',
    }),
  ],
});
const prLockReadiness = gateHeldReadiness.items.find(
  (item) => item.sponsor === 'redis' && item.artifactType === 'pr_lock_verified',
);
const githubPullRequestReadiness = gateHeldReadiness.items.find(
  (item) => item.sponsor === 'github' && item.artifactType === 'pull_request',
);
assert.equal(prLockReadiness?.state, 'ready');
assert.equal(prLockReadiness?.found, 0);
assert.equal(prLockReadiness?.note, 'Gate-held handoff path.');
assert.equal(githubPullRequestReadiness?.state, 'ready');
assert.equal(githubPullRequestReadiness?.found, 0);
assert.equal(githubPullRequestReadiness?.note, 'No PR expected for this gate outcome.');

expectSingleIssue(validateRunEvidenceIntegrity(withoutArtifact('artifact-observation')), {
  kind: 'browser_observation',
  severity: 'danger',
  recordId: observation.id,
  expectedArtifact: 'playwright provider artifact linked by providerRunId, screenshot, or trace',
});

expectSingleIssue(validateRunEvidenceIntegrity(withoutArtifact('artifact-local-verification')), {
  kind: 'verification_result',
  severity: 'danger',
  recordId: localVerification.id,
  expectedArtifact: 'playwright/local_verification',
});

expectSingleIssue(validateRunEvidenceIntegrity(withoutArtifact('artifact-trace-capture')), {
  kind: 'verification_result',
  severity: 'danger',
  recordId: playwrightVerification.id,
  expectedArtifact: 'playwright/trace_capture',
});

expectSingleIssue(validateRunEvidenceIntegrity(withoutArtifact('artifact-live-reverification')), {
  kind: 'verification_result',
  severity: 'danger',
  recordId: tinyfishLiveVerification.id,
  expectedArtifact: 'tinyfish/live_reverification',
});

expectSingleIssue(validateRunEvidenceIntegrity(withoutArtifact('artifact-opened-pr')), {
  kind: 'pull_request',
  severity: 'danger',
  recordId: openedPullRequest.id,
  expectedArtifact: 'github/pull_request',
});

expectSingleIssue(validateRunEvidenceIntegrity(withoutArtifact('artifact-blocked-pr-gate')), {
  kind: 'pull_request',
  severity: 'warning',
  recordId: blockedPullRequest.id,
  expectedArtifact: 'guildai/action_gate_create_pull_request',
});

expectSingleIssue(validateRunEvidenceIntegrity({
  ...cleanDetail,
  verificationResults: [...cleanDetail.verificationResults, unmappedPassedVerification],
}), {
  kind: 'verification_result',
  severity: 'danger',
  recordId: unmappedPassedVerification.id,
  expectedArtifact: 'known provider-artifact mapping',
});

assert.deepEqual(validateRunEvidenceIntegrity({
  ...cleanDetail,
  verificationResults: [...cleanDetail.verificationResults, unmappedSkippedVerification],
}), []);

console.log(JSON.stringify({
  ok: true,
  cases: {
    clean: 1,
    missingBrowserObservationArtifact: 1,
    missingLocalVerificationArtifact: 1,
    missingPlaywrightTraceArtifact: 1,
    missingTinyFishLiveArtifact: 1,
    missingOpenedPullRequestArtifact: 1,
    missingBlockedPullRequestGateArtifact: 1,
    readinessIntegration: 1,
    gateHeldHandoffReadiness: 1,
    unmappedPassedVerificationProvider: 1,
    unmappedSkippedVerificationProvider: 1,
  },
}, null, 2));
