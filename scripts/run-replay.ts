import type {
  BrowserObservation,
  FlowPrRun,
  ProviderArtifact,
  RunDetail,
  TimelineEvent,
} from '@flowpr/schemas';
import {
  hasPullRequestArtifact,
  isBlockedPullRequestAttempt,
  normalizeRunOutcomeCopy,
  validateRunEvidenceIntegrity,
} from '@flowpr/schemas';
import { loadLocalEnv } from '@flowpr/tools/env';
import { getRunDetail, listRecentRuns } from '@flowpr/tools/insforge';
import { summarizeRunReadiness } from '@flowpr/tools/readiness';
import { isRecoverableActiveRunStatus } from '@flowpr/tools/recovery';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  getProgressHistory,
  listDeadLetterEntries,
  listWorkerHeartbeats,
  readLiveStreams,
} from '@flowpr/tools/redis';

interface CliOptions {
  runId?: string;
  json: boolean;
  failOnNotReady: boolean;
  progressCount: number;
  deadLetterCount: number;
}

interface RedisReplayState {
  reachable: boolean;
  error?: string;
  liveStreams: Array<{
    provider: string;
    providerRunId?: string;
    streamingUrl: string;
    createdAt: string;
  }>;
  progressEvents: Array<{ id: string; fields: Record<string, string> }>;
  workerHeartbeats: Array<{
    workerId: string;
    lastBeat: string;
    pid?: string;
    processed?: number;
    currentRunId?: string;
    currentPhase?: string;
  }>;
  deadLetters: Array<{ id: string; fields: Record<string, string> }>;
}

