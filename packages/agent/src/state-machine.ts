import type { RedisClientType } from 'redis';
import type { BrowserObservation, BrowserObservationResult, FlowPrRun, RunStatus } from '@flowpr/schemas';
import { runStatusLabels } from '@flowpr/schemas';
import {
  acquireRedisLock,
  appendTimelineEvent,
  createBrowserSession,
  completeIdempotentOperation,
  createBugSignatureHash,
  createSensoClient,
  emitAgentStep,
  emitBrowserResult,
  emitPatchResult,
  emitVerificationResult,
  failIdempotentOperation,
  flowPrStreams,
  getGitHubRepository,
  getRedisStreamStats,
  getRun,
  listBrowserObservations,
  listBugHypotheses,
  listPatches,
  listPolicyHits,
  listPullRequests,
  listRedisStreamEntries,
  listVerificationResults,
  lookupBugSignatureMemory,
  lookupSuccessfulPatchMemory,
  queryPolicyContext,
  recordActionGate,
  recordAgentMemory,
  recordBenchmarkEvaluation,
  recordBrowserObservation,
  recordBugHypothesis,
  recordPatch,
  recordPolicyHit,
  recordProviderArtifact,
  recordPullRequest,
  recordVerificationResult,
  redisLockKeys,
  redisMemoryKeys,
  releaseRedisLock,
  runAgentFlow,
  startIdempotentOperation,
  storeBugSignatureMemory,
  storeSuccessfulPatchMemory,
  terminateBrowserSession,
  updateAgentSessionsForRun,
  updateRunStatus,
  uploadRunArtifact,
  type FlowPrRedisEvent,
  type TinyFishAgentFlowResult,
} from '@flowpr/tools';
import {
  runLocalFlowTest,
  runRemoteBrowserSessionEvidence,
  type LocalFlowTestResult,
} from '@flowpr/tools/playwright';
import {
  diagnoseFailure,
  policyContextFromHits,
  type BugType,
  type PolicyContext as TriagePolicyContext,
  type TriageOutput,
} from './agents/visual-triage';
import { generateDemoCookieBannerPatch } from './agents/patcher';
import { runLocalVerification } from './agents/verifier';
import { createPullRequestForRun } from './agents/pr-writer';
import { runLiveVerification } from './agents/live-verifier';
import { buildInvestigationReport, shouldProduceInvestigationReport } from './agents/investigation';
import {
  requestActionGate,
  startAgentSession,
  completeAgentSession,
  recordToolCall,
} from './agents/guildai-session';
import { executeSafeOperation } from './agents/wundergraph-operations';

const stateOrder: RunStatus[] = [
  'queued',
  'loading_repo',
  'discovering_flows',
  'running_browser_qa',
  'collecting_visual_evidence',
  'triaging_failure',
  'retrieving_policy',
  'searching_memory',
  'patching_code',
  'running_local_tests',
  'running_live_verification',
  'creating_pr',
  'publishing_artifacts',
  'learned',
  'done',
];

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nextPhase(status: RunStatus): RunStatus | undefined {
  const index = stateOrder.indexOf(status);

  if (index < 0) return undefined;
  return stateOrder[index + 1];
}

function resumePhase(status: RunStatus): RunStatus | undefined {
  if (status === 'queued') return 'loading_repo';
  if (status === 'done' || status === 'failed') return undefined;

  return status;
}

function isPhase(value: string | undefined): value is RunStatus {
  return Boolean(value && stateOrder.includes(value as RunStatus));
}

function latestObservation(observations: BrowserObservation[]): BrowserObservation | undefined {
  return observations[observations.length - 1];
}

async function persistRedisState(
  redis: RedisClientType,
  event: FlowPrRedisEvent,
  status: RunStatus | string,
  extra: Record<string, string | number | boolean | undefined> = {},
): Promise<void> {
  await redis.hSet(`flowpr:run_state:${event.runId}`, {
    runId: event.runId,
    status: String(status),
    eventType: event.eventType,
    stream: event.stream,
    streamId: event.id,
    dedupeKey: event.dedupeKey,
    attempt: String(event.attempt),
    updatedAt: new Date().toISOString(),
    ...Object.fromEntries(
      Object.entries(extra)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ),
  });

  console.log(JSON.stringify({
    component: 'flowpr-agent',
    event: 'redis_state_transition',
    runId: event.runId,
    status,
    stream: event.stream,
    streamId: event.id,
    eventType: event.eventType,
    attempt: event.attempt,
  }));
}

async function recordRedisArtifact(
  event: FlowPrRedisEvent,
  artifactType: string,
  responseSummary: Record<string, unknown> = {},
): Promise<void> {
  await recordProviderArtifact({
    runId: event.runId,
    sponsor: 'redis',
    artifactType,
    providerId: event.id,
    requestSummary: {
      stream: event.stream,
      eventType: event.eventType,
      phase: event.phase,
      dedupeKey: event.dedupeKey,
      attempt: event.attempt,
    },
    responseSummary,
    raw: {
      payload: event.payload,
    },
  });
}

async function appendRedisTimeline(
  event: FlowPrRedisEvent,
  phase: string,
  status: 'started' | 'completed' | 'failed' | 'skipped' | 'info',
  title: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  await appendTimelineEvent({
    runId: event.runId,
    actor: 'redis',
    phase,
    status,
    title,
    data: {
      stream: event.stream,
      streamId: event.id,
      eventType: event.eventType,
      dedupeKey: event.dedupeKey,
      attempt: event.attempt,
      ...data,
    },
  });
}

async function emitNextStep(
  redis: RedisClientType,
  sourceEvent: FlowPrRedisEvent,
  phase: RunStatus | undefined,
  reason: string,
): Promise<string | undefined> {
  if (!phase) return undefined;

  const streamId = await emitAgentStep(redis, {
    runId: sourceEvent.runId,
    phase,
    reason,
    previousStreamId: sourceEvent.id,
  });

  await appendTimelineEvent({
    runId: sourceEvent.runId,
    actor: 'redis',
    phase,
    status: 'started',
    title: `Moving on to ${runStatusLabels[phase] ?? phase}.`,
    data: {
      stream: flowPrStreams.agentSteps,
      streamId,
      previousStreamId: sourceEvent.id,
      previousStream: sourceEvent.stream,
      reason,
    },
  });

  await recordProviderArtifact({
    runId: sourceEvent.runId,
    sponsor: 'redis',
    artifactType: 'agent_step_emitted',
    providerId: streamId,
    requestSummary: {
      stream: flowPrStreams.agentSteps,
      eventType: 'agent.step',
      phase,
    },
    responseSummary: {
      streamId,
      previousStreamId: sourceEvent.id,
      reason,
    },
    raw: {
      runId: sourceEvent.runId,
      phase,
      sourceEvent,
    },
  });

  return streamId;
}

async function loadGitHubMetadata(run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  const repository = await getGitHubRepository(run.owner, run.repo);

  await appendTimelineEvent({
    runId: run.id,
    actor: 'github',
    phase: 'loading_repo',
    status: 'completed',
    title: 'Verified the GitHub repository FlowPR will work on.',
    data: {
      streamId: event.id,
      repository,
    },
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'github',
    artifactType: 'worker_repository_lookup',
    providerId: String(repository.id),
    artifactUrl: repository.htmlUrl,
    requestSummary: {
      owner: run.owner,
      repo: run.repo,
    },
    responseSummary: {
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      private: repository.private,
    },
    raw: repository as unknown as Record<string, unknown>,
  });
}

async function querySensoPolicy(run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  const latestObservations = await listBrowserObservations(run.id);
  const primaryFailure = latestObservations.find((observation) => observation.status === 'failed' || observation.status === 'errored');
  const failureSummary = primaryFailure?.observedBehavior;
  const queryText = [
    'FlowPR frontend QA policy request.',
    `Flow goal: ${run.flowGoal}`,
    failureSummary ? `Observed failure: ${failureSummary}` : undefined,
  ]
    .filter(Boolean)
    .join('\n');

  const policy = await queryPolicyContext({
    flowGoal: run.flowGoal,
    failureSummary,
    evidence: primaryFailure ? { observationId: primaryFailure.id } : undefined,
    maxResults: 5,
  });

  await appendTimelineEvent({
    runId: run.id,
    actor: 'senso',
    phase: 'retrieving_policy',
    status: 'completed',
    title: `Loaded ${policy.acceptanceCriteria.length} acceptance criteria from the team’s rulebook.`,
    data: {
      streamId: event.id,
      query: queryText,
      citationCount: policy.citations.length,
      fallback: (policy.raw as Record<string, unknown> | undefined)?.fallback === true,
    },
  });

  for (const [index, citation] of policy.citations.slice(0, 5).entries()) {
    await recordPolicyHit({
      runId: run.id,
      provider: 'senso',
      query: queryText,
      title: citation.title || `Senso policy ${index + 1}`,
      sourceUrl: citation.url,
      summary: citation.excerpt,
      raw: { index, ...citation },
    });
  }

  if (policy.citations.length === 0) {
    for (const [index, criterion] of policy.acceptanceCriteria.slice(0, 3).entries()) {
      await recordPolicyHit({
        runId: run.id,
        provider: 'senso',
        query: queryText,
        title: `FlowPR fallback policy ${index + 1}`,
        summary: criterion.text,
        raw: { source: criterion.source ?? 'flowpr_policy_fallback' },
      });
    }
  }

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'senso',
    artifactType: 'policy_context',
    requestSummary: {
      query: queryText,
      flowGoal: run.flowGoal,
      streamId: event.id,
    },
    responseSummary: {
      acceptanceCriteriaCount: policy.acceptanceCriteria.length,
      severityGuidanceCount: policy.severityGuidance.length,
      prRequirementCount: policy.prRequirements.length,
      codingConstraintCount: policy.codingConstraints.length,
      citationCount: policy.citations.length,
      fallback: (policy.raw as Record<string, unknown> | undefined)?.fallback === true,
    },
    raw: {
      policy,
    },
  });
}

interface BrowserQaOutcome {
  providerRunId?: string;
  status: string;
  tinyfishPassed: boolean;
  playwrightPassed?: boolean;
  screenshotUrl?: string;
  traceUrl?: string;
  failureSummary?: string;
}

