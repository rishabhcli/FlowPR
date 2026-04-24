import type { RedisClientType } from 'redis';
import type { BrowserObservation, BrowserObservationResult, FlowPrRun, RunStatus } from '@flowpr/schemas';
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
  listRedisStreamEntries,
  listVerificationResults,
  lookupBugSignatureMemory,
  lookupSuccessfulPatchMemory,
  recordActionGate,
  recordAgentMemory,
  recordBenchmarkEvaluation,
  recordBrowserObservation,
  recordBugHypothesis,
  recordPolicyHit,
  recordProviderArtifact,
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
  type FlowPrRedisEvent,
  type TinyFishAgentFlowResult,
} from '@flowpr/tools';
import {
  runLocalFlowTest,
  runRemoteBrowserSessionEvidence,
  type LocalFlowTestResult,
} from '@flowpr/tools/playwright';

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
    title: 'Redis emitted the next agent step.',
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
    title: 'Worker verified GitHub repository metadata.',
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
  if (!process.env.SENSO_API_KEY) {
    await appendTimelineEvent({
      runId: run.id,
      actor: 'senso',
      phase: 'retrieving_policy',
      status: 'skipped',
      title: 'Senso policy lookup skipped because SENSO_API_KEY is not configured.',
      data: {
        streamId: event.id,
      },
    });
    return;
  }

  const query = [
    'FlowPR frontend QA policy for this user flow:',
    run.flowGoal,
    'Focus on primary actions, mobile checkout, accessibility, and pull request evidence.',
  ].join('\n');
  const result = await createSensoClient().search({ query, maxResults: 3 });

  await appendTimelineEvent({
    runId: run.id,
    actor: 'senso',
    phase: 'retrieving_policy',
    status: 'completed',
    title: 'Senso policy context retrieved.',
    data: {
      streamId: event.id,
      query,
      resultType: Array.isArray(result) ? 'array' : typeof result,
    },
  });

  const policyResults = Array.isArray(result) ? result : [result];

  for (const [index, policyResult] of policyResults.slice(0, 3).entries()) {
    const record: Record<string, unknown> = policyResult && typeof policyResult === 'object'
      ? (policyResult as Record<string, unknown>)
      : { value: policyResult };

    await recordPolicyHit({
      runId: run.id,
      provider: 'senso',
      query,
      title: typeof record.title === 'string' ? record.title : `Senso policy result ${index + 1}`,
      sourceUrl: typeof record.url === 'string' ? record.url : undefined,
      summary: typeof record.summary === 'string' ? record.summary : undefined,
      score: typeof record.score === 'number' ? record.score : undefined,
      raw: record,
    });
  }

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'senso',
    artifactType: 'policy_search',
    requestSummary: {
      query,
      maxResults: 3,
      streamId: event.id,
    },
    responseSummary: {
      resultType: Array.isArray(result) ? 'array' : typeof result,
    },
    raw: {
      result,
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
    title: 'TinyFish Agent API live browser QA completed.',
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
    title: 'Playwright captured deterministic browser evidence.',
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
    title: 'TinyFish Agent API live browser QA started.',
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
    await appendRedisTimeline(event, 'queue', 'skipped', 'Duplicate Redis run event skipped.');
    return;
  }

  try {
    const run = await getRun(event.runId);

    if (!run) {
      throw new Error(`Run ${event.runId} was not found in InsForge`);
    }

    await appendRedisTimeline(event, 'queue', 'completed', 'Redis run event consumed by worker.', {
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
  await appendRedisTimeline(event, 'loading_repo', 'started', 'Redis state machine entered repository loading.');
  await recordRedisArtifact(event, 'state_transition', { nextStatus: 'loading_repo' });
  await loadGitHubMetadata(run, event);
  await persistRedisState(redis, event, 'loading_repo');
  await emitNextStep(redis, event, 'discovering_flows', 'GitHub metadata is available.');
}

async function handleDiscoveringFlows(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'discovering_flows');
  await appendRedisTimeline(event, 'discovering_flows', 'completed', 'Redis indexed the requested browser flow.', {
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
  await appendRedisTimeline(event, 'running_browser_qa', 'started', 'Redis state machine dispatched TinyFish browser QA.');
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
  await appendRedisTimeline(event, 'collecting_visual_evidence', 'completed', 'Redis indexed browser evidence.', {
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

  if (failures.length === 0) {
    await appendRedisTimeline(event, 'triaging_failure', 'skipped', 'No browser failure needed triage.', {
      observationCount: observations.length,
    });
  } else if (existingHypotheses.length === 0) {
    for (const failure of failures) {
      await recordBugHypothesis({
        runId: run.id,
        summary: 'Browser evidence shows the requested flow did not complete.',
        affectedFlow: run.flowGoal,
        suspectedCause: failure.observedBehavior,
        confidence: failure.status === 'failed' ? 'high' : 'medium',
        severity: failure.severity,
        acceptanceCriteria: [
          {
            text: run.flowGoal,
            source: 'dashboard_input',
          },
        ],
        evidence: {
          observationId: failure.id,
          providerRunId: failure.providerRunId,
          redisStreamId: event.id,
        },
      });
    }
    await appendRedisTimeline(event, 'triaging_failure', 'completed', 'Failure evidence was converted into bug hypotheses.', {
      failureCount: failures.length,
    });
  } else {
    await appendRedisTimeline(event, 'triaging_failure', 'completed', 'Existing bug hypotheses were reused for triage.', {
      failureCount: failures.length,
      hypothesisCount: existingHypotheses.length,
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
  await appendRedisTimeline(event, 'retrieving_policy', 'started', 'Redis state machine requested Senso policy grounding.');
  await recordRedisArtifact(event, 'state_transition', { nextStatus: 'retrieving_policy' });
  await querySensoPolicy(run, event);
  await persistRedisState(redis, event, 'retrieving_policy');
  await emitNextStep(redis, event, 'searching_memory', 'Policy context has been retrieved or intentionally skipped.');
}

async function handleSearchingMemory(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'searching_memory');
  const observations = await listBrowserObservations(run.id);
  const latest = latestObservation(observations);
  const signatureHash = createBugSignatureHash({
    repo: `${run.owner}/${run.repo}`,
    flowGoal: run.flowGoal,
    observedBehavior: latest?.observedBehavior,
    status: latest?.status,
  });
  const bugMemory = await lookupBugSignatureMemory(redis, signatureHash);
  const patchMemory = await lookupSuccessfulPatchMemory(redis, signatureHash);

  await appendRedisTimeline(event, 'searching_memory', 'completed', 'Redis memory lookup completed.', {
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

async function handlePatchingCode(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'patching_code');
  const owner = `${process.pid}:${event.id}`;
  const lockKey = redisLockKeys.patch(run.id);
  const locked = await acquireRedisLock(redis, lockKey, owner);

  if (!locked) {
    throw new Error(`Patch lock ${lockKey} is already held`);
  }

  try {
    await appendRedisTimeline(event, 'patching_code', 'completed', 'Redis patch lock was acquired and released.', {
      lockKey,
    });
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
    const patchStreamId = await emitPatchResult(redis, {
      runId: run.id,
      status: 'lock_verified',
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
      },
      raw: {
        sourceStreamId: event.id,
      },
    });
    await persistRedisState(redis, event, 'patching_code', { patchStreamId });
  } finally {
    await releaseRedisLock(redis, lockKey, owner);
  }

  await emitNextStep(redis, event, 'running_local_tests', 'Patch mutation lock path is verified.');
}

async function handleRunningLocalTests(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'running_local_tests');
  await appendRedisTimeline(event, 'running_local_tests', 'completed', 'Redis recorded local test command readiness.', {
    command: 'pnpm typecheck',
  });
  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'redis',
    artifactType: 'local_test_gate',
    providerId: event.id,
    requestSummary: {
      command: 'pnpm typecheck',
      streamId: event.id,
    },
    responseSummary: {
      mode: 'phase3_runtime_gate',
      runnable: true,
    },
    raw: {
      runStatus: 'running_local_tests',
    },
  });
  await persistRedisState(redis, event, 'running_local_tests');
  await emitNextStep(redis, event, 'running_live_verification', 'Local test gate was recorded.');
}

async function handleRunningLiveVerification(
  redis: RedisClientType,
  run: FlowPrRun,
  event: FlowPrRedisEvent,
): Promise<void> {
  await updateRunStatus(run.id, 'running_live_verification');
  const verificationResults = await listVerificationResults(run.id);
  const hasBrowserFailure = verificationResults.some((result) => ['tinyfish', 'playwright'].includes(result.provider)
    && ['failed', 'errored'].includes(result.status));
  const hasPassingLiveVerification = verificationResults.some((result) => ['tinyfish', 'playwright'].includes(result.provider)
    && result.status === 'passed');
  const status = hasBrowserFailure ? 'failed' : hasPassingLiveVerification ? 'passed' : 'skipped';
  const summary = hasBrowserFailure
    ? 'Redis verified that live browser evidence contains a failing result.'
    : hasPassingLiveVerification
      ? 'Redis verified that live browser evidence has a passing result.'
      : 'Redis verified the runtime path; no live browser result is available yet.';

  await recordVerificationResult({
    runId: run.id,
    provider: 'redis',
    status,
    summary,
    testCommand: 'redis-stream-state-machine',
    artifacts: [
      {
        sponsor: 'redis',
        stream: event.stream,
        streamId: event.id,
      },
    ],
    raw: {
      verificationResults,
    },
  });
  const verificationStreamId = await emitVerificationResult(redis, {
    runId: run.id,
    provider: 'redis',
    status,
  });
  await appendRedisTimeline(event, 'running_live_verification', 'completed', 'Redis live verification event published.', {
    verificationStreamId,
    status,
  });
  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'redis',
    artifactType: 'verification_event',
    providerId: verificationStreamId,
    requestSummary: {
      stream: flowPrStreams.verification,
      eventType: 'verification.result',
    },
    responseSummary: {
      status,
      verificationStreamId,
    },
    raw: {
      sourceStreamId: event.id,
    },
  });
  await persistRedisState(redis, event, 'running_live_verification', { verificationStreamId });
  await emitNextStep(redis, event, 'creating_pr', 'Live verification event was published.');
}

async function handleCreatingPr(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'creating_pr');
  const owner = `${process.pid}:${event.id}`;
  const lockKey = redisLockKeys.pr(run.id);
  const locked = await acquireRedisLock(redis, lockKey, owner);

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
    await appendRedisTimeline(event, 'creating_pr', 'completed', 'Redis PR creation lock was acquired and released.', {
      lockKey,
      baseBranch: run.baseBranch,
    });
    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'redis',
      artifactType: 'pr_lock_verified',
      providerId: event.id,
      requestSummary: {
        lockKey,
        baseBranch: run.baseBranch,
      },
      responseSummary: {
        lockAcquired: true,
        prMutationAllowed: true,
      },
      raw: {
        runId: run.id,
        streamId: event.id,
      },
    });
    await persistRedisState(redis, event, 'creating_pr');
  } finally {
    await releaseRedisLock(redis, lockKey, owner);
  }

  await emitNextStep(redis, event, 'publishing_artifacts', 'PR mutation lock path is verified.');
}

