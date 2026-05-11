import assert from 'node:assert/strict';
import type {
  BrowserObservation,
  BugHypothesis,
  FlowPrRun,
  PatchRecord,
  PolicyHit,
  PullRequestRecord,
  VerificationResult,
} from '@flowpr/schemas';
import {
  buildInvestigationReport,
  shouldProduceInvestigationReport,
} from '../packages/agent/src/agents/investigation';
import { renderPullRequestBody } from '../packages/agent/src/agents/pr-writer';

const now = new Date('2026-05-11T12:00:00.000Z').toISOString();
const runId = 'run-pr-evidence-packet-smoke';

const run: FlowPrRun = {
  id: runId,
  projectId: 'local',
  repoUrl: 'https://github.com/rishabhcli/FlowPR',
  owner: 'rishabhcli',
  repo: 'FlowPR',
  baseBranch: 'main',
  previewUrl: 'http://localhost:3100/checkout?plan=pro',
  flowGoal: 'On mobile, complete checkout for the Pro plan and reach the success screen.',
  status: 'publishing_artifacts',
  riskLevel: 'medium',
  permissionProfile: 'investigation-only',
  agentName: 'flowpr-autonomous-frontend-qa',
  agentVersion: 'smoke',
  createdAt: now,
  updatedAt: now,
};

const browserObservations: BrowserObservation[] = [
  {
    id: 'observation-before',
    runId,
    provider: 'playwright',
    providerRunId: 'pw-before-smoke',
    status: 'failed',
    severity: 'medium',
    failedStep: 'tap mobile checkout CTA',
    expectedBehavior: 'The CTA remains visible and routes to the success screen.',
    observedBehavior: 'The CTA is hidden under the sticky mobile footer.',
    viewport: { source: 'playwright-mobile', width: 390, height: 844 },
    screenshotUrl: 'artifact://runs/run-pr-evidence-packet-smoke/before.png',
    traceUrl: 'artifact://runs/run-pr-evidence-packet-smoke/before.zip',
    domSummary: 'Primary checkout CTA overlaps the footer on a 390px viewport.',
    consoleErrors: [],
    networkErrors: [],
    result: { passed: false, finalUrl: run.previewUrl },
    raw: { source: 'playwright' },
    createdAt: now,
  },
];

const bugHypotheses: BugHypothesis[] = [
  {
    id: 'hypothesis-mobile-footer',
    runId,
    summary: 'Mobile checkout CTA is obstructed by sticky footer layout.',
    affectedFlow: run.flowGoal,
    suspectedCause: 'The checkout form lacks enough bottom padding for the fixed mobile footer.',
    confidence: 'high',
    severity: 'medium',
    acceptanceCriteria: [{ text: 'Mobile checkout CTA remains tappable.', source: 'senso-seed' }],
    evidence: {
      bugType: 'blocked_cta',
      confidenceScore: 0.91,
      likelyFiles: ['apps/demo-target/app/styles.css'],
      hypothesis: 'The fixed footer covers the final checkout action on mobile.',
    },
    createdAt: now,
  },
];

const patches: PatchRecord[] = [
  {
    id: 'patch-mobile-footer',
    runId,
    hypothesisId: 'hypothesis-mobile-footer',
    branchName: 'flowpr/fix-mobile-footer',
    commitSha: 'abcdef1234567890',
    status: 'tested',
    summary: 'Reserve safe space for the mobile checkout footer.',
    diffStat: { filesChanged: 1, insertions: 8, deletions: 2 },
    filesChanged: [
      {
        path: 'apps/demo-target/app/styles.css',
        action: 'patch',
        summary: 'Adds mobile-safe bottom padding for checkout actions.',
      },
    ],
    raw: { headSha: 'before123' },
    createdAt: now,
    updatedAt: now,
  },
];