function stringRecords(values: string[]): Record<string, unknown>[] {
  return values.map((message) => ({ message }));
}

function networkRecords(values: BrowserObservationResult['networkErrors']): Record<string, unknown>[] {
  return values.map((failure) => ({ ...failure }));
}

function observationStatus(passed: boolean, errored = false): 'passed' | 'failed' | 'errored' {
  if (errored) return 'errored';
  return passed ? 'passed' : 'failed';
}

function tinyFishSummary(flow: TinyFishAgentFlowResult): Record<string, unknown> {
  return {
    status: flow.status,
    passed: flow.observation.passed,
    failedStep: flow.observation.failedStep,
    visibleError: flow.observation.visibleError,
    likelyRootCause: flow.observation.likelyRootCause,
    confidence: flow.observation.confidence,
    attempts: flow.attempts,
    progressEvents: flow.progressEvents.length,
    streamingUrl: flow.streamingUrl,
  };
}

async function recordFailureHypothesis(input: {
  run: FlowPrRun;
  provider: 'tinyfish' | 'playwright';
  providerRunId?: string;
  failedStep?: string;
  visibleError?: string;
  likelyRootCause?: string;
  confidence?: number;
  event: FlowPrRedisEvent;
  evidence: Record<string, unknown>;
}): Promise<void> {
  await recordBugHypothesis({
    runId: input.run.id,
    summary: `${input.provider} evidence shows the requested frontend flow did not complete.`,
    affectedFlow: input.run.flowGoal,
    suspectedCause: input.likelyRootCause ?? input.visibleError,
    confidence: (input.confidence ?? 0.5) >= 0.8 ? 'high' : 'medium',
    severity: input.run.riskLevel,
    acceptanceCriteria: [
      {
        text: input.run.flowGoal,
        source: 'dashboard_input',
      },
      {
        text: 'Primary CTAs must be reachable and unobstructed on mobile.',
        source: 'technical_phase_4',
      },
    ],
    evidence: {
      provider: input.provider,
      providerRunId: input.providerRunId,
      failedStep: input.failedStep,
      visibleError: input.visibleError,
      redisStreamId: input.event.id,
      ...input.evidence,
    },
  });
}

async function recordTinyFishAgentFlow(
  run: FlowPrRun,
  event: FlowPrRedisEvent,
  flow: TinyFishAgentFlowResult,
): Promise<void> {
  const errored = flow.status === 'STREAM_FAILED';
  const status = observationStatus(flow.observation.passed, errored);

  await appendTimelineEvent({
    runId: run.id,
    actor: 'tinyfish',
    phase: 'running_browser_qa',
    status: errored ? 'failed' : 'completed',
    title: flow.observation.passed
      ? 'TinyFish completed the journey in a real browser.'
      : `TinyFish could not complete the journey. ${flow.observation.visibleError ?? flow.observation.likelyRootCause ?? ''}`.trim(),
    data: {
      tinyfishRunId: flow.providerRunId,
      streamingUrl: flow.streamingUrl,
      status: flow.status,
      passed: flow.observation.passed,
      failedStep: flow.observation.failedStep,
      attempts: flow.attempts,
      streamId: event.id,
    },
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'tinyfish',
    artifactType: 'browser_flow_test',
    providerId: flow.providerRunId,
    artifactUrl: flow.streamingUrl,
    requestSummary: {
      previewUrl: run.previewUrl,
      flowGoal: run.flowGoal,
      api: 'agent.stream',
      output: 'strict_json',
      streamId: event.id,
    },
    responseSummary: tinyFishSummary(flow),
    raw: {
      flow,
    },
  });

  await recordBrowserObservation({
    runId: run.id,
    provider: 'tinyfish',
    providerRunId: flow.providerRunId,
    status,
    severity: run.riskLevel,
    failedStep: flow.observation.failedStep,
    expectedBehavior: run.flowGoal,
    observedBehavior: flow.observation.visibleError
      ?? flow.observation.likelyRootCause
      ?? (flow.observation.passed ? 'TinyFish completed the requested browser flow.' : 'TinyFish could not complete the requested browser flow.'),
    viewport: { width: 390, height: 844, source: 'tinyfish_agent_goal' },
    screenshotUrl: flow.observation.screenshots[0],
    domSummary: flow.observation.domFindings.join('\n'),
    consoleErrors: stringRecords(flow.observation.consoleErrors),
    networkErrors: networkRecords(flow.observation.networkErrors),
    result: {
      passed: flow.observation.passed,
      finalUrl: flow.observation.finalUrl,
      screenshots: flow.observation.screenshots,
      streamingUrl: flow.streamingUrl,
      progressEvents: flow.progressEvents,
      confidence: flow.observation.confidence,
    },
    raw: {
      rawResult: flow.rawResult,
      error: flow.error,
    },
  });

  await recordVerificationResult({
    runId: run.id,
    provider: 'tinyfish',
    status,
    summary: flow.observation.passed
      ? 'TinyFish Agent API completed the live browser QA flow.'
      : flow.observation.visibleError ?? flow.observation.likelyRootCause ?? 'TinyFish Agent API reported the flow did not pass.',
    artifacts: [
      {
        sponsor: 'tinyfish',
        providerId: flow.providerRunId,
        type: 'browser_flow_test',
        streamingUrl: flow.streamingUrl,
        redisStreamId: event.id,
      },
    ],
    raw: {
      flow,
    },
  });

  if (!flow.observation.passed) {
    await recordFailureHypothesis({
      run,
      provider: 'tinyfish',
      providerRunId: flow.providerRunId,
      failedStep: flow.observation.failedStep,
      visibleError: flow.observation.visibleError,
      likelyRootCause: flow.observation.likelyRootCause,
      confidence: flow.observation.confidence,
      event,
      evidence: {
        streamingUrl: flow.streamingUrl,
        screenshots: flow.observation.screenshots,
        progressEvents: flow.progressEvents,
      },
    });
  }
}

async function recordPlaywrightEvidence(
  run: FlowPrRun,
  event: FlowPrRedisEvent,
  result: LocalFlowTestResult,
): Promise<void> {
  const status = observationStatus(result.passed);

  await appendTimelineEvent({
    runId: run.id,
    actor: 'playwright',
    phase: 'running_browser_qa',
    status: result.passed ? 'completed' : 'failed',
    title: result.passed
      ? 'Playwright confirmed the journey with a trace artifact.'
      : `Playwright caught the journey failing. ${result.visibleError ?? result.likelyRootCause ?? ''}`.trim(),
    data: {
      passed: result.passed,
      failedStep: result.failedStep,
      screenshotUrl: result.screenshotUrl,
      traceUrl: result.traceUrl,
      recoveryPassed: result.recoveryPassed,
      streamId: event.id,
    },
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'playwright',
    artifactType: 'trace_capture',
    providerId: `playwright:${run.id}`,
    artifactUrl: result.traceUrl ?? result.screenshotUrl,
    requestSummary: {
      previewUrl: run.previewUrl,
      flowGoal: run.flowGoal,
      command: 'runLocalFlowTest',
      streamId: event.id,
    },
    responseSummary: {
      passed: result.passed,
      failedStep: result.failedStep,
      screenshotUrl: result.screenshotUrl,
      traceUrl: result.traceUrl,
      likelyRootCause: result.likelyRootCause,
      recoveryPassed: result.recoveryPassed,
    },
    raw: result.raw,
  });

  await recordBrowserObservation({
    runId: run.id,
    provider: 'playwright',
    providerRunId: `playwright:${run.id}`,
    status,
    severity: run.riskLevel,
    failedStep: result.failedStep,
    expectedBehavior: run.flowGoal,
    observedBehavior: result.visibleError
      ?? result.likelyRootCause
      ?? (result.passed ? 'Playwright completed the requested browser flow.' : 'Playwright could not complete the requested browser flow.'),
    viewport: { width: 390, height: 844, source: 'playwright' },
    screenshotUrl: result.screenshotUrl,
    screenshotKey: result.screenshotKey,
    traceUrl: result.traceUrl,
    traceKey: result.traceKey,
    domSummary: result.domFindings.join('\n'),
    consoleErrors: stringRecords(result.consoleErrors),
    networkErrors: networkRecords(result.networkErrors),
    result: {
      passed: result.passed,
      finalUrl: result.finalUrl,
      confidence: result.confidence,
      recoveryPassed: result.recoveryPassed,
    },
    raw: result.raw,
  });

  await recordVerificationResult({
    runId: run.id,
    provider: 'playwright',
    status,
    summary: result.passed
      ? 'Playwright trace verified the requested browser flow.'
      : result.visibleError ?? result.likelyRootCause ?? 'Playwright trace shows the requested browser flow failed.',
    testCommand: 'playwright-trace-capture',
    artifacts: [
      {
        sponsor: 'playwright',
        screenshotUrl: result.screenshotUrl,
        traceUrl: result.traceUrl,
        redisStreamId: event.id,
      },
    ],
    raw: {
      result,
    },
  });

  if (!result.passed) {
    await recordFailureHypothesis({
      run,
      provider: 'playwright',
      providerRunId: `playwright:${run.id}`,
      failedStep: result.failedStep,
      visibleError: result.visibleError,
      likelyRootCause: result.likelyRootCause,
      confidence: result.confidence,
      event,
      evidence: {
        screenshotUrl: result.screenshotUrl,
        traceUrl: result.traceUrl,
        domFindings: result.domFindings,
        recoveryPassed: result.recoveryPassed,
      },
    });
  }
}

