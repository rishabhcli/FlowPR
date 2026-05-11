import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  artifactStorageBucket,
  parseGitHubRepoUrl,
  type ActionGate,
  type ActionGateStatus,
  type AgentMemory,
  type AgentSession,
  type AgentSessionStatus,
  type BenchmarkEvaluation,
  type BenchmarkEvaluationStatus,
  type BrowserObservation,
  type BugHypothesis,
  type FlowPrRun,
  type PatchRecord,
  type PullRequestRecord,
  type PullRequestStatus,
  type ProviderArtifact,
  type ProviderArtifactInput,
  type RiskLevel,
  type RunDetail,
  type RunStartInput,
  type RunStatus,
  type TimelineEvent,
  type TimelineEventStatus,
  type VerificationResult,
} from '@flowpr/schemas';
import type {
  ActionGateInput,
  AgentMemoryInput,
  AgentSessionInput,
  BenchmarkEvaluationInput,
  BrowserObservationInput,
  BugHypothesisInput,
  PatchInput,
  PolicyHitInput,
  PullRequestInput,
  RunArtifactUploadInput,
  RunArtifactUploadResult,
  TimelineEventInput,
  VerificationResultInput,
} from './insforge';
import type { PullRequestUpdateInput } from './insforge';

interface LocalProject {
  id: string;
  repoUrl: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  productionUrl?: string;
  createdAt: string;
  updatedAt: string;
}

interface LocalStoreData {
  version: 1;
  projects: LocalProject[];
  runs: FlowPrRun[];
  timelineEvents: TimelineEvent[];
  providerArtifacts: ProviderArtifact[];
  browserObservations: BrowserObservation[];
  bugHypotheses: BugHypothesis[];
  patches: PatchRecord[];
  verificationResults: VerificationResult[];
  pullRequests: PullRequestRecord[];
  policyHits: Array<NonNullable<RunDetail['policyHits'][number]>>;
  agentMemories: AgentMemory[];
  agentSessions: AgentSession[];
  actionGates: ActionGate[];
  benchmarkEvaluations: BenchmarkEvaluation[];
}

export interface LocalRunArtifactDownloadResult {
  bytes: Uint8Array;
  contentType: string;
  cacheControl?: string;
}

function repoRoot(startDir = process.cwd()): string {
  let dir = startDir;

  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return startDir;
    dir = parent;
  }
}

function workspaceDir(): string {
  return join(repoRoot(), '.flowpr-workspaces');
}

function storePath(): string {
  return join(workspaceDir(), 'local-store.json');
}

function lockPath(): string {
  return join(workspaceDir(), 'local-store.lock');
}

function artifactsDir(): string {
  return join(workspaceDir(), 'artifacts');
}