const verificationResults: VerificationResult[] = [
  {
    id: 'verification-local',
    runId,
    patchId: 'patch-mobile-footer',
    provider: 'local',
    status: 'passed',
    summary: 'Typecheck and mobile checkout regression passed locally.',
    testCommand: 'pnpm phase4:checkout-test',
    artifacts: [],
    raw: {
      steps: [
        {
          step: 'typecheck',
          status: 'passed',
          command: 'pnpm --filter @flowpr/demo-target typecheck',
          durationMs: 1100,
        },
        {
          step: 'e2e',
          status: 'passed',
          command: 'pnpm phase4:checkout-test',
          durationMs: 4200,
        },
      ],
    },
    createdAt: now,
  },
  {
    id: 'verification-live',
    runId,
    patchId: 'patch-mobile-footer',
    provider: 'tinyfish-live',
    status: 'passed',
    summary: 'Live browser re-verification reached checkout success.',
    testCommand: 'tinyfish live mobile checkout',
    artifacts: [
      {
        providerId: 'tinyfish-live-smoke',
        screenshotUrl: 'artifact://runs/run-pr-evidence-packet-smoke/after.png',
      },
    ],
    raw: { attempts: 1 },
    createdAt: now,
  },
];

const policyHits: PolicyHit[] = [
  {
    id: 'policy-pr-requirement',
    runId,
    provider: 'senso',
    query: 'pull request evidence requirements',
    title: 'FlowPR PR evidence requirements',
    sourceUrl: 'senso://seed/pr-evidence',
    summary: 'Every handoff must include root cause, before/after proof, tests, risk, and rollback.',
    score: 1,
    raw: {},
    createdAt: now,
  },
];

const pullRequests: PullRequestRecord[] = [
  {
    id: 'pull-request-gate-held',
    runId,
    patchId: 'patch-mobile-footer',
    provider: 'github',
    title: 'Pull request not opened: Guild.ai gate held it',
    branchName: 'flowpr/fix-mobile-footer',
    baseBranch: 'main',
    status: 'failed',
    raw: {
      attemptType: 'gate_denied',
      gate: {
        decision: 'denied',
        reason: 'Permission profile is investigation-only.',
        providerDecisionId: 'guild-gate-smoke',
        permissionProfile: 'investigation-only',
        requiresApproval: true,
      },
    },
    createdAt: now,
    updatedAt: now,
  },
];

const reportDecision = shouldProduceInvestigationReport({
  pullRequests,
  browserObservations,
  verificationResults,
});
assert.equal(reportDecision.needed, true);

const report = buildInvestigationReport({
  run,
  browserObservations,
  bugHypotheses,
  patches,
  pullRequests,
  verificationResults,
  policyHits,
  reason: reportDecision.reason,
});