async function recordTinyFishBrowserSessionEvidence(
  run: FlowPrRun,
  event: FlowPrRedisEvent,
): Promise<LocalFlowTestResult | undefined> {
  let sessionId: string | undefined;

  try {
    const session = await createBrowserSession({ url: run.previewUrl });
    sessionId = session.session_id;

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'tinyfish',
      artifactType: 'browser_session_created',
      providerId: session.session_id,
      artifactUrl: session.base_url,
      requestSummary: {
        previewUrl: run.previewUrl,
        api: 'browser.sessions.create',
        streamId: event.id,
      },
      responseSummary: {
        sessionId: session.session_id,
        hasCdpUrl: Boolean(session.cdp_url),
        baseUrl: session.base_url,
      },
      raw: {
        session,
      },
    });

    const result = await runRemoteBrowserSessionEvidence({
      runId: run.id,
      previewUrl: run.previewUrl,
      flowGoal: run.flowGoal,
      cdpUrl: session.cdp_url,
      label: 'phase4-tinyfish-browser-session',
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'tinyfish',
      artifactType: 'browser_session_screenshot',
      providerId: session.session_id,
      artifactUrl: result.screenshotUrl,
      requestSummary: {
        previewUrl: run.previewUrl,
        api: 'browser.cdp.playwright',
        streamId: event.id,
      },
      responseSummary: {
        passed: result.passed,
        failedStep: result.failedStep,
        screenshotUrl: result.screenshotUrl,
        likelyRootCause: result.likelyRootCause,
      },
      raw: result.raw,
    });

    if (result.screenshotUrl) {
      await recordBrowserObservation({
        runId: run.id,
        provider: 'tinyfish',
        providerRunId: session.session_id,
        status: observationStatus(result.passed),
        severity: run.riskLevel,
        failedStep: result.failedStep,
        expectedBehavior: run.flowGoal,
        observedBehavior: result.visibleError
          ?? result.likelyRootCause
          ?? 'TinyFish Browser API captured direct CDP evidence.',
        viewport: { width: 390, height: 844, source: 'tinyfish_browser_cdp' },
        screenshotUrl: result.screenshotUrl,
        screenshotKey: result.screenshotKey,
        domSummary: result.domFindings.join('\n'),
        result: {
          passed: result.passed,
          finalUrl: result.finalUrl,
          confidence: result.confidence,
          recoveryPassed: result.recoveryPassed,
        },
        raw: result.raw,
      });
    }

    return result;
  } catch (error) {
    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'tinyfish',
      artifactType: 'browser_session_error',
      providerId: sessionId,
      requestSummary: {
        previewUrl: run.previewUrl,
        api: 'browser.sessions.create',
        streamId: event.id,
      },
      responseSummary: {
        error: getErrorMessage(error),
      },
      raw: {
        error: getErrorMessage(error),
      },
    });
    return undefined;
  } finally {
    if (sessionId) {
      await terminateBrowserSession(sessionId).catch(() => undefined);
    }
  }
}

async function runBrowserQa(
  run: FlowPrRun,
  event: FlowPrRedisEvent,
): Promise<BrowserQaOutcome> {
  await recordActionGate({
    runId: run.id,
    gateType: 'tinyfish_live_browser_run',
    riskLevel: run.riskLevel,
    status: 'allowed',
    reason: 'Worker is permitted to start the TinyFish live browser QA run for this queued FlowPR run.',
    requestedBy: 'worker',
    resolvedBy: 'system',
    resolvedAt: new Date().toISOString(),
    metadata: {
      previewUrl: run.previewUrl,
      flowGoal: run.flowGoal,
      redisStreamId: event.id,
      tinyfishApis: ['agent.stream', 'browser.sessions.create'],
      playwrightTrace: true,
    },
  });

  await appendTimelineEvent({
    runId: run.id,
    actor: 'tinyfish',
    phase: 'running_browser_qa',
    status: 'started',
    title: 'Opening the app in a real browser with TinyFish.',
    data: {
      previewUrl: run.previewUrl,
      streamId: event.id,
    },
  });

  const flow = await runAgentFlow({
    runId: run.id,
    previewUrl: run.previewUrl,
    flowGoal: run.flowGoal,
    maxAttempts: 2,
  });
  await recordTinyFishAgentFlow(run, event, flow);

  const localResult = await runLocalFlowTest({
    runId: run.id,
    previewUrl: run.previewUrl,
    flowGoal: run.flowGoal,
    label: 'phase4-local-flow',
  });
  await recordPlaywrightEvidence(run, event, localResult);

  await recordTinyFishBrowserSessionEvidence(run, event);

  await recordBenchmarkEvaluation({
    runId: run.id,
    sponsor: 'tinyfish',
    benchmarkName: 'phase4_tinyfish_live_browser_qa',
    score: flow.observation.passed ? 1 : 0,
    status: flow.observation.passed ? 'passed' : 'failed',
    metrics: {
      tinyfishStatus: flow.status,
      tinyfishAttempts: flow.attempts,
      progressEvents: flow.progressEvents.length,
      hasProviderRunId: Boolean(flow.providerRunId),
      hasStreamingUrl: Boolean(flow.streamingUrl),
      hasScreenshot: Boolean(flow.observation.screenshots[0] ?? localResult.screenshotUrl),
    },
    raw: {
      flow,
      localResult,
    },
  });

  return {
    providerRunId: flow.providerRunId,
    status: String(flow.status),
    tinyfishPassed: flow.observation.passed,
    playwrightPassed: localResult.passed,
    screenshotUrl: flow.observation.screenshots[0] ?? localResult.screenshotUrl,
    traceUrl: localResult.traceUrl,
    failureSummary: flow.observation.visibleError
      ?? flow.observation.likelyRootCause
      ?? localResult.visibleError
      ?? localResult.likelyRootCause,
  };
}

async function handleRunStarted(redis: RedisClientType, event: FlowPrRedisEvent): Promise<void> {
  const started = await startIdempotentOperation(redis, event.dedupeKey);

  if (!started) {
    await appendRedisTimeline(event, 'queue', 'skipped', 'Duplicate start request ignored.');
    return;
  }

  try {
    const run = await getRun(event.runId);

    if (!run) {
      throw new Error(`Run ${event.runId} was not found in InsForge`);
    }

    await appendRedisTimeline(event, 'queue', 'completed', 'FlowPR received the run and is about to start.', {
      currentStatus: run.status,
    });
    await recordRedisArtifact(event, 'stream_consumed', {
      currentStatus: run.status,
      consumerGroup: 'flowpr-workers',
    });
    await persistRedisState(redis, event, run.status);
    await emitNextStep(redis, event, resumePhase(run.status), 'Resume or start deterministic state machine.');
    await completeIdempotentOperation(redis, event.dedupeKey);
  } catch (error) {
    await failIdempotentOperation(redis, event.dedupeKey);
    throw error;
  }
}

async function handleLoadingRepo(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'loading_repo');
  await updateAgentSessionsForRun(run.id, 'running', {
    redisStreamId: event.id,
    phase: 'loading_repo',
  });
  await appendRedisTimeline(event, 'loading_repo', 'started', 'Reading the repository.');
  await recordRedisArtifact(event, 'state_transition', { nextStatus: 'loading_repo' });
  await loadGitHubMetadata(run, event);
  await persistRedisState(redis, event, 'loading_repo');
  await emitNextStep(redis, event, 'discovering_flows', 'GitHub metadata is available.');
}

async function handleDiscoveringFlows(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'discovering_flows');
  await appendRedisTimeline(event, 'discovering_flows', 'completed', 'Indexed the user journey FlowPR will protect.', {
    previewUrl: run.previewUrl,
    flowGoal: run.flowGoal,
  });
  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'redis',
    artifactType: 'flow_contract_indexed',
    providerId: event.id,
    requestSummary: {
      stream: event.stream,
      phase: event.phase,
    },
    responseSummary: {
      previewUrl: run.previewUrl,
      flowGoal: run.flowGoal,
      defaultViewport: 'mobile',
    },
    raw: {
      run,
    },
  });
  await persistRedisState(redis, event, 'discovering_flows');
  await emitNextStep(redis, event, 'running_browser_qa', 'Flow contract is ready for browser QA.');
}

async function handleRunningBrowserQa(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'running_browser_qa');
  await appendRedisTimeline(event, 'running_browser_qa', 'started', 'Opening the app in a real browser and trying the user journey.');
  await recordRedisArtifact(event, 'state_transition', { nextStatus: 'running_browser_qa' });
  const outcome = await runBrowserQa(run, event);
  const browserResultStreamId = await emitBrowserResult(redis, {
    runId: run.id,
    providerRunId: outcome.providerRunId,
    status: outcome.status,
  });
  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'redis',
    artifactType: 'browser_result_event',
    providerId: browserResultStreamId,
    requestSummary: {
      stream: flowPrStreams.browserResults,
      eventType: 'browser.result',
    },
    responseSummary: { ...outcome },
    raw: {
      sourceStreamId: event.id,
      outcome,
    },
  });
  await persistRedisState(redis, event, 'running_browser_qa', {
    browserResultStreamId,
    tinyfishRunId: outcome.providerRunId,
    screenshotUrl: outcome.screenshotUrl,
    traceUrl: outcome.traceUrl,
  });
  await emitNextStep(redis, event, 'collecting_visual_evidence', 'Browser QA result event has been published.');
}

async function handleCollectingVisualEvidence(
  redis: RedisClientType,
  run: FlowPrRun,
  event: FlowPrRedisEvent,
): Promise<void> {
  await updateRunStatus(run.id, 'collecting_visual_evidence');
  const observations = await listBrowserObservations(run.id);
  await appendRedisTimeline(event, 'collecting_visual_evidence', 'completed', 'Collected browser evidence from the run.', {
    observationCount: observations.length,
    statuses: observations.map((observation) => observation.status),
  });
  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'redis',
    artifactType: 'browser_evidence_indexed',
    providerId: event.id,
    requestSummary: {
      stream: event.stream,
      phase: event.phase,
    },
    responseSummary: {
      observationCount: observations.length,
      statuses: observations.map((observation) => observation.status),
    },
    raw: {
      observations,
    },
  });
  await persistRedisState(redis, event, 'collecting_visual_evidence');
  await emitNextStep(redis, event, 'triaging_failure', 'Browser evidence is ready for triage.');
}