function emptyStore(): LocalStoreData {
  return {
    version: 1,
    projects: [],
    runs: [],
    timelineEvents: [],
    providerArtifacts: [],
    browserObservations: [],
    bugHypotheses: [],
    patches: [],
    verificationResults: [],
    pullRequests: [],
    policyHits: [],
    agentMemories: [],
    agentSessions: [],
    actionGates: [],
    benchmarkEvaluations: [],
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(): Promise<FileHandle> {
  await mkdir(workspaceDir(), { recursive: true });

  for (let attempt = 0; attempt < 160; attempt += 1) {
    try {
      return await open(lockPath(), 'wx');
    } catch (error) {
      const code = typeof error === 'object' && error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code !== 'EEXIST') throw error;
      if (attempt === 120) await rm(lockPath(), { force: true }).catch(() => undefined);
      await delay(25);
    }
  }

  throw new Error('Timed out waiting for FlowPR local store lock');
}

async function readStoreUnlocked(): Promise<LocalStoreData> {
  try {
    const raw = await readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocalStoreData>;
    return { ...emptyStore(), ...parsed, version: 1 };
  } catch (error) {
    const code = typeof error === 'object' && error ? (error as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT') return emptyStore();
    throw error;
  }
}

async function writeStoreUnlocked(store: LocalStoreData): Promise<void> {
  await mkdir(workspaceDir(), { recursive: true });
  const tmp = `${storePath()}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`);
  await rename(tmp, storePath());
}

async function withStore<T>(mutate: (store: LocalStoreData) => T | Promise<T>): Promise<T> {
  const lock = await acquireLock();
  try {
    const store = await readStoreUnlocked();
    const result = await mutate(store);
    await writeStoreUnlocked(store);
    return result;
  } finally {
    await lock.close().catch(() => undefined);
    await rm(lockPath(), { force: true }).catch(() => undefined);
  }
}

async function readOnly<T>(read: (store: LocalStoreData) => T): Promise<T> {
  const lock = await acquireLock();
  try {
    return read(await readStoreUnlocked());
  } finally {
    await lock.close().catch(() => undefined);
    await rm(lockPath(), { force: true }).catch(() => undefined);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function byCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

function descendingCreatedAt<T extends { createdAt: string }>(a: T, b: T): number {
  return -byCreatedAt(a, b);
}

function projectForRun(store: LocalStoreData, input: RunStartInput): LocalProject {
  const repo = parseGitHubRepoUrl(input.repoUrl);
  const now = nowIso();
  const existing = store.projects.find((project) => project.owner === repo.owner && project.repo === repo.repo);

  if (existing) {
    existing.repoUrl = input.repoUrl;
    existing.defaultBranch = input.baseBranch;
    existing.productionUrl = input.previewUrl;
    existing.updatedAt = now;
    return existing;
  }

  const project: LocalProject = {
    id: randomUUID(),
    repoUrl: input.repoUrl,
    owner: repo.owner,
    repo: repo.repo,
    defaultBranch: input.baseBranch,
    productionUrl: input.previewUrl,
    createdAt: now,
    updatedAt: now,
  };
  store.projects.push(project);
  return project;
}

export async function localCreateRun(input: RunStartInput, fallbackReason?: string): Promise<FlowPrRun> {
  return withStore((store) => {
    const repo = parseGitHubRepoUrl(input.repoUrl);
    const now = nowIso();
    const project = projectForRun(store, input);
    const run: FlowPrRun = {
      id: randomUUID(),
      projectId: project.id,
      repoUrl: input.repoUrl,
      owner: repo.owner,
      repo: repo.repo,
      baseBranch: input.baseBranch,
      previewUrl: input.previewUrl,
      flowGoal: input.flowGoal,
      status: 'queued',
      riskLevel: input.riskLevel,
      permissionProfile: input.permissionProfile,
      agentName: process.env.FLOWPR_AGENT_NAME ?? 'flowpr-autonomous-frontend-qa',
      agentVersion: process.env.FLOWPR_AGENT_VERSION ?? '0.1.0',
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    store.runs.push(run);

    const session: AgentSession = {
      id: randomUUID(),
      runId: run.id,
      sponsor: 'guildai',
      status: 'created',
      goal: run.flowGoal,
      metadata: {
        agentName: run.agentName,
        agentVersion: run.agentVersion,
        projectId: run.projectId,
        mode: 'local_fallback_store',
      },
      startedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    store.agentSessions.push(session);

    store.actionGates.push({
      id: randomUUID(),
      runId: run.id,
      sessionId: session.id,
      gateType: 'autonomous_browser_qa',
      riskLevel: run.riskLevel,
      status: 'allowed',
      reason: 'Local fallback mode permits browser QA and evidence collection for this run.',
      requestedBy: 'dashboard',
      resolvedBy: 'system',
      metadata: {
        repoUrl: run.repoUrl,
        previewUrl: run.previewUrl,
      },
      createdAt: now,
      resolvedAt: now,
    });

    store.agentMemories.push({
      id: randomUUID(),
      projectId: run.projectId,
      runId: run.id,
      scope: 'project',
      key: 'latest_flow_goal',
      value: {
        flowGoal: run.flowGoal,
        previewUrl: run.previewUrl,
        riskLevel: run.riskLevel,
      },
      confidence: 1,
      createdAt: now,
      updatedAt: now,
    });

    store.providerArtifacts.push({
      id: randomUUID(),
      runId: run.id,
      sponsor: 'insforge',
      artifactType: 'local_fallback_store',
      providerId: run.id,
      requestSummary: {
        mode: 'local_fallback_store',
        table: 'qa_runs',
      },
      responseSummary: {
        status: run.status,
        reason: fallbackReason ?? 'InsForge unavailable; run persisted locally.',
      },
      raw: {
        fallbackReason,
      },
      createdAt: now,
    });

    return run;
  });
}

export async function localGetRun(runId: string): Promise<FlowPrRun | null> {
  return readOnly((store) => store.runs.find((run) => run.id === runId) ?? null);
}

export async function localListRecentRuns(limit = 12): Promise<FlowPrRun[]> {
  return readOnly((store) => [...store.runs].sort(descendingCreatedAt).slice(0, limit));
}

export async function localUpdateRunStatus(
  runId: string,
  status: RunStatus,
  options: { failureSummary?: string } = {},
): Promise<FlowPrRun> {
  return withStore((store) => {
    const run = store.runs.find((item) => item.id === runId);
    if (!run) throw new Error(`Local run not found: ${runId}`);
    run.status = status;
    run.updatedAt = nowIso();
    if (status === 'done' || status === 'failed') run.completedAt = run.updatedAt;
    if (options.failureSummary) run.failureSummary = options.failureSummary;
    return run;
  });
}

export async function localAppendTimelineEvent(input: TimelineEventInput): Promise<TimelineEvent> {
  return withStore((store) => {
    const now = nowIso();
    const sequence = store.timelineEvents.filter((event) => event.runId === input.runId).length + 1;
    const event: TimelineEvent = {
      id: randomUUID(),
      runId: input.runId,
      sequence,
      actor: input.actor,
      phase: input.phase,
      status: input.status as TimelineEventStatus,
      title: input.title,
      detail: input.detail,
      data: input.data ?? {},
      createdAt: now,
    };
    store.timelineEvents.push(event);
    return event;
  });
}

export async function localListTimelineEvents(runId: string): Promise<TimelineEvent[]> {
  return readOnly((store) =>
    store.timelineEvents
      .filter((event) => event.runId === runId)
      .sort((a, b) => a.sequence - b.sequence || byCreatedAt(a, b)),
  );
}

export async function localRecordProviderArtifact(input: ProviderArtifactInput): Promise<ProviderArtifact> {
  return withStore((store) => {
    const artifact: ProviderArtifact = {
      id: randomUUID(),
      ...input,
      storageBucket: input.storageBucket ?? (input.storageKey ? artifactStorageBucket : undefined),
      createdAt: nowIso(),
    };
    store.providerArtifacts.push(artifact);
    return artifact;
  });
}

export async function localListProviderArtifacts(runId: string): Promise<ProviderArtifact[]> {
  return readOnly((store) => store.providerArtifacts.filter((artifact) => artifact.runId === runId).sort(byCreatedAt));
}

export async function localRecordBrowserObservation(input: BrowserObservationInput): Promise<BrowserObservation> {
  return withStore((store) => {
    const observation: BrowserObservation = {
      id: randomUUID(),
      runId: input.runId,
      provider: input.provider,
      providerRunId: input.providerRunId ?? input.providerId,
      status: input.status,
      severity: input.severity,
      failedStep: input.failedStep,
      expectedBehavior: input.expectedBehavior,
      observedBehavior: input.observedBehavior,
      viewport: input.viewport ?? {},
      screenshotUrl: input.screenshotUrl,
      screenshotKey: input.screenshotKey,
      traceUrl: input.traceUrl,
      traceKey: input.traceKey,
      domSummary: input.domSummary,
      consoleErrors: input.consoleErrors ?? [],
      networkErrors: input.networkErrors ?? [],
      result: input.result ?? {},
      raw: input.raw,
      createdAt: nowIso(),
    };
    store.browserObservations.push(observation);
    return observation;
  });
}

export async function localListBrowserObservations(runId: string): Promise<BrowserObservation[]> {
  return readOnly((store) => store.browserObservations.filter((observation) => observation.runId === runId).sort(byCreatedAt));
}

export async function localRecordBugHypothesis(input: BugHypothesisInput): Promise<BugHypothesis> {
  return withStore((store) => {
    const hypothesis: BugHypothesis = {
      id: randomUUID(),
      runId: input.runId,
      summary: input.summary,
      affectedFlow: input.affectedFlow,
      suspectedCause: input.suspectedCause,
      confidence: input.confidence,
      severity: input.severity,
      acceptanceCriteria: input.acceptanceCriteria,
      evidence: input.evidence ?? {},
      createdAt: nowIso(),
    };
    store.bugHypotheses.push(hypothesis);
    return hypothesis;
  });
}

export async function localListBugHypotheses(runId: string): Promise<BugHypothesis[]> {
  return readOnly((store) => store.bugHypotheses.filter((hypothesis) => hypothesis.runId === runId).sort(byCreatedAt));
}

export async function localRecordPatch(input: PatchInput): Promise<PatchRecord> {
  return withStore((store) => {
    const now = nowIso();
    const patch: PatchRecord = {
      id: randomUUID(),
      runId: input.runId,
      hypothesisId: input.hypothesisId,
      branchName: input.branchName,
      commitSha: input.commitSha,
      status: input.status,
      summary: input.summary,
      diffStat: input.diffStat ?? {},
      filesChanged: input.filesChanged ?? [],
      raw: input.raw,
      createdAt: now,
      updatedAt: now,
    };
    store.patches.push(patch);
    return patch;
  });
}

export async function localListPatches(runId: string): Promise<PatchRecord[]> {
  return readOnly((store) => store.patches.filter((patch) => patch.runId === runId).sort(byCreatedAt));
}

export async function localRecordVerificationResult(input: VerificationResultInput): Promise<VerificationResult> {
  return withStore((store) => {
    const result: VerificationResult = {
      id: randomUUID(),
      runId: input.runId,
      patchId: input.patchId,
      provider: input.provider,
      status: input.status,
      summary: input.summary,
      testCommand: input.testCommand,
      artifacts: input.artifacts ?? [],
      raw: input.raw,
      createdAt: nowIso(),
    };
    store.verificationResults.push(result);
    return result;
  });
}

export async function localListVerificationResults(runId: string): Promise<VerificationResult[]> {
  return readOnly((store) => store.verificationResults.filter((result) => result.runId === runId).sort(byCreatedAt));
}

export async function localRecordPullRequest(input: PullRequestInput): Promise<PullRequestRecord> {
  return withStore((store) => {
    const now = nowIso();
    const pullRequest: PullRequestRecord = {
      id: randomUUID(),
      runId: input.runId,
      patchId: input.patchId,
      provider: input.provider ?? 'github',
      number: input.number,
      title: input.title,
      branchName: input.branchName,
      baseBranch: input.baseBranch,
      url: input.url,
      status: input.status,
      raw: input.raw,
      createdAt: now,
      updatedAt: now,
    };
    store.pullRequests.push(pullRequest);
    return pullRequest;
  });
}

export async function localListPullRequests(runId: string): Promise<PullRequestRecord[]> {
  return readOnly((store) => store.pullRequests.filter((pullRequest) => pullRequest.runId === runId).sort(byCreatedAt));
}

export async function localUpdatePullRequest(id: string, input: PullRequestUpdateInput): Promise<PullRequestRecord> {
  return withStore((store) => {
    const pullRequest = store.pullRequests.find((item) => item.id === id);
    if (!pullRequest) throw new Error(`Local pull request not found: ${id}`);
    if (input.status !== undefined) pullRequest.status = input.status as PullRequestStatus;
    if (input.number !== undefined) pullRequest.number = input.number;
    if (input.url !== undefined) pullRequest.url = input.url;
    if (input.raw !== undefined) pullRequest.raw = input.raw;
    pullRequest.updatedAt = nowIso();
    return pullRequest;
  });
}

export async function localRecordPolicyHit(input: PolicyHitInput): Promise<RunDetail['policyHits'][number]> {
  return withStore((store) => {
    const hit: RunDetail['policyHits'][number] = {
      id: randomUUID(),
      runId: input.runId,
      provider: input.provider,
      query: input.query,
      title: input.title,
      sourceUrl: input.sourceUrl,
      summary: input.summary,
      score: input.score,
      raw: input.raw,
      createdAt: nowIso(),
    };
    store.policyHits.push(hit);
    return hit;
  });
}

export async function localListPolicyHits(runId: string): Promise<RunDetail['policyHits']> {
  return readOnly((store) => store.policyHits.filter((hit) => hit.runId === runId).sort(byCreatedAt));
}

export async function localRecordAgentMemory(input: AgentMemoryInput): Promise<AgentMemory> {
  return withStore((store) => {
    const now = nowIso();
    const existing = store.agentMemories.find(
      (memory) => memory.projectId === input.projectId && memory.scope === input.scope && memory.key === input.key,
    );
    if (existing) {
      existing.runId = input.runId;
      existing.value = input.value;
      existing.confidence = input.confidence ?? 1;
      existing.expiresAt = input.expiresAt;
      existing.updatedAt = now;
      return existing;
    }
    const memory: AgentMemory = {
      id: randomUUID(),
      projectId: input.projectId,
      runId: input.runId,
      scope: input.scope,
      key: input.key,
      value: input.value,
      confidence: input.confidence ?? 1,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    store.agentMemories.push(memory);
    return memory;
  });
}

export async function localListAgentMemories(projectId: string): Promise<AgentMemory[]> {
  return readOnly((store) => store.agentMemories.filter((memory) => memory.projectId === projectId).sort((a, b) => -byCreatedAt(a, b)));
}

export async function localRecordAgentSession(input: AgentSessionInput): Promise<AgentSession> {
  return withStore((store) => {
    const now = nowIso();
    const session: AgentSession = {
      id: randomUUID(),
      runId: input.runId,
      sponsor: input.sponsor ?? 'guildai',
      providerSessionId: input.providerSessionId,
      status: input.status,
      goal: input.goal,
      metadata: input.metadata ?? {},
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      createdAt: now,
      updatedAt: now,
    };
    store.agentSessions.push(session);
    return session;
  });
}

export async function localUpdateAgentSessionsForRun(
  runId: string,
  status: AgentSessionStatus,
  metadata: Record<string, unknown> = {},
): Promise<AgentSession[]> {
  return withStore((store) => {
    const now = nowIso();
    const sessions = store.agentSessions.filter((session) => session.runId === runId);
    for (const session of sessions) {
      session.status = status;
      session.metadata = metadata;
      session.updatedAt = now;
      if (status === 'completed' || status === 'failed') session.endedAt = now;
    }
    return sessions;
  });
}

export async function localListAgentSessions(runId: string): Promise<AgentSession[]> {
  return readOnly((store) => store.agentSessions.filter((session) => session.runId === runId).sort(byCreatedAt));
}

export async function localRecordActionGate(input: ActionGateInput): Promise<ActionGate> {
  return withStore((store) => {
    const gate: ActionGate = {
      id: randomUUID(),
      runId: input.runId,
      sessionId: input.sessionId,
      gateType: input.gateType,
      riskLevel: input.riskLevel as RiskLevel,
      status: input.status as ActionGateStatus,
      reason: input.reason,
      requestedBy: input.requestedBy,
      resolvedBy: input.resolvedBy,
      metadata: input.metadata ?? {},
      createdAt: nowIso(),
      resolvedAt: input.resolvedAt,
    };
    store.actionGates.push(gate);
    return gate;
  });
}

export async function localListActionGates(runId: string): Promise<ActionGate[]> {
  return readOnly((store) => store.actionGates.filter((gate) => gate.runId === runId).sort(byCreatedAt));
}

export async function localRecordBenchmarkEvaluation(input: BenchmarkEvaluationInput): Promise<BenchmarkEvaluation> {
  return withStore((store) => {
    const evaluation: BenchmarkEvaluation = {
      id: randomUUID(),
      runId: input.runId,
      sponsor: input.sponsor ?? 'guildai',
      benchmarkName: input.benchmarkName,
      score: input.score,
      status: input.status as BenchmarkEvaluationStatus,
      metrics: input.metrics ?? {},
      artifactUrl: input.artifactUrl,
      raw: input.raw,
      createdAt: nowIso(),
    };
    store.benchmarkEvaluations.push(evaluation);
    return evaluation;
  });
}

export async function localListBenchmarkEvaluations(runId: string): Promise<BenchmarkEvaluation[]> {
  return readOnly((store) => store.benchmarkEvaluations.filter((evaluation) => evaluation.runId === runId).sort(byCreatedAt));
}

export async function localGetRunDetail(runId: string): Promise<RunDetail | null> {
  return readOnly((store) => {
    const run = store.runs.find((item) => item.id === runId);
    if (!run) return null;
    return {
      run,
      timelineEvents: store.timelineEvents.filter((event) => event.runId === runId).sort((a, b) => a.sequence - b.sequence || byCreatedAt(a, b)),
      providerArtifacts: store.providerArtifacts.filter((artifact) => artifact.runId === runId).sort(byCreatedAt),
      browserObservations: store.browserObservations.filter((observation) => observation.runId === runId).sort(byCreatedAt),
      bugHypotheses: store.bugHypotheses.filter((hypothesis) => hypothesis.runId === runId).sort(byCreatedAt),
      patches: store.patches.filter((patch) => patch.runId === runId).sort(byCreatedAt),
      verificationResults: store.verificationResults.filter((result) => result.runId === runId).sort(byCreatedAt),
      pullRequests: store.pullRequests.filter((pullRequest) => pullRequest.runId === runId).sort(byCreatedAt),
      policyHits: store.policyHits.filter((hit) => hit.runId === runId).sort(byCreatedAt),
      agentMemories: store.agentMemories.filter((memory) => memory.projectId === run.projectId).sort((a, b) => -byCreatedAt(a, b)),
      agentSessions: store.agentSessions.filter((session) => session.runId === runId).sort(byCreatedAt),
      actionGates: store.actionGates.filter((gate) => gate.runId === runId).sort(byCreatedAt),
      benchmarkEvaluations: store.benchmarkEvaluations.filter((evaluation) => evaluation.runId === runId).sort(byCreatedAt),
    };
  });
}

function localArtifactUrl(key: string): string {
  return `local://${artifactStorageBucket}/${key}`;
}

function contentTypeForKey(key: string, fallback = 'application/octet-stream'): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown; charset=utf-8';
  if (lower.endsWith('.zip')) return 'application/zip';
  return fallback;
}

async function bytesFromBody(body: RunArtifactUploadInput['body']): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  return new Uint8Array();
}

export function localArtifactKeyFromUrl(keyOrUrl: string): string {
  const prefix = `local://${artifactStorageBucket}/`;
  return keyOrUrl.startsWith(prefix) ? keyOrUrl.slice(prefix.length) : keyOrUrl;
}

export async function localUploadRunArtifact(input: RunArtifactUploadInput): Promise<RunArtifactUploadResult> {
  const bytes = await bytesFromBody(input.body);
  const key = localArtifactKeyFromUrl(input.key);
  const path = join(artifactsDir(), key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return {
    bucket: artifactStorageBucket,
    key,
    size: bytes.byteLength,
    mimeType: input.contentType ?? contentTypeForKey(key),
    uploadedAt: nowIso(),
    url: localArtifactUrl(key),
  };
}

export async function localDownloadRunArtifact(keyOrUrl: string): Promise<LocalRunArtifactDownloadResult> {
  const key = localArtifactKeyFromUrl(keyOrUrl);
  const bytes = await readFile(join(artifactsDir(), key));
  return {
    bytes: new Uint8Array(bytes),
    contentType: contentTypeForKey(key),
    cacheControl: 'public, max-age=300, immutable',
  };
}