async function handlePublishingArtifacts(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'publishing_artifacts');
  const stats = await getRedisStreamStats(redis);
  const recentRunEvents = await listRedisStreamEntries(redis, flowPrStreams.runs, 5);
  const recentAgentSteps = await listRedisStreamEntries(redis, flowPrStreams.agentSteps, 5);

  await appendRedisTimeline(event, 'publishing_artifacts', 'completed', 'Redis stream snapshot published to InsForge.', {
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
  await persistRedisState(redis, event, 'publishing_artifacts');
  await emitNextStep(redis, event, 'learned', 'Redis stream snapshot has been published.');
}

async function handleLearned(redis: RedisClientType, run: FlowPrRun, event: FlowPrRedisEvent): Promise<void> {
  await updateRunStatus(run.id, 'learned');
  const observations = await listBrowserObservations(run.id);
  const latest = latestObservation(observations);
  const signatureHash = createBugSignatureHash({
    repo: `${run.owner}/${run.repo}`,
    flowGoal: run.flowGoal,
    observedBehavior: latest?.observedBehavior,
    status: latest?.status,
  });
  const status = latest?.status ?? 'none';

  await storeBugSignatureMemory(redis, signatureHash, {
    runId: run.id,
    repo: `${run.owner}/${run.repo}`,
    flowGoal: run.flowGoal,
    lastStatus: status,
    redisStreamId: event.id,
    updatedAt: new Date().toISOString(),
  });

  if (status === 'passed') {
    await storeSuccessfulPatchMemory(redis, signatureHash, {
      runId: run.id,
      repo: `${run.owner}/${run.repo}`,
      flowGoal: run.flowGoal,
      note: 'Flow passed without needing a patch in Phase 3 runtime.',
      redisStreamId: event.id,
      updatedAt: new Date().toISOString(),
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
  await appendRedisTimeline(event, 'learned', 'completed', 'Redis memory was updated from this run.', {
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
  await appendRedisTimeline(event, 'done', 'completed', 'Redis state machine completed the run.');
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
    await appendRedisTimeline(event, event.phase, 'skipped', 'Duplicate Redis agent step skipped.');
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
    await appendRedisTimeline(event, 'redis_domain_event', 'skipped', 'Duplicate Redis domain event skipped.');
    return;
  }

  try {
    const run = await getRun(event.runId);

    if (!run) {
      throw new Error(`Run ${event.runId} was not found in InsForge`);
    }

    await appendRedisTimeline(event, 'redis_domain_event', 'completed', 'Redis domain event indexed.', {
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