async function handleTriagingFailure(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'triaging_failure');
  const observations = await listBrowserObservations(run.id);
  const failures = observations.filter((observation) => observation.status === 'failed' || observation.status === 'errored');
  const existingHypotheses = await listBugHypotheses(run.id);
  const policyHits = await listPolicyHits(run.id);
  const triagePolicy: TriagePolicyContext = policyContextFromHits(policyHits);

  if (failures.length === 0) {
    await appendRedisTimeline(event, 'triaging_failure', 'skipped', 'The journey passed, so no failure needs triage.', {
      observationCount: observations.length,
    });
  } else {
    const triage = diagnoseFailure({
      flowGoal: run.flowGoal,
      baselineRisk: run.riskLevel,
      observations,
      policy: triagePolicy,
      memory: { signatureHash: '', priorBugMemory: {}, priorPatchMemory: {} },
    });

    if (existingHypotheses.length === 0) {
      await recordBugHypothesis({
        runId: run.id,
        summary: triage.summary,
        affectedFlow: run.flowGoal,
        suspectedCause: triage.suspectedCause,
        confidence: triage.confidence,
        severity: triage.severity,
        acceptanceCriteria: triage.acceptanceCriteria,
        evidence: {
          bugType: triage.bugType,
          likelyFiles: triage.likelyFiles,
          confidenceScore: triage.confidenceScore,
          hypothesis: triage.hypothesis,
          signature: triage.signature,
          evidence: triage.evidence,
          policyMatched: triagePolicy.acceptanceCriteria.length > 0,
          redisStreamId: event.id,
        },
      });
    }

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'insforge',
      artifactType: 'triage_diagnosis',
      providerId: `triage:${run.id}`,
      requestSummary: {
        observationCount: observations.length,
        failureCount: failures.length,
        flowGoal: run.flowGoal,
      },
      responseSummary: {
        bugType: triage.bugType,
        severity: triage.severity,
        confidence: triage.confidence,
        confidenceScore: triage.confidenceScore,
        likelyFiles: triage.likelyFiles,
        reusedMemory: triage.reusedMemory,
      },
      raw: {
        triage,
      },
    });

    await appendRedisTimeline(event, 'triaging_failure', 'completed', `FlowPR diagnosed ${triage.bugType.replace(/_/g, ' ')} (severity ${triage.severity}).`, {
      failureCount: failures.length,
      bugType: triage.bugType,
      severity: triage.severity,
      confidence: triage.confidence,
      likelyFiles: triage.likelyFiles,
    });
  }

  await recordRedisArtifact(event, 'failure_triage', {
    observationCount: observations.length,
    failureCount: failures.length,
    existingHypothesisCount: existingHypotheses.length,
  });
  await persistRedisState(redis, event, 'triaging_failure');
  await emitNextStep(redis, event, 'retrieving_policy', 'Triage is ready for policy grounding.');
}

async function handleRetrievingPolicy(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'retrieving_policy');
  await appendRedisTimeline(event, 'retrieving_policy', 'started', 'Checking the team’s product rulebook for relevant acceptance criteria.');
  await recordRedisArtifact(event, 'state_transition', { nextStatus: 'retrieving_policy' });
  await querySensoPolicy(run, event);
  await persistRedisState(redis, event, 'retrieving_policy');
  await emitNextStep(redis, event, 'searching_memory', 'Policy context has been retrieved or intentionally skipped.');
}

async function handleSearchingMemory(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'searching_memory');
  const observations = await listBrowserObservations(run.id);
  const latest = latestObservation(observations);
  const hypotheses = await listBugHypotheses(run.id);
  const latestHypothesis = hypotheses[hypotheses.length - 1];
  const bugType = (latestHypothesis?.evidence as Record<string, unknown> | undefined)?.bugType as string | undefined
    ?? 'unknown';
  const domFinding = (latestHypothesis?.evidence as Record<string, unknown> | undefined)?.evidence as
    | { topDomFinding?: string }
    | undefined;
  const signatureHash = createBugSignatureHash({
    repo: `${run.owner}/${run.repo}`,
    flowGoal: run.flowGoal,
    observedBehavior: latest?.observedBehavior,
    status: latest?.status,
    bugType,
    failedStep: latest?.failedStep ?? 'unknown',
    topDomFinding: domFinding?.topDomFinding ?? 'no-dom',
  });
  const bugMemory = await lookupBugSignatureMemory(redis, signatureHash);
  const patchMemory = await lookupSuccessfulPatchMemory(redis, signatureHash);

  await appendRedisTimeline(event, 'searching_memory', 'completed', 'Checked memory for similar failures FlowPR has already solved.', {
    signatureHash,
    bugMemoryHit: Object.keys(bugMemory).length > 0,
    patchMemoryHit: Object.keys(patchMemory).length > 0,
  });
  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'redis',
    artifactType: 'memory_lookup',
    providerId: event.id,
    requestSummary: {
      bugSignatureKey: redisMemoryKeys.bugSignature(signatureHash),
      successfulPatchKey: redisMemoryKeys.successfulPatch(signatureHash),
      streamId: event.id,
    },
    responseSummary: {
      signatureHash,
      bugMemoryHit: Object.keys(bugMemory).length > 0,
      patchMemoryHit: Object.keys(patchMemory).length > 0,
    },
    raw: {
      bugMemory,
      patchMemory,
      latestObservation: latest,
    },
  });
  await recordAgentMemory({
    projectId: run.projectId,
    runId: run.id,
    scope: 'redis_bug_signature',
    key: signatureHash,
    value: {
      bugMemoryHit: Object.keys(bugMemory).length > 0,
      patchMemoryHit: Object.keys(patchMemory).length > 0,
      redisStreamId: event.id,
    },
    confidence: 1,
  });
  await persistRedisState(redis, event, 'searching_memory', { signatureHash });
  await emitNextStep(redis, event, 'patching_code', 'Redis memory lookup finished.');
}

async function ensureGuildSession(run: FlowPrRun, event: FlowPrRedisEvent): Promise<string> {
  const existing = await (await import('@flowpr/tools')).listAgentSessions(run.id);
  const current = existing.find((session) => session.status === 'running' || session.status === 'created');

  if (current?.providerSessionId) {
    return current.providerSessionId;
  }

  const guildSession = await startAgentSession({
    runId: run.id,
    agentName: run.agentName,
    agentVersion: run.agentVersion,
    permissionProfile: run.permissionProfile,
    flowGoal: run.flowGoal,
    repoUrl: run.repoUrl,
  });

  const { recordAgentSession } = await import('@flowpr/tools');
  await recordAgentSession({
    runId: run.id,
    sponsor: 'guildai',
    providerSessionId: guildSession.sessionId,
    status: 'running',
    goal: `FlowPR autonomous session for ${run.flowGoal}`,
    metadata: {
      agentVersion: guildSession.agentVersion,
      permissionProfile: guildSession.permissionProfile,
      traceUrl: guildSession.traceUrl,
      traceId: guildSession.traceId,
      redisStreamId: event.id,
      provider: guildSession.provider,
    },
    startedAt: guildSession.startedAt,
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'guildai',
    artifactType: 'agent_session_started',
    providerId: guildSession.sessionId,
    artifactUrl: guildSession.traceUrl,
    requestSummary: {
      agent: guildSession.agentName,
      version: guildSession.agentVersion,
      permissionProfile: guildSession.permissionProfile,
    },
    responseSummary: {
      sessionId: guildSession.sessionId,
      traceId: guildSession.traceId,
      provider: guildSession.provider,
    },
    raw: guildSession as unknown as Record<string, unknown>,
  });

  return guildSession.sessionId;
}