assert.match(report.summary, /Verified patch ready/);
assert.match(report.markdown, /## Evidence completeness/);
assert.match(report.markdown, /\| Before screenshot \| complete \| artifact:\/\/runs\/run-pr-evidence-packet-smoke\/before\.png \|/);
assert.match(report.markdown, /\| After screenshot \/ local proof \| complete \| artifact:\/\/runs\/run-pr-evidence-packet-smoke\/after\.png \|/);
assert.match(report.markdown, /## Patch packet/);
assert.match(report.markdown, /`apps\/demo-target\/app\/styles\.css`/);
assert.match(report.markdown, /## Local verification/);
assert.match(report.markdown, /\| typecheck \| passed \| `pnpm --filter @flowpr\/demo-target typecheck` \| 1s \|/);
assert.match(report.markdown, /## Live re-verification/);
assert.match(report.markdown, /Live browser re-verification reached checkout success/);
assert.match(report.markdown, /## Governance/);
assert.match(report.markdown, /guild-gate-smoke/);
assert.match(report.markdown, /## Residual risk/);
assert.match(report.markdown, /## Rollback/);
assert.equal(report.structured.localVerificationStatus, 'passed');
assert.equal(report.structured.liveVerificationStatus, 'passed');
assert.equal(report.structured.gateDecision, 'denied');

const fallbackVerificationResults = verificationResults.map((result) =>
  result.id === 'verification-live'
    ? {
        ...result,
        summary: 'Live verification skipped because TinyFish cannot reach localhost previews and local verification passed.',
        artifacts: [{ providerId: 'tinyfish-live-smoke' }],
      }
    : result,
);
const fallbackReport = buildInvestigationReport({
  run,
  browserObservations,
  bugHypotheses,
  patches,
  pullRequests,
  verificationResults: fallbackVerificationResults,
  policyHits,
  reason: reportDecision.reason,
});

assert.match(
  fallbackReport.markdown,
  /\| After screenshot \/ local proof \| complete \| Localhost live verification used local proof fallback: Live verification skipped because TinyFish cannot reach localhost previews and local verification passed\. \|/,
);

const prBody = renderPullRequestBody({
  runId,
  owner: run.owner,
  repo: run.repo,
  baseBranch: run.baseBranch,
  previewUrl: run.previewUrl,
  flowGoal: run.flowGoal,
  triage: {
    bugType: 'blocked_cta',
    severity: 'medium',
    confidence: 'high',
    confidenceScore: 0.91,
    hypothesis: 'The fixed footer covers the final checkout action on mobile.',
    summary: 'Mobile checkout CTA is obstructed by the sticky footer.',
    likelyFiles: ['apps/demo-target/app/styles.css'],
    suspectedCause: 'The checkout form lacks enough bottom padding for the fixed mobile footer.',
    acceptanceCriteria: [{ text: 'Mobile checkout CTA remains tappable.', source: 'senso-seed' }],
    evidence: {
      provider: 'playwright',
      failedStep: 'tap mobile checkout CTA',
      consoleErrors: [],
      networkErrors: [],
      topDomFinding: 'CTA overlaps footer',
    },
    signature: {
      bugType: 'blocked_cta',
      failedStep: 'tap mobile checkout CTA',
      topDomFinding: 'CTA overlaps footer',
      flowGoalKey: 'mobile-checkout-pro',
    },
    reusedMemory: false,
  },
  patch: {
    workspace: {
      dir: '/tmp/flowpr-pr-packet-smoke',
      runId,
      headSha: 'before123',
      remoteUrl: run.repoUrl,
    },
    plan: {
      branchName: 'flowpr/fix-mobile-footer',
      commitMessage: 'fix(flow): keep checkout CTA tappable',
      explanation: 'Reserve safe space for the mobile checkout footer.',
      testPath: 'apps/demo-target/tests/checkout-mobile-regression.spec.ts',
      files: [
        {
          path: 'apps/demo-target/app/styles.css',
          action: 'patch',
          summary: 'Adds mobile-safe bottom padding for checkout actions.',
        },
      ],
    },
    commitSha: 'abcdef1234567890',
    filesChanged: ['apps/demo-target/app/styles.css'],
    diffStat: { filesChanged: 1, insertions: 8, deletions: 2 },
    preFixStyles: '',
    postFixStyles: '',
    regressionTestContent: '',
    raw: {},
  },
  localVerification: {
    dir: '/tmp/flowpr-pr-packet-smoke',
    overallStatus: 'passed',
    summary: 'Typecheck and mobile checkout regression passed locally.',
    steps: [
      {
        step: 'e2e',
        status: 'passed',
        command: 'pnpm phase4:checkout-test',
        durationMs: 4200,
        exitCode: 0,
        stdoutExcerpt: '',
        stderrExcerpt: '',
      },
    ],
  },
  liveVerification: {
    status: 'passed',
    attempts: 0,
    summary: 'Live verification skipped because TinyFish cannot reach localhost previews and local verification passed.',
  },
  tinyfishRunId: 'tinyfish-live-smoke',
  traceUrl: 'artifact://runs/run-pr-evidence-packet-smoke/before.zip',
  beforeScreenshotUrl: 'artifact://runs/run-pr-evidence-packet-smoke/before.png',
  policyCitations: [
    {
      title: 'FlowPR PR evidence requirements',
      url: 'senso://seed/pr-evidence',
      excerpt: 'Every handoff must include proof, tests, risk, and rollback.',
    },
  ],
  guildSessionId: 'guild-session-smoke',
  gateDecision: {
    decision: 'denied',
    reason: 'Permission profile is investigation-only.',
    providerDecisionId: 'guild-gate-smoke',
    requiresApproval: true,
  },
  draft: true,
});

assert.match(
  prBody,
  /\| After screenshot \/ local proof \| complete \| Localhost live verification used local proof fallback: Live verification skipped because TinyFish cannot reach localhost previews and local verification passed\. \|/,
);
assert.doesNotMatch(prBody, /Before\/after screenshot pair is incomplete/);

console.log('PR evidence packet smoke ok.');