function parseNumberFlag(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    json: false,
    failOnNotReady: false,
    progressCount: 20,
    deadLetterCount: 50,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--fail-on-not-ready') {
      options.failOnNotReady = true;
    } else if (arg.startsWith('--progress-count=')) {
      options.progressCount = parseNumberFlag(arg.split('=')[1], options.progressCount);
    } else if (arg.startsWith('--dead-letter-count=')) {
      options.deadLetterCount = parseNumberFlag(arg.split('=')[1], options.deadLetterCount);
    } else if (!arg.startsWith('-') && !options.runId) {
      options.runId = arg;
    }
  }

  return options;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function shortId(value: string | undefined): string {
  if (!value) return 'n/a';
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finalUrl(observation: BrowserObservation): string | undefined {
  return asString(observation.result?.finalUrl);
}

function artifactTarget(artifact: ProviderArtifact): string {
  return artifact.artifactUrl ?? artifact.storageKey ?? artifact.providerId ?? 'no-target';
}

function latestInvestigationReport(detail: RunDetail): ProviderArtifact | undefined {
  return [...detail.providerArtifacts].reverse().find((artifact) => artifact.artifactType === 'investigation_report');
}

function timelineLine(event: TimelineEvent): string {
  return `${event.sequence.toString().padStart(2, '0')} ${event.createdAt} ${event.actor}/${event.phase} ${event.status} - ${normalizeRunOutcomeCopy(event.title)}`;
}

async function pickRunId(input: string | undefined): Promise<string> {
  if (input) return input;

  const [latest] = await listRecentRuns(1);
  if (!latest) {
    throw new Error('No FlowPR runs found. Start one with pnpm demo:start-run or POST /api/runs/start.');
  }

  return latest.id;
}

async function getRedisReplay(
  runId: string,
  options: Pick<CliOptions, 'progressCount' | 'deadLetterCount'>,
): Promise<RedisReplayState> {
  const redis = createFlowPrRedisClient();

  try {
    await connectFlowPrRedisClient(redis);
    const [liveStreams, progressEvents, workerHeartbeats, deadLetters] = await Promise.all([
      readLiveStreams(redis, runId),
      getProgressHistory(redis, runId, options.progressCount),
      listWorkerHeartbeats(redis),
      listDeadLetterEntries(redis, options.deadLetterCount),
    ]);

    return {
      reachable: true,
      liveStreams,
      progressEvents,
      workerHeartbeats,
      deadLetters: deadLetters.filter((entry) => entry.fields.runId === runId),
    };
  } catch (error) {
    return {
      reachable: false,
      error: getErrorMessage(error),
      liveStreams: [],
      progressEvents: [],
      workerHeartbeats: [],
      deadLetters: [],
    };
  } finally {
    if (redis.isOpen) {
      await redis.quit();
    }
  }
}

function summarizeRun(run: FlowPrRun) {
  return {
    id: run.id,
    status: run.status,
    repo: `${run.owner}/${run.repo}`,
    baseBranch: run.baseBranch,
    workingBranch: run.workingBranch,
    previewUrl: run.previewUrl,
    flowGoal: run.flowGoal,
    riskLevel: run.riskLevel,
    permissionProfile: run.permissionProfile,
    agent: `${run.agentName}@${run.agentVersion}`,
    guildTraceId: run.guildTraceId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    failureSummary: run.failureSummary,
    updatedAt: run.updatedAt,
  };
}

function summarizeDetail(detail: RunDetail, redis: RedisReplayState) {
  const openedPullRequests = detail.pullRequests.filter(hasPullRequestArtifact);
  const blockedPullRequestAttempts = detail.pullRequests.filter(isBlockedPullRequestAttempt);
  const evidenceIntegrity = validateRunEvidenceIntegrity(detail);
  const readiness = summarizeRunReadiness(detail);

  return {
    run: summarizeRun(detail.run),
    counts: {
      timelineEvents: detail.timelineEvents.length,
      providerArtifacts: detail.providerArtifacts.length,
      browserObservations: detail.browserObservations.length,
      bugHypotheses: detail.bugHypotheses.length,
      patches: detail.patches.length,
      verificationResults: detail.verificationResults.length,
      pullRequests: detail.pullRequests.length,
      openedPullRequests: openedPullRequests.length,
      blockedPullRequestAttempts: blockedPullRequestAttempts.length,
      policyHits: detail.policyHits.length,
      agentSessions: detail.agentSessions.length,
      actionGates: detail.actionGates.length,
      benchmarkEvaluations: detail.benchmarkEvaluations.length,
    },
    timeline: detail.timelineEvents.map((event) => ({
      sequence: event.sequence,
      actor: event.actor,
      phase: event.phase,
      status: event.status,
      title: normalizeRunOutcomeCopy(event.title),
      createdAt: event.createdAt,
    })),
    browserObservations: detail.browserObservations.map((observation) => ({
      id: observation.id,
      provider: observation.provider,
      providerRunId: observation.providerRunId,
      status: observation.status,
      failedStep: observation.failedStep,
      finalUrl: finalUrl(observation),
      screenshot: observation.screenshotUrl ?? observation.screenshotKey,
      trace: observation.traceUrl ?? observation.traceKey,
      consoleErrors: observation.consoleErrors.length,
      networkErrors: observation.networkErrors.length,
      createdAt: observation.createdAt,
    })),
    providerArtifacts: detail.providerArtifacts.map((artifact) => ({
      id: artifact.id,
      sponsor: artifact.sponsor,
      type: artifact.artifactType,
      providerId: artifact.providerId,
      target: artifactTarget(artifact),
      createdAt: artifact.createdAt,
    })),
    hypotheses: detail.bugHypotheses.map((hypothesis) => ({
      id: hypothesis.id,
      severity: hypothesis.severity,
      confidence: hypothesis.confidence,
      summary: hypothesis.summary,
      suspectedCause: hypothesis.suspectedCause,
      createdAt: hypothesis.createdAt,
    })),
    patches: detail.patches.map((patch) => ({
      id: patch.id,
      status: patch.status,
      branchName: patch.branchName,
      commitSha: patch.commitSha,
      summary: patch.summary,
      filesChanged: patch.filesChanged.length,
      updatedAt: patch.updatedAt,
    })),
    verification: detail.verificationResults.map((result) => ({
      id: result.id,
      provider: result.provider,
      status: result.status,
      summary: result.summary,
      testCommand: result.testCommand,
      createdAt: result.createdAt,
    })),
    pullRequests: detail.pullRequests.map((pullRequest) => ({
      id: pullRequest.id,
      provider: pullRequest.provider,
      status: pullRequest.status,
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      updatedAt: pullRequest.updatedAt,
    })),
    policyHits: detail.policyHits.map((hit) => ({
      id: hit.id,
      provider: hit.provider,
      title: hit.title,
      sourceUrl: hit.sourceUrl,
      score: hit.score,
      createdAt: hit.createdAt,
    })),
    actionGates: detail.actionGates.map((gate) => ({
      id: gate.id,
      gateType: gate.gateType,
      status: gate.status,
      riskLevel: gate.riskLevel,
      reason: gate.reason,
      createdAt: gate.createdAt,
      resolvedAt: gate.resolvedAt,
    })),
    redis: {
      reachable: redis.reachable,
      error: redis.error,
      liveStreams: redis.liveStreams,
      progressEvents: redis.progressEvents.map((event) => ({
        ...event,
        fields: {
          ...event.fields,
          message: normalizeRunOutcomeCopy(event.fields.message ?? ''),
        },
      })),
      workerHeartbeats: redis.workerHeartbeats,
      deadLetters: redis.deadLetters,
    },
    readiness,
    evidenceIntegrity,
  };
}

function printSection(title: string): void {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printRunHeader(run: FlowPrRun): void {
  console.log(`FlowPR run replay: ${run.id}`);
  console.log(`Status: ${run.status}`);
  console.log(`Repo: ${run.owner}/${run.repo} (${run.baseBranch})`);
  console.log(`Preview: ${run.previewUrl}`);
  console.log(`Goal: ${run.flowGoal}`);
  console.log(`Risk/profile: ${run.riskLevel} / ${run.permissionProfile}`);
  console.log(`Agent: ${run.agentName}@${run.agentVersion}`);
  if (run.guildTraceId) console.log(`Guild trace: ${run.guildTraceId}`);
  if (run.failureSummary) console.log(`Failure: ${run.failureSummary}`);
}

function printCounts(detail: RunDetail, redis: RedisReplayState): void {
  const openedPullRequests = detail.pullRequests.filter(hasPullRequestArtifact);
  const blockedPullRequestAttempts = detail.pullRequests.filter(isBlockedPullRequestAttempt);
  const otherPullRequestRecords = detail.pullRequests.length - openedPullRequests.length - blockedPullRequestAttempts.length;

  printSection('Coverage');
  console.log(`Timeline events: ${detail.timelineEvents.length}`);
  console.log(`Provider artifacts: ${detail.providerArtifacts.length}`);
  console.log(`Browser observations: ${detail.browserObservations.length}`);
  console.log(`Hypotheses: ${detail.bugHypotheses.length}`);
  console.log(`Patches: ${detail.patches.length}`);
  console.log(`Verification results: ${detail.verificationResults.length}`);
  console.log(`Opened pull requests: ${openedPullRequests.length}`);
  console.log(`Blocked PR attempts: ${blockedPullRequestAttempts.length}`);
  if (otherPullRequestRecords > 0) {
    console.log(`Other PR records: ${otherPullRequestRecords}`);
  }
  console.log(`Policy hits: ${detail.policyHits.length}`);
  console.log(`Action gates: ${detail.actionGates.length}`);
  console.log(`Redis progress events: ${redis.progressEvents.length}`);
  console.log(`Redis live streams: ${redis.liveStreams.length}`);
  console.log(`Run dead letters: ${redis.deadLetters.length}`);
}

function printReadiness(detail: RunDetail): void {
  const readiness = summarizeRunReadiness(detail);
  const total = readiness.items.length;
  const attentionItems = readiness.items.filter((item) => item.state !== 'ready' || item.note);

  printSection('Run Readiness');
  console.log(`Overall: ${readiness.overall}`);
  console.log(`Ready: ${readiness.readyCount}/${total}`);
  console.log(`Partial: ${readiness.partialCount}`);
  console.log(`Missing: ${readiness.missingCount}`);

  if (readiness.evidenceIntegrity.issueCount === 0) {
    console.log('Evidence integrity: clean');
  } else {
    console.log(
      `Evidence integrity: ${readiness.evidenceIntegrity.dangerCount} critical, ${readiness.evidenceIntegrity.warningCount} warning`,
    );
  }

  if (!attentionItems.length) {
    console.log('No missing, partial, or contextual readiness notes.');
    return;
  }

  for (const item of attentionItems) {
    const note = item.note ? ` (${item.note})` : '';
    console.log(`${item.state.toUpperCase()} ${item.sponsor}/${item.artifactType}: ${item.description}${note}`);
  }
}

function printTimeline(events: TimelineEvent[]): void {
  printSection('Timeline');
  if (!events.length) {
    console.log('No timeline events recorded.');
    return;
  }

  for (const event of events) {
    console.log(timelineLine(event));
  }
}

function printEvidence(detail: RunDetail): void {
  printSection('Evidence');
  if (!detail.browserObservations.length && !detail.providerArtifacts.length) {
    console.log('No browser observations or provider artifacts recorded.');
    return;
  }

  for (const observation of detail.browserObservations) {
    const target = finalUrl(observation) ?? observation.screenshotUrl ?? observation.screenshotKey ?? 'no-artifact';
    console.log(
      `${observation.provider} ${observation.status} ${shortId(observation.providerRunId)} - ${observation.failedStep ?? 'flow completed'} -> ${target}`,
    );
  }

  for (const artifact of detail.providerArtifacts) {
    console.log(`${artifact.sponsor}/${artifact.artifactType} ${shortId(artifact.providerId)} -> ${artifactTarget(artifact)}`);
  }
}

function printEvidenceIntegrity(detail: RunDetail): void {
  const issues = validateRunEvidenceIntegrity(detail);

  printSection('Evidence Integrity');
  if (issues.length === 0) {
    console.log('All browser observations, verification rows, and PR records have matching durable provider artifacts.');
    return;
  }

  const danger = issues.filter((issue) => issue.severity === 'danger').length;
  const warning = issues.length - danger;
  console.log(`${danger} blocking issue${danger === 1 ? '' : 's'}, ${warning} warning${warning === 1 ? '' : 's'}.`);

  for (const issue of issues) {
    console.log(
      `${issue.severity.toUpperCase()} ${issue.kind} ${shortId(issue.recordId)} ${issue.provider}: ${issue.message} Expected ${issue.expectedArtifact}.`,
    );
  }
}

function printDecisionTrail(detail: RunDetail): void {
  printSection('Decision Trail');
  if (!detail.bugHypotheses.length && !detail.patches.length && !detail.verificationResults.length && !detail.pullRequests.length) {
    console.log('No hypotheses, patches, verification results, or pull requests recorded.');
    return;
  }

  for (const hypothesis of detail.bugHypotheses) {
    console.log(`Hypothesis ${shortId(hypothesis.id)} ${hypothesis.severity}/${hypothesis.confidence}: ${hypothesis.summary}`);
  }

  for (const patch of detail.patches) {
    console.log(`Patch ${shortId(patch.id)} ${patch.status}: ${patch.summary}`);
  }

  for (const result of detail.verificationResults) {
    const command = result.testCommand ? ` (${result.testCommand})` : '';
    console.log(`Verification ${result.provider} ${result.status}: ${result.summary}${command}`);
  }

  const report = latestInvestigationReport(detail);
  if (report) {
    const requestSummary = (report.requestSummary ?? {}) as { reason?: unknown };
    const responseSummary = (report.responseSummary ?? {}) as { summary?: unknown };
    const summary = typeof requestSummary.reason === 'string'
      ? requestSummary.reason
      : typeof responseSummary.summary === 'string'
        ? responseSummary.summary
        : 'Investigation report ready for human review.';
    console.log(`Handoff report ready: ${summary} (${artifactTarget(report)})`);
  }

  for (const pullRequest of detail.pullRequests) {
    if (isBlockedPullRequestAttempt(pullRequest)) {
      const gate = (pullRequest.raw?.gate ?? {}) as { reason?: unknown };
      const reason = typeof gate.reason === 'string' ? ` — ${gate.reason}` : '';
      console.log(`PR gate held: ${pullRequest.title}${reason}`);
      continue;
    }

    console.log(`PR ${pullRequest.status} #${pullRequest.number ?? 'n/a'}: ${pullRequest.title} ${pullRequest.url ?? ''}`.trim());
  }
}

function printPolicyAndGates(detail: RunDetail): void {
  printSection('Policy And Gates');
  if (!detail.policyHits.length && !detail.actionGates.length && !detail.benchmarkEvaluations.length) {
    console.log('No policy hits, action gates, or benchmark evaluations recorded.');
    return;
  }

  for (const hit of detail.policyHits) {
    console.log(`Policy ${hit.provider} ${hit.score ?? 'n/a'}: ${hit.title ?? hit.query}`);
  }

  for (const gate of detail.actionGates) {
    console.log(`Gate ${gate.gateType} ${gate.status}: ${gate.reason}`);
  }

  for (const evaluation of detail.benchmarkEvaluations) {
    console.log(`Benchmark ${evaluation.benchmarkName} ${evaluation.status}: ${evaluation.score ?? 'n/a'}`);
  }
}

function printRedis(redis: RedisReplayState, run: FlowPrRun): void {
  printSection('Redis Runtime');
  if (!redis.reachable) {
    console.log(`Redis unavailable: ${redis.error ?? 'unknown error'}`);
    return;
  }

  if (redis.workerHeartbeats.length) {
    for (const worker of redis.workerHeartbeats) {
      const runLabel = worker.currentRunId === run.id && !isRecoverableActiveRunStatus(run.status)
        ? ' lastRun'
        : ' run';
      const active = worker.currentRunId
        ? `${runLabel}=${shortId(worker.currentRunId)} phase=${worker.currentPhase ?? 'unknown'}`
        : '';
      console.log(`Worker ${worker.workerId} beat=${worker.lastBeat} processed=${worker.processed ?? 0}${active}`);
    }
  } else {
    console.log('No worker heartbeats currently visible.');
  }

  if (redis.liveStreams.length) {
    for (const stream of redis.liveStreams) {
      console.log(`Live ${stream.provider} ${shortId(stream.providerRunId)} -> ${stream.streamingUrl}`);
    }
  }

  if (redis.progressEvents.length) {
    console.log('Recent progress:');
    for (const event of redis.progressEvents) {
      console.log(`  ${event.id} ${event.fields.phase ?? event.fields.kind ?? 'progress'} - ${normalizeRunOutcomeCopy(event.fields.message ?? '')}`);
    }
  }

  if (redis.deadLetters.length) {
    console.log('Dead letters for this run:');
    for (const entry of redis.deadLetters) {
      console.log(`  ${entry.id} ${entry.fields.eventType ?? 'event'} - ${entry.fields.error ?? entry.fields.retryReason ?? 'no reason'}`);
    }
  }
}

function printPointers(runId: string): void {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  printSection('Pointers');
  console.log(`Dashboard: ${appUrl}/runs/${runId}`);
  console.log(`API: ${appUrl}/api/runs/${runId}`);
}

function applyReadinessGate(detail: RunDetail): void {
  const readiness = summarizeRunReadiness(detail);

  if (readiness.overall === 'ready') {
    return;
  }

  const missing = readiness.items
    .filter((item) => item.state === 'missing')
    .map((item) => `${item.sponsor}/${item.artifactType}`);
  const partial = readiness.items
    .filter((item) => item.state === 'partial')
    .map((item) => `${item.sponsor}/${item.artifactType}`);

  console.error(
    `Run readiness gate failed: overall=${readiness.overall}; missing=${missing.join(', ') || 'none'}; partial=${partial.join(', ') || 'none'}`,
  );
  process.exitCode = 1;
}

async function main() {
  loadLocalEnv();

  const options = parseArgs(process.argv.slice(2));
  const runId = await pickRunId(options.runId);
  const detail = await getRunDetail(runId);

  if (!detail) {
    throw new Error(`Run not found: ${runId}`);
  }

  const redis = await getRedisReplay(runId, options);
  const summary = summarizeDetail(detail, redis);

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
    if (options.failOnNotReady) {
      applyReadinessGate(detail);
    }
    return;
  }

  printRunHeader(detail.run);
  printCounts(detail, redis);
  printReadiness(detail);
  printTimeline(detail.timelineEvents);
  printEvidence(detail);
  printEvidenceIntegrity(detail);
  printDecisionTrail(detail);
  printPolicyAndGates(detail);
  printRedis(redis, detail.run);
  printPointers(detail.run.id);

  if (options.failOnNotReady) {
    applyReadinessGate(detail);
  }
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