async function handlePatchingCode(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'patching_code');
  const owner = `${process.pid}:${event.id}`;
  const lockKey = redisLockKeys.patch(run.id);
  const locked = await acquireRedisLock(redis, lockKey, owner);

  if (!locked) {
    throw new Error(`Patch lock ${lockKey} is already held`);
  }

  try {
    await recordActionGate({
      runId: run.id,
      gateType: 'redis_patch_lock',
      riskLevel: run.riskLevel,
      status: 'allowed',
      reason: 'Redis patch lock prevents duplicate code mutation for this run.',
      requestedBy: 'worker',
      resolvedBy: 'redis',
      resolvedAt: new Date().toISOString(),
      metadata: {
        lockKey,
        redisStreamId: event.id,
      },
    });

    const hypotheses = await listBugHypotheses(run.id);
    const hypothesis = hypotheses[hypotheses.length - 1];

    if (!hypothesis) {
      await appendRedisTimeline(event, 'patching_code', 'skipped', 'No diagnosis is available yet, so FlowPR skipped preparing a patch.', {
        lockKey,
      });
      await persistRedisState(redis, event, 'patching_code', { reason: 'no-hypothesis' });
      return;
    }

    const sessionId = await ensureGuildSession(run, event);
    const evidenceRecord = (hypothesis.evidence ?? {}) as Record<string, unknown>;
    const bugType = (evidenceRecord.bugType as string | undefined) ?? 'unknown';
    const rawLikelyFiles = Array.isArray(evidenceRecord.likelyFiles) ? evidenceRecord.likelyFiles : [];
    const likelyFiles = rawLikelyFiles.filter((value): value is string => typeof value === 'string');
    const triage: TriageOutput = {
      bugType: bugType as TriageOutput['bugType'],
      severity: hypothesis.severity,
      confidence: hypothesis.confidence,
      confidenceScore: Number(evidenceRecord.confidenceScore ?? 0.75),
      hypothesis: (evidenceRecord.hypothesis as string | undefined) ?? hypothesis.summary,
      summary: hypothesis.summary,
      likelyFiles,
      suspectedCause: hypothesis.suspectedCause ?? '',
      acceptanceCriteria: hypothesis.acceptanceCriteria,
      evidence: {
        provider: 'mixed',
        consoleErrors: [],
        networkErrors: [],
        topDomFinding: (((evidenceRecord.evidence as Record<string, unknown> | undefined)?.topDomFinding) as string | undefined) ?? '',
        failedStep: (((evidenceRecord.evidence as Record<string, unknown> | undefined)?.failedStep) as string | undefined) ?? 'unknown-step',
      },
      signature: (evidenceRecord.signature as TriageOutput['signature'] | undefined) ?? {
        bugType: bugType as TriageOutput['signature']['bugType'],
        failedStep: 'unknown',
        topDomFinding: 'no-dom',
        flowGoalKey: 'generic-flow',
      },
      reusedMemory: false,
    };

    const gate = await requestActionGate({
      sessionId,
      runId: run.id,
      action: 'generate_patch',
      riskLevel: run.riskLevel,
      filesChanged: likelyFiles,
      verificationStatus: 'pending',
      extra: { bugType, confidence: hypothesis.confidence },
    });

    await recordActionGate({
      runId: run.id,
      gateType: 'guildai_generate_patch',
      riskLevel: run.riskLevel,
      status: gate.decision === 'allowed' ? 'allowed' : gate.decision === 'requires_approval' ? 'pending' : 'blocked',
      reason: gate.reason,
      requestedBy: 'flowpr-autonomous-frontend-qa',
      resolvedBy: 'guildai',
      resolvedAt: new Date().toISOString(),
      metadata: {
        providerDecisionId: gate.providerDecisionId,
        permissionProfile: gate.permissionProfile,
        sessionId,
      },
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'guildai',
      artifactType: 'action_gate_generate_patch',
      providerId: gate.providerDecisionId,
      requestSummary: {
        sessionId,
        filesChanged: likelyFiles,
        riskLevel: run.riskLevel,
      },
      responseSummary: {
        decision: gate.decision,
        permissionProfile: gate.permissionProfile,
        reason: gate.reason,
      },
      raw: gate as unknown as Record<string, unknown>,
    });

    if (gate.decision === 'denied') {
      await appendRedisTimeline(event, 'patching_code', 'failed', 'Guild.ai held the patch for human review — FlowPR stopped before changing code.', {
        lockKey,
        reason: gate.reason,
      });

      await recordPatch({
        runId: run.id,
        hypothesisId: hypothesis.id,
        status: 'abandoned',
        summary: `Patch denied by Guild.ai: ${gate.reason}`,
        diffStat: {},
        filesChanged: [],
        raw: { gate },
      });

      await persistRedisState(redis, event, 'patching_code', {
        gateDecision: gate.decision,
      });
      await emitNextStep(redis, event, 'running_local_tests', 'Patch was denied; recording verification as skipped.');
      return;
    }

    const patchStart = Date.now();
    const patchResult = await generateDemoCookieBannerPatch({
      runId: run.id,
      repoUrl: run.repoUrl,
      baseBranch: run.baseBranch,
      triage,
      authToken: process.env.GITHUB_TOKEN,
    });

    await recordToolCall({
      sessionId,
      provider: 'github',
      action: 'clone_and_patch',
      status: 'succeeded',
      durationMs: Date.now() - patchStart,
      artifactId: patchResult.commitSha,
      metadata: { branch: patchResult.plan.branchName },
    });

    const { result: patchRecord, artifact: wgArtifact } = await executeSafeOperation({
      operation: 'recordPatch',
      runId: run.id,
      actorSessionId: sessionId,
      input: {
        branchName: patchResult.plan.branchName,
        commitSha: patchResult.commitSha,
        filesChanged: patchResult.filesChanged,
        testPath: patchResult.plan.testPath,
      },
      executor: () => recordPatch({
        runId: run.id,
        hypothesisId: hypothesis.id,
        branchName: patchResult.plan.branchName,
        commitSha: patchResult.commitSha,
        status: 'generated',
        summary: patchResult.plan.explanation,
        diffStat: patchResult.diffStat as unknown as Record<string, unknown>,
        filesChanged: patchResult.plan.files as unknown as Record<string, unknown>[],
        raw: patchResult.raw,
      }),
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'wundergraph',
      artifactType: 'safe_operation_execution',
      providerId: wgArtifact.executionId,
      requestSummary: wgArtifact.requestSignature,
      responseSummary: wgArtifact.responseSummary,
      raw: {
        operation: wgArtifact.operation,
        transport: wgArtifact.transport,
        endpoint: wgArtifact.endpoint,
      },
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'github',
      artifactType: 'patch_commit',
      providerId: patchResult.commitSha,
      requestSummary: {
        branch: patchResult.plan.branchName,
        baseBranch: run.baseBranch,
        filesChanged: patchResult.filesChanged,
      },
      responseSummary: {
        diffStat: patchResult.diffStat,
        commitSha: patchResult.commitSha,
      },
      raw: { plan: patchResult.plan },
    });

    const patchStreamId = await emitPatchResult(redis, {
      runId: run.id,
      status: 'generated',
      lockKey,
    });
    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'redis',
      artifactType: 'patch_lock_verified',
      providerId: patchStreamId,
      requestSummary: {
        lockKey,
        stream: flowPrStreams.patches,
      },
      responseSummary: {
        lockAcquired: true,
        patchStreamId,
        patchId: patchRecord.id,
      },
      raw: {
        sourceStreamId: event.id,
      },
    });

    await appendRedisTimeline(event, 'patching_code', 'completed', `Prepared a focused patch on branch ${patchResult.plan.branchName}.`, {
      lockKey,
      branchName: patchResult.plan.branchName,
      commitSha: patchResult.commitSha,
      filesChanged: patchResult.filesChanged,
    });

    await persistRedisState(redis, event, 'patching_code', {
      patchStreamId,
      branchName: patchResult.plan.branchName,
      commitSha: patchResult.commitSha,
      workspaceDir: patchResult.workspace.dir,
      patchId: patchRecord.id,
    });
  } finally {
    await releaseRedisLock(redis, lockKey, owner);
  }

  await emitNextStep(redis, event, 'running_local_tests', 'Patch is ready for local verification.');
}

async function handleRunningLocalTests(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'running_local_tests');
  const state = await redis.hGetAll(`flowpr:run_state:${run.id}`);
  const workspaceDir = state?.workspaceDir;
  const patches = await listPatches(run.id);
  const latestPatch = patches[patches.length - 1];

  if (!workspaceDir || !latestPatch) {
    await appendRedisTimeline(event, 'running_local_tests', 'skipped', 'No local workspace is available, so FlowPR skipped local verification.', {
      workspaceDir,
    });
    await persistRedisState(redis, event, 'running_local_tests', { reason: 'no-workspace' });
    await emitNextStep(redis, event, 'running_live_verification', 'Local verification skipped.');
    return;
  }

  const verificationStart = Date.now();
  const verification = await runLocalVerification({
    dir: workspaceDir,
    installDependencies: false,
    onlyTypecheck: true,
  });

  const { result: verificationRecord, artifact: wgArtifact } = await executeSafeOperation({
    operation: 'markVerification',
    runId: run.id,
    input: {
      provider: 'playwright-local',
      status: verification.overallStatus,
      workspace: workspaceDir,
      steps: verification.steps.map((step) => ({ step: step.step, status: step.status, duration: step.durationMs })),
    },
    executor: () => recordVerificationResult({
      runId: run.id,
      patchId: latestPatch.id,
      provider: 'local',
      status: verification.overallStatus,
      summary: verification.summary,
      testCommand: verification.steps.map((step) => step.command).join(' && '),
      artifacts: verification.steps.map((step) => ({ step: step.step, status: step.status, durationMs: step.durationMs })),
      raw: { steps: verification.steps },
    }),
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'wundergraph',
    artifactType: 'safe_operation_execution',
    providerId: wgArtifact.executionId,
    requestSummary: wgArtifact.requestSignature,
    responseSummary: wgArtifact.responseSummary,
    raw: {
      operation: wgArtifact.operation,
      transport: wgArtifact.transport,
      endpoint: wgArtifact.endpoint,
    },
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'playwright',
    artifactType: 'local_verification',
    providerId: `local:${run.id}:${verificationRecord.id}`,
    requestSummary: {
      workspace: workspaceDir,
      steps: verification.steps.map((step) => step.step),
      durationMs: Date.now() - verificationStart,
    },
    responseSummary: {
      overallStatus: verification.overallStatus,
      summary: verification.summary,
    },
    raw: { steps: verification.steps },
  });

  await appendRedisTimeline(event, 'running_local_tests', verification.overallStatus === 'passed' ? 'completed' : 'failed', `Local verification ${verification.overallStatus}: ${verification.summary}`, {
    overallStatus: verification.overallStatus,
    steps: verification.steps.map((step) => ({ step: step.step, status: step.status })),
  });

  await persistRedisState(redis, event, 'running_local_tests', {
    localStatus: verification.overallStatus,
    localVerificationId: verificationRecord.id,
  });
  await emitNextStep(redis, event, 'running_live_verification', 'Local verification recorded.');
}

async function handleRunningLiveVerification(
  redis: RedisClientType,
  run: FlowPrRun,
  event: FlowPrRedisEvent,
): Promise<void> {
  const rerunMode = event.payload?.mode === 'rerun';
  const previousStatus = rerunMode ? run.status : undefined;
  await updateRunStatus(run.id, 'running_live_verification');
  const patches = await listPatches(run.id);
  const latestPatch = patches[patches.length - 1];
  const hasPatch = Boolean(latestPatch && latestPatch.status === 'generated');
  const skip = !hasPatch || !process.env.TINYFISH_API_KEY;

  const liveResult = await runLiveVerification({
    runId: run.id,
    previewUrl: run.previewUrl,
    flowGoal: run.flowGoal,
    maxAttempts: 2,
    skip,
    label: 'phase8-reverification',
  });

  const verificationResults = await listVerificationResults(run.id);
  const localResult = verificationResults.find((result) => result.provider === 'local');
  const localStatus = localResult?.status ?? 'skipped';

  const overallStatus: 'passed' | 'failed' | 'errored' | 'skipped' = liveResult.status === 'passed'
    && (localStatus === 'passed' || localStatus === 'skipped')
    ? 'passed'
    : liveResult.status === 'skipped' && localStatus === 'passed'
      ? 'passed'
      : liveResult.status === 'errored'
        ? 'errored'
        : liveResult.status === 'skipped'
          ? 'skipped'
          : 'failed';

  const { result: verificationRecord, artifact: wgArtifact } = await executeSafeOperation({
    operation: 'markVerification',
    runId: run.id,
    input: {
      provider: 'tinyfish-live',
      status: overallStatus,
      attempts: liveResult.attempts,
      tinyfishRunId: liveResult.tinyfishRunId,
    },
    executor: () => recordVerificationResult({
      runId: run.id,
      patchId: latestPatch?.id,
      provider: 'tinyfish-live',
      status: overallStatus,
      summary: liveResult.summary,
      testCommand: 'tinyfish:agent.stream',
      artifacts: [
        {
          sponsor: 'tinyfish',
          providerId: liveResult.tinyfishRunId,
          screenshotUrl: liveResult.screenshotUrl,
          traceUrl: liveResult.traceUrl,
        },
      ],
      raw: {
        live: liveResult,
        localStatus,
      },
    }),
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'wundergraph',
    artifactType: 'safe_operation_execution',
    providerId: wgArtifact.executionId,
    requestSummary: wgArtifact.requestSignature,
    responseSummary: wgArtifact.responseSummary,
    raw: {
      operation: wgArtifact.operation,
      transport: wgArtifact.transport,
      endpoint: wgArtifact.endpoint,
    },
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'tinyfish',
    artifactType: 'live_reverification',
    providerId: liveResult.tinyfishRunId,
    artifactUrl: liveResult.screenshotUrl,
    requestSummary: {
      previewUrl: run.previewUrl,
      flowGoal: run.flowGoal,
      attempts: liveResult.attempts,
      skipped: skip,
    },
    responseSummary: {
      status: liveResult.status,
      summary: liveResult.summary,
      localStatus,
      overallStatus,
    },
    raw: liveResult as unknown as Record<string, unknown>,
  });

  const verificationStreamId = await emitVerificationResult(redis, {
    runId: run.id,
    provider: 'tinyfish-live',
    status: overallStatus,
  });

  await appendRedisTimeline(event, 'running_live_verification', overallStatus === 'failed' ? 'failed' : 'completed', `${rerunMode ? 'User-triggered rerun' : 'Re-ran the journey in a real browser'} — result: ${overallStatus}. ${liveResult.summary}`, {
    verificationStreamId,
    status: overallStatus,
    attempts: liveResult.attempts,
    localStatus,
    rerunMode,
  });

  await persistRedisState(redis, event, 'running_live_verification', {
    verificationStreamId,
    liveStatus: liveResult.status,
    overallStatus,
    verificationId: verificationRecord.id,
    rerunMode: rerunMode ? 'true' : undefined,
  });

  if (rerunMode) {
    if (previousStatus && previousStatus !== 'running_live_verification') {
      await updateRunStatus(run.id, previousStatus);
    }
    await appendTimelineEvent({
      runId: run.id,
      actor: 'worker',
      phase: 'running_live_verification',
      status: 'info',
      title: 'Rerun verification finished without advancing the state machine.',
      data: {
        previousStatus,
        overallStatus,
        verificationId: verificationRecord.id,
      },
    });
    return;
  }

  await emitNextStep(redis, event, 'creating_pr', 'Live verification completed.');
}

async function handleCreatingPr(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'creating_pr');
  const lockOwner = `${process.pid}:${event.id}`;
  const lockKey = redisLockKeys.pr(run.id);
  const locked = await acquireRedisLock(redis, lockKey, lockOwner);

  if (!locked) {
    throw new Error(`PR lock ${lockKey} is already held`);
  }

  try {
    await recordActionGate({
      runId: run.id,
      gateType: 'redis_pr_lock',
      riskLevel: run.riskLevel,
      status: 'allowed',
      reason: 'Redis PR lock prevents duplicate pull request creation for this run.',
      requestedBy: 'worker',
      resolvedBy: 'redis',
      resolvedAt: new Date().toISOString(),
      metadata: {
        lockKey,
        redisStreamId: event.id,
      },
    });

    const patches = await listPatches(run.id);
    const latestPatch = patches[patches.length - 1];

    if (!latestPatch || latestPatch.status === 'abandoned') {
      await appendRedisTimeline(event, 'creating_pr', 'skipped', 'No patch is available, so FlowPR did not open a pull request.', {
        lockKey,
      });
      await persistRedisState(redis, event, 'creating_pr', { reason: 'no-patch' });
      await emitNextStep(redis, event, 'publishing_artifacts', 'PR step skipped due to missing patch.');
      return;
    }

    const verificationResults = await listVerificationResults(run.id);
    const liveVerification = verificationResults.find((result) => result.provider === 'tinyfish-live');
    const verificationStatus = liveVerification?.status === 'passed'
      ? 'passed'
      : liveVerification?.status === 'failed' || liveVerification?.status === 'errored'
        ? 'failed'
        : 'pending';

    const sessionId = await ensureGuildSession(run, event);
    const filesChanged = Array.isArray(latestPatch.filesChanged)
      ? (latestPatch.filesChanged as Array<Record<string, unknown>>).map((file) => String(file.path ?? '')).filter(Boolean)
      : [];
    const gate = await requestActionGate({
      sessionId,
      runId: run.id,
      action: 'create_pull_request',
      riskLevel: run.riskLevel,
      filesChanged,
      verificationStatus,
      extra: { branchName: latestPatch.branchName },
    });

    await recordActionGate({
      runId: run.id,
      gateType: 'guildai_create_pull_request',
      riskLevel: run.riskLevel,
      status: gate.decision === 'allowed' ? 'allowed' : gate.decision === 'requires_approval' ? 'pending' : 'blocked',
      reason: gate.reason,
      requestedBy: 'flowpr-autonomous-frontend-qa',
      resolvedBy: 'guildai',
      resolvedAt: new Date().toISOString(),
      metadata: {
        providerDecisionId: gate.providerDecisionId,
        permissionProfile: gate.permissionProfile,
        filesChanged,
        verificationStatus,
      },
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'guildai',
      artifactType: 'action_gate_create_pull_request',
      providerId: gate.providerDecisionId,
      requestSummary: {
        sessionId,
        filesChanged,
        verificationStatus,
      },
      responseSummary: {
        decision: gate.decision,
        permissionProfile: gate.permissionProfile,
        reason: gate.reason,
        requiresApproval: gate.requiresApproval,
      },
      raw: gate as unknown as Record<string, unknown>,
    });

    if (gate.decision === 'denied') {
      await appendRedisTimeline(event, 'creating_pr', 'failed', 'Guild.ai held the pull request for human review.', {
        reason: gate.reason,
      });
      await recordPullRequest({
        runId: run.id,
        patchId: latestPatch.id,
        provider: 'github',
        title: 'FlowPR PR blocked by Guild.ai gate',
        branchName: latestPatch.branchName ?? 'flowpr/blocked',
        baseBranch: run.baseBranch,
        status: 'failed',
        raw: { gate },
      });
      await persistRedisState(redis, event, 'creating_pr', { gateDecision: gate.decision });
      await emitNextStep(redis, event, 'publishing_artifacts', 'PR was denied; continuing the loop.');
      return;
    }

    const state = await redis.hGetAll(`flowpr:run_state:${run.id}`);
    const workspaceDir = state?.workspaceDir;

    if (!workspaceDir) {
      await appendRedisTimeline(event, 'creating_pr', 'skipped', 'The patched workspace is not available, so FlowPR could not push a branch.', {});
      await persistRedisState(redis, event, 'creating_pr', { reason: 'no-workspace' });
      await emitNextStep(redis, event, 'publishing_artifacts', 'PR step skipped without workspace.');
      return;
    }

    const observations = await listBrowserObservations(run.id);
    const primaryBefore = observations.find((observation) => observation.status === 'failed' || observation.status === 'errored');
    const policyHits = await listPolicyHits(run.id);
    const hypotheses = await listBugHypotheses(run.id);
    const hypothesis = hypotheses[hypotheses.length - 1];
    const triage: TriageOutput = hypothesis
      ? {
          bugType: (((hypothesis.evidence ?? {}) as Record<string, unknown>).bugType as TriageOutput['bugType']) ?? 'unknown',
          severity: hypothesis.severity,
          confidence: hypothesis.confidence,
          confidenceScore: Number(((hypothesis.evidence ?? {}) as Record<string, unknown>).confidenceScore ?? 0.8),
          hypothesis: (((hypothesis.evidence ?? {}) as Record<string, unknown>).hypothesis as string | undefined) ?? hypothesis.summary,
          summary: hypothesis.summary,
          likelyFiles: Array.isArray(((hypothesis.evidence ?? {}) as Record<string, unknown>).likelyFiles)
            ? ((((hypothesis.evidence ?? {}) as Record<string, unknown>).likelyFiles as unknown[]).filter((value): value is string => typeof value === 'string'))
            : filesChanged,
          suspectedCause: hypothesis.suspectedCause ?? '',
          acceptanceCriteria: hypothesis.acceptanceCriteria,
          evidence: { provider: 'mixed', consoleErrors: [], networkErrors: [], topDomFinding: '', failedStep: primaryBefore?.failedStep ?? 'unknown-step' },
          signature: {
            bugType: ((((hypothesis.evidence ?? {}) as Record<string, unknown>).bugType as string | undefined) ?? 'unknown') as TriageOutput['signature']['bugType'],
            failedStep: primaryBefore?.failedStep ?? 'unknown',
            topDomFinding: 'no-dom',
            flowGoalKey: 'generic-flow',
          },
          reusedMemory: false,
        }
      : {
          bugType: 'unknown',
          severity: run.riskLevel,
          confidence: 'medium',
          confidenceScore: 0.6,
          hypothesis: 'FlowPR produced a patch based on recorded evidence.',
          summary: 'FlowPR produced a patch.',
          likelyFiles: filesChanged,
          suspectedCause: 'Derived from evidence aggregation.',
          acceptanceCriteria: [{ text: run.flowGoal, source: 'dashboard_input' }],
          evidence: { provider: 'mixed', consoleErrors: [], networkErrors: [], topDomFinding: '', failedStep: 'unknown-step' },
          signature: { bugType: 'unknown', failedStep: 'unknown', topDomFinding: 'no-dom', flowGoalKey: 'generic-flow' },
          reusedMemory: false,
        };

    const patchPayload = ((latestPatch.raw as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>;

    const generatedPatchSurrogate = {
      commitSha: latestPatch.commitSha ?? 'unknown',
      plan: {
        branchName: latestPatch.branchName ?? 'flowpr/branch',
        commitMessage: latestPatch.summary,
        explanation: latestPatch.summary,
        testPath: 'apps/demo-target/tests/checkout-mobile-regression.spec.ts',
        files: (latestPatch.filesChanged as Array<Record<string, unknown>>).map((file) => ({
          path: String(file.path ?? ''),
          action: (file.action as 'patch' | 'create' | 'replace') ?? 'patch',
          summary: String(file.summary ?? ''),
        })),
      },
      workspace: {
        runId: run.id,
        dir: workspaceDir,
        headSha: String(patchPayload.headSha ?? ''),
        remoteUrl: run.repoUrl,
      },
      filesChanged,
      diffStat: (latestPatch.diffStat as { filesChanged: number; insertions: number; deletions: number } | undefined)
        ?? { filesChanged: filesChanged.length, insertions: 0, deletions: 0 },
      preFixStyles: '',
      postFixStyles: '',
      regressionTestContent: '',
      raw: patchPayload,
    };

    const citations = policyHits.map((hit) => ({
      title: hit.title ?? hit.provider,
      url: hit.sourceUrl,
      excerpt: hit.summary,
    }));

    const localVerificationRecord = verificationResults.find((result) => result.provider === 'local');
    const localArtifacts = Array.isArray(localVerificationRecord?.raw?.steps)
      ? (localVerificationRecord?.raw?.steps as Array<Record<string, unknown>>)
      : [];
    const localVerificationSurrogate = {
      dir: workspaceDir,
      overallStatus: (localVerificationRecord?.status ?? 'skipped') as 'passed' | 'failed' | 'errored' | 'skipped',
      summary: localVerificationRecord?.summary ?? 'Local verification not recorded.',
      steps: localArtifacts.map((step) => ({
        step: (step.step as 'typecheck' | 'lint' | 'unit' | 'e2e') ?? 'typecheck',
        status: (step.status as 'passed' | 'failed' | 'skipped' | 'errored') ?? 'skipped',
        command: String(step.command ?? ''),
        durationMs: Number(step.durationMs ?? 0),
        exitCode: Number(step.exitCode ?? 0),
        stdoutExcerpt: String(step.stdoutExcerpt ?? ''),
        stderrExcerpt: String(step.stderrExcerpt ?? ''),
      })),
    };

    const liveVerificationSurrogate = liveVerification
      ? {
          status: (liveVerification.status === 'errored' ? 'errored' : liveVerification.status) as 'passed' | 'failed' | 'errored' | 'skipped',
          attempts: Number(((liveVerification.raw ?? {}) as Record<string, unknown>).attempts ?? 1),
          summary: liveVerification.summary,
          tinyfishRunId: ((liveVerification.artifacts ?? [])[0] as Record<string, unknown> | undefined)?.providerId as string | undefined,
          finalUrl: undefined,
          screenshotUrl: ((liveVerification.artifacts ?? [])[0] as Record<string, unknown> | undefined)?.screenshotUrl as string | undefined,
          traceUrl: ((liveVerification.artifacts ?? [])[0] as Record<string, unknown> | undefined)?.traceUrl as string | undefined,
          lastError: undefined,
        }
      : undefined;

    const allowOpenPr = run.permissionProfile === 'verified-pr';
    const draftPr = !allowOpenPr || verificationStatus !== 'passed';
    const { result: prOutcome, artifact: wgArtifact } = await executeSafeOperation({
      operation: 'createPullRequest',
      runId: run.id,
      actorSessionId: sessionId,
      input: {
        branch: latestPatch.branchName,
        baseBranch: run.baseBranch,
        draft: draftPr,
        permissionProfile: run.permissionProfile,
      },
      executor: () => createPullRequestForRun({
        runId: run.id,
        owner: run.owner,
        repo: run.repo,
        baseBranch: run.baseBranch,
        previewUrl: run.previewUrl,
        flowGoal: run.flowGoal,
        triage,
        patch: generatedPatchSurrogate,
        localVerification: localVerificationSurrogate,
        liveVerification: liveVerificationSurrogate,
        tinyfishRunId: liveVerificationSurrogate?.tinyfishRunId,
        traceUrl: primaryBefore?.traceUrl,
        beforeScreenshotUrl: primaryBefore?.screenshotUrl,
        afterScreenshotUrl: liveVerificationSurrogate?.screenshotUrl,
        policyCitations: citations,
        guildSessionTraceUrl: undefined,
        guildSessionId: sessionId,
        gateDecision: gate,
        draft: draftPr,
      }),
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'wundergraph',
      artifactType: 'safe_operation_execution',
      providerId: wgArtifact.executionId,
      requestSummary: wgArtifact.requestSignature,
      responseSummary: wgArtifact.responseSummary,
      raw: {
        operation: wgArtifact.operation,
        transport: wgArtifact.transport,
        endpoint: wgArtifact.endpoint,
      },
    });

    await recordPullRequest({
      runId: run.id,
      patchId: latestPatch.id,
      provider: 'github',
      number: prOutcome.summary.number,
      title: prOutcome.summary.title,
      branchName: prOutcome.summary.branch,
      baseBranch: prOutcome.summary.base,
      url: prOutcome.summary.url,
      status: prOutcome.summary.draft ? 'draft' : 'open',
      raw: { body: prOutcome.body, pushed: prOutcome.pushed, summary: prOutcome.summary },
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'github',
      artifactType: 'pull_request',
      providerId: String(prOutcome.summary.number),
      artifactUrl: prOutcome.summary.url,
      requestSummary: {
        head: prOutcome.summary.branch,
        base: prOutcome.summary.base,
        title: prOutcome.summary.title,
      },
      responseSummary: {
        number: prOutcome.summary.number,
        url: prOutcome.summary.url,
        draft: prOutcome.summary.draft,
        state: prOutcome.summary.state,
      },
      raw: { pushed: prOutcome.pushed },
    });

    await appendRedisTimeline(event, 'creating_pr', 'completed', `Opened pull request #${prOutcome.summary.number} with the full evidence packet.`, {
      lockKey,
      pullRequestUrl: prOutcome.summary.url,
      branch: prOutcome.summary.branch,
      draft: prOutcome.summary.draft,
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'redis',
      artifactType: 'pr_lock_verified',
      providerId: event.id,
      requestSummary: { lockKey, baseBranch: run.baseBranch },
      responseSummary: {
        lockAcquired: true,
        pullRequestNumber: prOutcome.summary.number,
        pullRequestUrl: prOutcome.summary.url,
      },
      raw: { streamId: event.id },
    });

    await persistRedisState(redis, event, 'creating_pr', {
      pullRequestNumber: prOutcome.summary.number,
      pullRequestUrl: prOutcome.summary.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendRedisTimeline(event, 'creating_pr', 'failed', `FlowPR could not open the pull request: ${message}`, {});
    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'github',
      artifactType: 'pull_request_error',
      requestSummary: { baseBranch: run.baseBranch },
      responseSummary: { error: message },
      raw: { error: message },
    });
    await persistRedisState(redis, event, 'creating_pr', { error: message });
  } finally {
    await releaseRedisLock(redis, lockKey, lockOwner);
  }

  await emitNextStep(redis, event, 'publishing_artifacts', 'PR step complete.');
}

async function handlePublishingArtifacts(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'publishing_artifacts');
  const stats = await getRedisStreamStats(redis);
  const recentRunEvents = await listRedisStreamEntries(redis, flowPrStreams.runs, 5);
  const recentAgentSteps = await listRedisStreamEntries(redis, flowPrStreams.agentSteps, 5);

  await appendRedisTimeline(event, 'publishing_artifacts', 'completed', 'Saved the run evidence and event history.', {
    streamCount: stats.length,
    latestRunStreamId: recentRunEvents[0]?.id,
    latestAgentStepStreamId: recentAgentSteps[0]?.id,
  });
  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'redis',
    artifactType: 'stream_snapshot',
    providerId: event.id,
    requestSummary: {
      streams: stats.map((stat) => stat.stream),
      streamId: event.id,
    },
    responseSummary: {
      streamLengths: Object.fromEntries(stats.map((stat) => [stat.stream, stat.length])),
    },
    raw: {
      stats,
      recentRunEvents,
      recentAgentSteps,
    },
  });

  const [observations, hypotheses, patches, pullRequests, verificationResults, policyHits] = await Promise.all([
    listBrowserObservations(run.id),
    listBugHypotheses(run.id),
    listPatches(run.id),
    listPullRequests(run.id),
    listVerificationResults(run.id),
    listPolicyHits(run.id),
  ]);

  const reportDecision = shouldProduceInvestigationReport({
    pullRequests,
    browserObservations: observations,
    verificationResults,
  });

  if (reportDecision.needed) {
    const report = buildInvestigationReport({
      run,
      browserObservations: observations,
      bugHypotheses: hypotheses,
      patches,
      pullRequests,
      verificationResults,
      policyHits,
      reason: reportDecision.reason,
    });

    let artifactUrl: string | undefined;
    let storageKey: string | undefined;

    try {
      const storageResult = await uploadRunArtifact({
        key: `runs/${run.id}/investigation-reports/${Date.now()}.md`,
        body: report.markdown,
        contentType: 'text/markdown',
      });
      artifactUrl = storageResult.url;
      storageKey = storageResult.key;
    } catch (uploadError) {
      // Storage is best-effort — keep the markdown inline via the raw field.
      console.warn('Investigation report storage upload failed', uploadError);
    }

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'insforge',
      artifactType: 'investigation_report',
      providerId: `investigation:${run.id}`,
      artifactUrl,
      requestSummary: {
        reason: reportDecision.reason,
        flowGoal: run.flowGoal,
        storageKey,
      },
      responseSummary: {
        summary: report.summary,
        structured: report.structured,
      },
      raw: {
        markdown: report.markdown,
        generatedAt: report.generatedAt,
      },
    });

    await appendRedisTimeline(event, 'publishing_artifacts', 'info', 'Investigation report ready for human review.', {
      reason: reportDecision.reason,
      artifactUrl,
    });
  }

  await persistRedisState(redis, event, 'publishing_artifacts', {
    investigationReportGenerated: reportDecision.needed,
  });
  await emitNextStep(redis, event, 'learned', 'Artifacts and report saved; advancing to learning.');
}

async function handleLearned(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'learned');
  const observations = await listBrowserObservations(run.id);
  const latest = latestObservation(observations);
  const verificationResults = await listVerificationResults(run.id);
  const liveVerification = verificationResults.find((result) => result.provider === 'tinyfish-live');
  const hypotheses = await listBugHypotheses(run.id);
  const latestHypothesis = hypotheses[hypotheses.length - 1];
  const hypothesisEvidence = (latestHypothesis?.evidence ?? {}) as Record<string, unknown>;
  const bugType = (hypothesisEvidence.bugType as string | undefined) ?? 'unknown';
  const signatureHash = createBugSignatureHash({
    repo: `${run.owner}/${run.repo}`,
    flowGoal: run.flowGoal,
    observedBehavior: latest?.observedBehavior,
    status: latest?.status,
    bugType,
    failedStep: latest?.failedStep ?? 'unknown',
    topDomFinding: (((hypothesisEvidence.evidence as Record<string, unknown> | undefined)?.topDomFinding) as string | undefined) ?? 'no-dom',
  });
  const status = latest?.status ?? 'none';
  const patches = await listPatches(run.id);
  const latestPatch = patches[patches.length - 1];
  const pullRequests = await listPullRequests(run.id);
  const latestPullRequest = pullRequests[pullRequests.length - 1];

  await storeBugSignatureMemory(redis, signatureHash, {
    runId: run.id,
    repo: `${run.owner}/${run.repo}`,
    flowGoal: run.flowGoal,
    lastStatus: status,
    bugType,
    redisStreamId: event.id,
    updatedAt: new Date().toISOString(),
  });

  const verified = liveVerification?.status === 'passed'
    || verificationResults.some((result) => result.status === 'passed');

  if (verified) {
    await storeSuccessfulPatchMemory(redis, signatureHash, {
      runId: run.id,
      repo: `${run.owner}/${run.repo}`,
      flowGoal: run.flowGoal,
      bugType,
      branch: latestPatch?.branchName ?? 'n/a',
      commitSha: latestPatch?.commitSha ?? 'n/a',
      patchSummary: latestPatch?.summary ?? 'Flow passed without needing a patch.',
      prUrl: latestPullRequest?.url ?? 'n/a',
      note: 'FlowPR learned this fix pattern from verified evidence.',
      redisStreamId: event.id,
      updatedAt: new Date().toISOString(),
    });

    await appendRedisTimeline(event, 'learned', 'info', `FlowPR remembered this ${bugType.replace(/_/g, ' ')} pattern for future runs.`, {
      signatureHash,
      bugType,
      branch: latestPatch?.branchName,
      prUrl: latestPullRequest?.url,
    });
  }

  const { listAgentSessions } = await import('@flowpr/tools');
  const sessions = await listAgentSessions(run.id);
  const guildSession = sessions.find((session) => session.sponsor === 'guildai' && session.status === 'running');

  if (guildSession?.providerSessionId) {
    const outcome = verified
      ? (latestPullRequest ? 'verified_pr_created' : 'investigation_only')
      : latestPullRequest && latestPullRequest.status === 'draft'
        ? 'draft_pr_created'
        : 'failed';
    const summary = await completeAgentSession({
      sessionId: guildSession.providerSessionId,
      outcome,
      prUrl: latestPullRequest?.url,
      summary: `Run ${run.id} ended with status ${status} (${outcome}).`,
      metrics: {
        toolCalls: verificationResults.length + observations.length,
        patches: patches.length,
        pullRequests: pullRequests.length,
      },
    });

    await updateAgentSessionsForRun(run.id, 'completed', {
      providerSessionId: guildSession.providerSessionId,
      outcome,
      prUrl: latestPullRequest?.url,
      gateAllowedCount: summary.gateAllowedCount,
      gateDeniedCount: summary.gateDeniedCount,
      toolCallCount: summary.toolCallCount,
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'guildai',
      artifactType: 'agent_session_trace',
      providerId: guildSession.providerSessionId,
      artifactUrl: summary.traceUrl,
      requestSummary: {
        runId: run.id,
        agentVersion: run.agentVersion,
      },
      responseSummary: {
        outcome,
        toolCallCount: summary.toolCallCount,
        gateAllowedCount: summary.gateAllowedCount,
        gateDeniedCount: summary.gateDeniedCount,
        prUrl: latestPullRequest?.url,
      },
      raw: summary as unknown as Record<string, unknown>,
    });
  }

  await recordAgentMemory({
    projectId: run.projectId,
    runId: run.id,
    scope: 'redis_runtime_learning',
    key: signatureHash,
    value: {
      latestObservationStatus: status,
      redisBugSignatureKey: redisMemoryKeys.bugSignature(signatureHash),
      redisSuccessfulPatchKey: redisMemoryKeys.successfulPatch(signatureHash),
      redisStreamId: event.id,
    },
    confidence: 1,
  });
  await appendRedisTimeline(event, 'learned', 'completed', 'Updated FlowPR’s memory with what it saw this run.', {
    signatureHash,
    status,
  });
  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'redis',
    artifactType: 'memory_write',
    providerId: event.id,
    requestSummary: {
      bugSignatureKey: redisMemoryKeys.bugSignature(signatureHash),
      successfulPatchKey: redisMemoryKeys.successfulPatch(signatureHash),
    },
    responseSummary: {
      signatureHash,
      latestObservationStatus: status,
    },
    raw: {
      latestObservation: latest,
    },
  });
  await persistRedisState(redis, event, 'learned', { signatureHash });
  await emitNextStep(redis, event, 'done', 'Redis memory learning completed.');
}

async function handleDone(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'done');
  await updateAgentSessionsForRun(run.id, 'completed', {
    redisStreamId: event.id,
    phase: 'done',
  });
  await appendRedisTimeline(event, 'done', 'completed', 'Run finished. The pull request is ready for review.');
  await recordBenchmarkEvaluation({
    runId: run.id,
    sponsor: 'redis',
    benchmarkName: 'phase3_redis_state_machine_completion',
    score: 1,
    status: 'passed',
    metrics: {
      stream: event.stream,
      streamId: event.id,
      attempt: event.attempt,
    },
    raw: {
      event,
    },
  });
  await recordRedisArtifact(event, 'state_machine_completed', { nextStatus: 'done' });
  await persistRedisState(redis, event, 'done');
}

async function handleAgentStep(redis: RedisClientType, event: FlowPrRedisEvent): Promise<void> {
  if (!isPhase(event.phase)) {
    throw new Error(`Unsupported agent phase: ${event.phase ?? 'missing'}`);
  }

  const started = await startIdempotentOperation(redis, event.dedupeKey);

  if (!started) {
    await appendRedisTimeline(event, event.phase, 'skipped', 'Duplicate agent step ignored.');
    return;
  }

  const owner = `${process.pid}:${event.id}`;
  const lockKey = redisLockKeys.run(event.runId);
  const locked = await acquireRedisLock(redis, lockKey, owner);

  if (!locked) {
    await failIdempotentOperation(redis, event.dedupeKey);
    throw new Error(`Run lock ${lockKey} is already held`);
  }

  try {
    const run = await getRun(event.runId);

    if (!run) {
      throw new Error(`Run ${event.runId} was not found in InsForge`);
    }

    switch (event.phase) {
      case 'loading_repo':
        await handleLoadingRepo(redis, run, event);
        break;
      case 'discovering_flows':
        await handleDiscoveringFlows(redis, run, event);
        break;
      case 'running_browser_qa':
        await handleRunningBrowserQa(redis, run, event);
        break;
      case 'collecting_visual_evidence':
        await handleCollectingVisualEvidence(redis, run, event);
        break;
      case 'triaging_failure':
        await handleTriagingFailure(redis, run, event);
        break;
      case 'retrieving_policy':
        await handleRetrievingPolicy(redis, run, event);
        break;
      case 'searching_memory':
        await handleSearchingMemory(redis, run, event);
        break;
      case 'patching_code':
        await handlePatchingCode(redis, run, event);
        break;
      case 'running_local_tests':
        await handleRunningLocalTests(redis, run, event);
        break;
      case 'running_live_verification':
        await handleRunningLiveVerification(redis, run, event);
        break;
      case 'creating_pr':
        await handleCreatingPr(redis, run, event);
        break;
      case 'publishing_artifacts':
        await handlePublishingArtifacts(redis, run, event);
        break;
      case 'learned':
        await handleLearned(redis, run, event);
        break;
      case 'done':
        await handleDone(redis, run, event);
        break;
      case 'queued':
      case 'failed':
        throw new Error(`Phase ${event.phase} cannot be processed as an agent step`);
      default:
        throw new Error(`Unsupported agent phase: ${event.phase}`);
    }

    await completeIdempotentOperation(redis, event.dedupeKey);
  } catch (error) {
    await failIdempotentOperation(redis, event.dedupeKey);
    throw error;
  } finally {
    await releaseRedisLock(redis, lockKey, owner);
  }
}

async function handleDomainEvent(redis: RedisClientType, event: FlowPrRedisEvent): Promise<void> {
  const started = await startIdempotentOperation(redis, event.dedupeKey);

  if (!started) {
    await appendRedisTimeline(event, 'redis_domain_event', 'skipped', 'Duplicate progress event ignored.');
    return;
  }

  try {
    const run = await getRun(event.runId);

    if (!run) {
      throw new Error(`Run ${event.runId} was not found in InsForge`);
    }

    await appendRedisTimeline(event, 'redis_domain_event', 'completed', 'Recorded a progress event.', {
      status: event.payload.status,
      provider: event.payload.provider,
    });
    await recordRedisArtifact(event, `${event.eventType.replace('.', '_')}_indexed`, {
      runStatus: run.status,
      status: event.payload.status,
      provider: event.payload.provider,
    });
    await persistRedisState(redis, event, run.status, {
      domainEventStatus: event.payload.status,
    });
    await completeIdempotentOperation(redis, event.dedupeKey);
  } catch (error) {
    await failIdempotentOperation(redis, event.dedupeKey);
    throw error;
  }
}

export async function processRedisEvent(input: {
  redis: RedisClientType;
  event: FlowPrRedisEvent;
  consumerName: string;
}): Promise<void> {
  const { redis, event } = input;

  switch (event.eventType) {
    case 'run.started':
      await handleRunStarted(redis, event);
      break;
    case 'agent.step':
      await handleAgentStep(redis, event);
      break;
    case 'browser.result':
    case 'patch.result':
    case 'verification.result':
      await handleDomainEvent(redis, event);
      break;
    default:
      throw new Error(`Unsupported Redis event type: ${event.eventType}`);
  }
}

export function describeRedisEventFailure(event: FlowPrRedisEvent, error: unknown): Record<string, unknown> {
  return {
    runId: event.runId,
    stream: event.stream,
    streamId: event.id,
    eventType: event.eventType,
    phase: event.phase,
    attempt: event.attempt,
    error: getErrorMessage(error),
  };
}
