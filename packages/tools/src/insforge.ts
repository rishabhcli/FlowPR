import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { InsForgeClient } from '@insforge/sdk';
import type {
  ActionGate,
  ActionGateStatus,
  AgentMemory,
  AgentSession,
  AgentSessionStatus,
  BenchmarkEvaluation,
  BenchmarkEvaluationStatus,
  BrowserObservation,
  BrowserObservationProvider,
  BrowserObservationStatus,
  BugHypothesis,
  FlowPrRun,
  HypothesisConfidence,
  PatchRecord,
  PatchStatus,
  PolicyHit,
  ProviderArtifact,
  ProviderArtifactInput,
  PullRequestRecord,
  PullRequestStatus,
  RiskLevel,
  RunDetail,
  RunStartInput,
  RunStatus,
  TimelineActor,
  TimelineEvent,
  TimelineEventStatus,
  VerificationResult,
  VerificationStatus,
} from '@flowpr/schemas';
import { artifactStorageBucket, parseGitHubRepoUrl } from '@flowpr/schemas';
import { loadLocalEnv } from './env';

interface InsForgeProjectConfig {
  oss_host?: string;
  api_key?: string;
}

type JsonRecord = Record<string, unknown>;
type JsonRecordArray = JsonRecord[];

interface ProjectRow {
  id: string;
  repo_url: string;
  owner: string;
  repo: string;
  default_branch: string;
  production_url?: string | null;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  project_id: string;
  repo_url: string;
  owner: string;
  repo: string;
  base_branch: string;
  working_branch?: string | null;
  preview_url: string;
  flow_goal: string;
  status: RunStatus;
  risk_level: RiskLevel;
  agent_name: string;
  agent_version: string;
  guild_trace_id?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  failure_summary?: string | null;
  created_at: string;
  updated_at: string;
}

interface TimelineEventRow {
  id: string;
  run_id: string;
  sequence: number;
  actor: TimelineActor;
  phase: string;
  status: TimelineEventStatus;
  title: string;
  detail?: string | null;
  data?: JsonRecord | null;
  created_at: string;
}

interface ProviderArtifactRow {
  id: string;
  run_id: string;
  sponsor: ProviderArtifact['sponsor'];
  artifact_type: string;
  provider_id?: string | null;
  artifact_url?: string | null;
  storage_bucket?: string | null;
  storage_key?: string | null;
  request_summary?: JsonRecord | null;
  response_summary?: JsonRecord | null;
  raw?: JsonRecord | null;
  created_at: string;
}

interface BrowserObservationRow {
  id: string;
  run_id: string;
  provider: BrowserObservationProvider;
  provider_run_id?: string | null;
  status: BrowserObservationStatus;
  severity: RiskLevel;
  failed_step?: string | null;
  expected_behavior?: string | null;
  observed_behavior?: string | null;
  viewport?: JsonRecord | null;
  screenshot_url?: string | null;
  screenshot_key?: string | null;
  trace_url?: string | null;
  trace_key?: string | null;
  dom_summary?: string | null;
  console_errors?: JsonRecordArray | null;
  network_errors?: JsonRecordArray | null;
  result?: JsonRecord | null;
  raw?: JsonRecord | null;
  created_at: string;
}

interface BugHypothesisRow {
  id: string;
  run_id: string;
  summary: string;
  affected_flow: string;
  suspected_cause?: string | null;
  confidence: HypothesisConfidence;
  severity: RiskLevel;
  acceptance_criteria?: Array<{ text: string; source?: string }> | null;
  evidence?: JsonRecord | null;
  created_at: string;
}

interface PatchRow {
  id: string;
  run_id: string;
  hypothesis_id?: string | null;
  branch_name?: string | null;
  commit_sha?: string | null;
  status: PatchStatus;
  summary: string;
  diff_stat?: JsonRecord | null;
  files_changed?: JsonRecordArray | null;
  raw?: JsonRecord | null;
  created_at: string;
  updated_at: string;
}

interface VerificationResultRow {
  id: string;
  run_id: string;
  patch_id?: string | null;
  provider: string;
  status: VerificationStatus;
  summary: string;
  test_command?: string | null;
  artifacts?: JsonRecordArray | null;
  raw?: JsonRecord | null;
  created_at: string;
}

interface PullRequestRow {
  id: string;
  run_id: string;
  patch_id?: string | null;
  provider: string;
  number?: number | null;
  title: string;
  branch_name: string;
  base_branch: string;
  url?: string | null;
  status: PullRequestStatus;
  raw?: JsonRecord | null;
  created_at: string;
  updated_at: string;
}

interface PolicyHitRow {
  id: string;
  run_id: string;
  provider: string;
  query: string;
  title?: string | null;
  source_url?: string | null;
  summary?: string | null;
  score?: number | null;
  raw?: JsonRecord | null;
  created_at: string;
}

interface AgentMemoryRow {
  id: string;
  project_id: string;
  run_id?: string | null;
  scope: string;
  key: string;
  value?: JsonRecord | null;
  confidence: number;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentSessionRow {
  id: string;
  run_id: string;
  sponsor: string;
  provider_session_id?: string | null;
  status: AgentSessionStatus;
  goal: string;
  metadata?: JsonRecord | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface ActionGateRow {
  id: string;
  run_id: string;
  session_id?: string | null;
  gate_type: string;
  risk_level: RiskLevel;
  status: ActionGateStatus;
  reason: string;
  requested_by: string;
  resolved_by?: string | null;
  metadata?: JsonRecord | null;
  created_at: string;
  resolved_at?: string | null;
}

interface BenchmarkEvaluationRow {
  id: string;
  run_id: string;
  sponsor: string;
  benchmark_name: string;
  score?: number | null;
  status: BenchmarkEvaluationStatus;
  metrics?: JsonRecord | null;
  artifact_url?: string | null;
  raw?: JsonRecord | null;
  created_at: string;
}

export interface TimelineEventInput {
  runId: string;
  actor: TimelineActor;
  phase: string;
  status: TimelineEventStatus;
  title: string;
  detail?: string;
  data?: JsonRecord;
}

export interface BrowserObservationInput {
  runId: string;
  provider: BrowserObservationProvider;
  providerRunId?: string;
  providerId?: string;
  status: BrowserObservationStatus;
  severity: RiskLevel;
  failedStep?: string;
  expectedBehavior?: string;
  observedBehavior?: string;
  viewport?: JsonRecord;
  screenshotUrl?: string;
  screenshotKey?: string;
  traceUrl?: string;
  traceKey?: string;
  domSummary?: string;
  consoleErrors?: JsonRecordArray;
  networkErrors?: JsonRecordArray;
  result?: JsonRecord;
  raw?: JsonRecord;
}

export interface BugHypothesisInput {
  runId: string;
  summary: string;
  affectedFlow: string;
  suspectedCause?: string;
  confidence: HypothesisConfidence;
  severity: RiskLevel;
  acceptanceCriteria: Array<{ text: string; source?: string }>;
  evidence?: JsonRecord;
}

export interface PatchInput {
  runId: string;
  hypothesisId?: string;
  branchName?: string;
  commitSha?: string;
  status: PatchStatus;
  summary: string;
  diffStat?: JsonRecord;
  filesChanged?: JsonRecordArray;
  raw?: JsonRecord;
}

export interface VerificationResultInput {
  runId: string;
  patchId?: string;
  provider: string;
  status: VerificationStatus;
  summary: string;
  testCommand?: string;
  artifacts?: JsonRecordArray;
  raw?: JsonRecord;
}

export interface PullRequestInput {
  runId: string;
  patchId?: string;
  provider?: string;
  number?: number;
  title: string;
  branchName: string;
  baseBranch: string;
  url?: string;
  status: PullRequestStatus;
  raw?: JsonRecord;
}

export interface PolicyHitInput {
  runId: string;
  provider: string;
  query: string;
  title?: string;
  sourceUrl?: string;
  summary?: string;
  score?: number;
  raw?: JsonRecord;
}

export interface AgentSessionInput {
  runId: string;
  sponsor?: string;
  providerSessionId?: string;
  status: AgentSessionStatus;
  goal: string;
  metadata?: JsonRecord;
  startedAt?: string;
  endedAt?: string;
}

export interface ActionGateInput {
  runId: string;
  sessionId?: string;
  gateType: string;
  riskLevel: RiskLevel;
  status: ActionGateStatus;
  reason: string;
  requestedBy: string;
  resolvedBy?: string;
  metadata?: JsonRecord;
  resolvedAt?: string;
}

export interface BenchmarkEvaluationInput {
  runId: string;
  sponsor?: string;
  benchmarkName: string;
  score?: number;
  status: BenchmarkEvaluationStatus;
  metrics?: JsonRecord;
  artifactUrl?: string;
  raw?: JsonRecord;
}

export interface AgentMemoryInput {
  projectId: string;
  runId?: string;
  scope: string;
  key: string;
  value: JsonRecord;
  confidence?: number;
  expiresAt?: string;
}

export interface RunArtifactUploadInput {
  key: string;
  body: Blob | ArrayBuffer | Uint8Array | string;
  contentType?: string;
}

export interface RunArtifactUploadResult {
  bucket: string;
  key: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  url: string;
}

let cachedClient: InsForgeClient | undefined;

function readProjectConfig(): InsForgeProjectConfig {
  let dir = process.cwd();

  while (true) {
    const projectPath = join(dir, '.insforge', 'project.json');

    if (existsSync(projectPath)) {
      try {
        return JSON.parse(readFileSync(projectPath, 'utf8')) as InsForgeProjectConfig;
      } catch {
        return {};
      }
    }

    const parent = dirname(dir);

    if (parent === dir) return {};
    dir = parent;
  }
}

function getInsForgeConfig() {
  loadLocalEnv();
  const project = readProjectConfig();
  const baseUrl =
    process.env.INSFORGE_API_URL ??
    process.env.INSFORGE_URL ??
    process.env.NEXT_PUBLIC_INSFORGE_URL ??
    project.oss_host;
  const anonKey =
    process.env.INSFORGE_ANON_KEY ??
    process.env.INSFORGE_API_KEY ??
    process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY ??
    project.api_key;

  if (!baseUrl) {
    throw new Error('INSFORGE_API_URL or INSFORGE_URL is required');
  }

  if (!anonKey) {
    throw new Error('INSFORGE_ANON_KEY or INSFORGE_API_KEY is required');
  }

  return { baseUrl, anonKey };
}

export async function getInsForgeClient(): Promise<InsForgeClient> {
  if (!cachedClient) {
    const { createClient } = await import('@insforge/sdk');
    cachedClient = createClient(getInsForgeConfig());
  }

  return cachedClient;
}

export async function uploadRunArtifact(input: RunArtifactUploadInput): Promise<RunArtifactUploadResult> {
  const client = await getInsForgeClient();
  let blobPart: BlobPart;

  if (input.body instanceof Uint8Array) {
    const copy = new Uint8Array(input.body.byteLength);
    copy.set(input.body);
    blobPart = copy.buffer as ArrayBuffer;
  } else {
    blobPart = input.body;
  }

  const blob = input.body instanceof Blob
    ? input.body
    : new Blob([blobPart], { type: input.contentType ?? 'application/octet-stream' });
  const { data, error } = await client.storage.from(artifactStorageBucket).upload(input.key, blob);
  throwIfError(error, 'uploadRunArtifact');

  return data as RunArtifactUploadResult;
}

function firstRow<T>(data: unknown, operation: string): T {
  if (Array.isArray(data) && data[0]) {
    return data[0] as T;
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as T;
  }

  throw new Error(`${operation} did not return a row`);
}

function throwIfError(error: unknown, operation: string): void {
  if (!error) return;

  if (error instanceof Error) {
    throw new Error(`${operation} failed: ${error.message}`);
  }

  throw new Error(`${operation} failed: ${String(error)}`);
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function jsonRecordArray(value: unknown): JsonRecordArray {
  return Array.isArray(value) ? (value.filter((item) => item && typeof item === 'object') as JsonRecordArray) : [];
}

function mapRun(row: RunRow): FlowPrRun {
  return {
    id: row.id,
    projectId: row.project_id,
    repoUrl: row.repo_url,
    owner: row.owner,
    repo: row.repo,
    baseBranch: row.base_branch,
    workingBranch: row.working_branch ?? undefined,
    previewUrl: row.preview_url,
    flowGoal: row.flow_goal,
    status: row.status,
    riskLevel: row.risk_level,
    agentName: row.agent_name,
    agentVersion: row.agent_version,
    guildTraceId: row.guild_trace_id ?? undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    failureSummary: row.failure_summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTimelineEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    actor: row.actor,
    phase: row.phase,
    status: row.status,
    title: row.title,
    detail: row.detail ?? undefined,
    data: row.data ?? {},
    createdAt: row.created_at,
  };
}

function mapProviderArtifact(row: ProviderArtifactRow): ProviderArtifact {
  return {
    id: row.id,
    runId: row.run_id,
    sponsor: row.sponsor,
    artifactType: row.artifact_type,
    providerId: row.provider_id ?? undefined,
    artifactUrl: row.artifact_url ?? undefined,
    storageBucket: row.storage_bucket ?? undefined,
    storageKey: row.storage_key ?? undefined,
    requestSummary: row.request_summary ?? {},
    responseSummary: row.response_summary ?? {},
    raw: row.raw ?? undefined,
    createdAt: row.created_at,
  };
}

function mapBrowserObservation(row: BrowserObservationRow): BrowserObservation {
  return {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    providerRunId: row.provider_run_id ?? undefined,
    status: row.status,
    severity: row.severity,
    failedStep: row.failed_step ?? undefined,
    expectedBehavior: row.expected_behavior ?? undefined,
    observedBehavior: row.observed_behavior ?? undefined,
    viewport: row.viewport ?? {},
    screenshotUrl: row.screenshot_url ?? undefined,
    screenshotKey: row.screenshot_key ?? undefined,
    traceUrl: row.trace_url ?? undefined,
    traceKey: row.trace_key ?? undefined,
    domSummary: row.dom_summary ?? undefined,
    consoleErrors: jsonRecordArray(row.console_errors),
    networkErrors: jsonRecordArray(row.network_errors),
    result: row.result ?? {},
    raw: row.raw ?? undefined,
    createdAt: row.created_at,
  };
}

function mapBugHypothesis(row: BugHypothesisRow): BugHypothesis {
  return {
    id: row.id,
    runId: row.run_id,
    summary: row.summary,
    affectedFlow: row.affected_flow,
    suspectedCause: row.suspected_cause ?? undefined,
    confidence: row.confidence,
    severity: row.severity,
    acceptanceCriteria: row.acceptance_criteria ?? [],
    evidence: row.evidence ?? {},
    createdAt: row.created_at,
  };
}

function mapPatch(row: PatchRow): PatchRecord {
  return {
    id: row.id,
    runId: row.run_id,
    hypothesisId: row.hypothesis_id ?? undefined,
    branchName: row.branch_name ?? undefined,
    commitSha: row.commit_sha ?? undefined,
    status: row.status,
    summary: row.summary,
    diffStat: row.diff_stat ?? {},
    filesChanged: jsonRecordArray(row.files_changed),
    raw: row.raw ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapVerificationResult(row: VerificationResultRow): VerificationResult {
  return {
    id: row.id,
    runId: row.run_id,
    patchId: row.patch_id ?? undefined,
    provider: row.provider,
    status: row.status,
    summary: row.summary,
    testCommand: row.test_command ?? undefined,
    artifacts: jsonRecordArray(row.artifacts),
    raw: row.raw ?? undefined,
    createdAt: row.created_at,
  };
}

function mapPullRequest(row: PullRequestRow): PullRequestRecord {
  return {
    id: row.id,
    runId: row.run_id,
    patchId: row.patch_id ?? undefined,
    provider: row.provider,
    number: row.number ?? undefined,
    title: row.title,
    branchName: row.branch_name,
    baseBranch: row.base_branch,
    url: row.url ?? undefined,
    status: row.status,
    raw: row.raw ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPolicyHit(row: PolicyHitRow): PolicyHit {
  return {
    id: row.id,
    runId: row.run_id,
    provider: row.provider,
    query: row.query,
    title: row.title ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    summary: row.summary ?? undefined,
    score: row.score ?? undefined,
    raw: row.raw ?? undefined,
    createdAt: row.created_at,
  };
}

function mapAgentMemory(row: AgentMemoryRow): AgentMemory {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id ?? undefined,
    scope: row.scope,
    key: row.key,
    value: row.value ?? {},
    confidence: row.confidence,
    expiresAt: row.expires_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAgentSession(row: AgentSessionRow): AgentSession {
  return {
    id: row.id,
    runId: row.run_id,
    sponsor: row.sponsor,
    providerSessionId: row.provider_session_id ?? undefined,
    status: row.status,
    goal: row.goal,
    metadata: row.metadata ?? {},
    startedAt: row.started_at ?? undefined,
    endedAt: row.ended_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActionGate(row: ActionGateRow): ActionGate {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id ?? undefined,
    gateType: row.gate_type,
    riskLevel: row.risk_level,
    status: row.status,
    reason: row.reason,
    requestedBy: row.requested_by,
    resolvedBy: row.resolved_by ?? undefined,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

function mapBenchmarkEvaluation(row: BenchmarkEvaluationRow): BenchmarkEvaluation {
  return {
    id: row.id,
    runId: row.run_id,
    sponsor: row.sponsor,
    benchmarkName: row.benchmark_name,
    score: row.score ?? undefined,
    status: row.status,
    metrics: row.metrics ?? {},
    artifactUrl: row.artifact_url ?? undefined,
    raw: row.raw ?? undefined,
    createdAt: row.created_at,
  };
}

async function ensureProject(client: InsForgeClient, input: RunStartInput): Promise<ProjectRow> {
  const repoRef = parseGitHubRepoUrl(input.repoUrl);
  const { data: existing, error: lookupError } = await client.database
    .from('projects')
    .select('*')
    .eq('owner', repoRef.owner)
    .eq('repo', repoRef.repo)
    .maybeSingle();
  throwIfError(lookupError, 'ensureProject lookup');

  if (existing) {
    const { data, error } = await client.database
      .from('projects')
      .update({
        repo_url: input.repoUrl,
        default_branch: input.baseBranch,
        production_url: input.previewUrl,
      })
      .eq('id', (existing as ProjectRow).id)
      .select('*');
    throwIfError(error, 'ensureProject update');

    return firstRow<ProjectRow>(data, 'ensureProject update');
  }

  const now = new Date().toISOString();
  const { data, error } = await client.database
    .from('projects')
    .insert([
      {
        id: randomUUID(),
        repo_url: input.repoUrl,
        owner: repoRef.owner,
        repo: repoRef.repo,
        default_branch: input.baseBranch,
        production_url: input.previewUrl,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('*');
  throwIfError(error, 'ensureProject insert');

  return firstRow<ProjectRow>(data, 'ensureProject insert');
}

async function recordFlowSpec(client: InsForgeClient, run: FlowPrRun): Promise<void> {
  const { error } = await client.database.from('flow_specs').insert([
    {
      id: randomUUID(),
      project_id: run.projectId,
      run_id: run.id,
      name: run.flowGoal.slice(0, 96),
      goal: run.flowGoal,
      entry_url: run.previewUrl,
      viewport: { width: 390, height: 844, label: 'mobile' },
      steps: [],
      success_criteria: [
        {
          text: run.flowGoal,
          source: 'dashboard_input',
        },
      ],
      created_at: run.createdAt,
    },
  ]);
  throwIfError(error, 'recordFlowSpec');
}

export async function createRun(input: RunStartInput): Promise<FlowPrRun> {
  const client = await getInsForgeClient();
  const now = new Date().toISOString();
  const repoRef = parseGitHubRepoUrl(input.repoUrl);
  const project = await ensureProject(client, input);
  const row = {
    id: randomUUID(),
    project_id: project.id,
    repo_url: input.repoUrl,
    owner: repoRef.owner,
    repo: repoRef.repo,
    base_branch: input.baseBranch,
    preview_url: input.previewUrl,
    flow_goal: input.flowGoal,
    status: 'queued' satisfies RunStatus,
    risk_level: input.riskLevel,
    agent_name: process.env.FLOWPR_AGENT_NAME ?? 'flowpr-autonomous-frontend-qa',
    agent_version: process.env.FLOWPR_AGENT_VERSION ?? '0.1.0',
    started_at: now,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await client.database.from('qa_runs').insert([row]).select('*');
  throwIfError(error, 'createRun');

  const run = mapRun(firstRow<RunRow>(data, 'createRun'));
  await recordFlowSpec(client, run);

  const session = await recordAgentSession({
    runId: run.id,
    sponsor: 'guildai',
    status: 'created',
    goal: run.flowGoal,
    metadata: {
      agentName: run.agentName,
      agentVersion: run.agentVersion,
      projectId: run.projectId,
      mode: 'phase2_system_of_record',
    },
    startedAt: now,
  });

  await recordActionGate({
    runId: run.id,
    sessionId: session.id,
    gateType: 'autonomous_browser_qa',
    riskLevel: run.riskLevel,
    status: 'allowed',
    reason: 'Dashboard run creation permits browser QA and evidence collection for this run.',
    requestedBy: 'dashboard',
    resolvedBy: 'system',
    resolvedAt: now,
    metadata: {
      repoUrl: run.repoUrl,
      previewUrl: run.previewUrl,
    },
  });

  await recordAgentMemory({
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
  });

  return run;
}

export async function getRun(runId: string): Promise<FlowPrRun | null> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database.from('qa_runs').select('*').eq('id', runId).maybeSingle();
  throwIfError(error, 'getRun');

  return data ? mapRun(data as RunRow) : null;
}

export async function listRecentRuns(limit = 12): Promise<FlowPrRun[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('qa_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  throwIfError(error, 'listRecentRuns');

  return Array.isArray(data) ? data.map((row) => mapRun(row as RunRow)) : [];
}

export async function updateRunStatus(
  runId: string,
  status: RunStatus,
  options: { failureSummary?: string } = {},
): Promise<FlowPrRun> {
  const update: JsonRecord = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (status === 'done' || status === 'failed') {
    update.completed_at = new Date().toISOString();
  }

  if (options.failureSummary) {
    update.failure_summary = options.failureSummary;
  }

  const client = await getInsForgeClient();
  const { data, error } = await client.database.from('qa_runs').update(update).eq('id', runId).select('*');
  throwIfError(error, 'updateRunStatus');

  return mapRun(firstRow<RunRow>(data, 'updateRunStatus'));
}

export async function appendTimelineEvent(input: TimelineEventInput): Promise<TimelineEvent> {
  const client = await getInsForgeClient();
  const row = {
    id: randomUUID(),
    run_id: input.runId,
    sequence: 0,
    actor: input.actor,
    phase: input.phase,
    status: input.status,
    title: input.title,
    detail: input.detail,
    data: input.data ?? {},
    created_at: new Date().toISOString(),
  };
  const { data, error } = await client.database.from('timeline_events').insert([row]).select('*');
  throwIfError(error, 'appendTimelineEvent');

  return mapTimelineEvent(firstRow<TimelineEventRow>(data, 'appendTimelineEvent'));
}

export async function listTimelineEvents(runId: string): Promise<TimelineEvent[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('timeline_events')
    .select('*')
    .eq('run_id', runId)
    .order('sequence', { ascending: true });
  throwIfError(error, 'listTimelineEvents');

  return Array.isArray(data) ? data.map((row) => mapTimelineEvent(row as TimelineEventRow)) : [];
}

export async function recordProviderArtifact(input: ProviderArtifactInput): Promise<ProviderArtifact> {
  const client = await getInsForgeClient();
  const row = {
    id: randomUUID(),
    run_id: input.runId,
    sponsor: input.sponsor,
    artifact_type: input.artifactType,
    provider_id: input.providerId,
    artifact_url: input.artifactUrl,
    storage_bucket: input.storageBucket ?? (input.storageKey ? artifactStorageBucket : undefined),
    storage_key: input.storageKey,
    request_summary: input.requestSummary,
    response_summary: input.responseSummary,
    raw: input.raw,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await client.database.from('provider_artifacts').insert([row]).select('*');
  throwIfError(error, 'recordProviderArtifact');

  return mapProviderArtifact(firstRow<ProviderArtifactRow>(data, 'recordProviderArtifact'));
}

export async function listProviderArtifacts(runId: string): Promise<ProviderArtifact[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('provider_artifacts')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listProviderArtifacts');

  return Array.isArray(data) ? data.map((row) => mapProviderArtifact(row as ProviderArtifactRow)) : [];
}

export async function recordBrowserObservation(input: BrowserObservationInput): Promise<BrowserObservation> {
  const client = await getInsForgeClient();
  const row = {
    id: randomUUID(),
    run_id: input.runId,
    provider: input.provider,
    provider_run_id: input.providerRunId ?? input.providerId,
    status: input.status,
    severity: input.severity,
    failed_step: input.failedStep,
    expected_behavior: input.expectedBehavior,
    observed_behavior: input.observedBehavior,
    viewport: input.viewport ?? {},
    screenshot_url: input.screenshotUrl,
    screenshot_key: input.screenshotKey,
    trace_url: input.traceUrl,
    trace_key: input.traceKey,
    dom_summary: input.domSummary,
    console_errors: input.consoleErrors ?? [],
    network_errors: input.networkErrors ?? [],
    result: input.result ?? {},
    raw: input.raw,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await client.database.from('browser_observations').insert([row]).select('*');
  throwIfError(error, 'recordBrowserObservation');

  return mapBrowserObservation(firstRow<BrowserObservationRow>(data, 'recordBrowserObservation'));
}

export async function listBrowserObservations(runId: string): Promise<BrowserObservation[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('browser_observations')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listBrowserObservations');

  return Array.isArray(data) ? data.map((row) => mapBrowserObservation(row as BrowserObservationRow)) : [];
}

export async function recordBugHypothesis(input: BugHypothesisInput): Promise<BugHypothesis> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('bug_hypotheses')
    .insert([
      {
        id: randomUUID(),
        run_id: input.runId,
        summary: input.summary,
        affected_flow: input.affectedFlow,
        suspected_cause: input.suspectedCause,
        confidence: input.confidence,
        severity: input.severity,
        acceptance_criteria: input.acceptanceCriteria,
        evidence: input.evidence ?? {},
        created_at: new Date().toISOString(),
      },
    ])
    .select('*');
  throwIfError(error, 'recordBugHypothesis');

  return mapBugHypothesis(firstRow<BugHypothesisRow>(data, 'recordBugHypothesis'));
}

export async function listBugHypotheses(runId: string): Promise<BugHypothesis[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('bug_hypotheses')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listBugHypotheses');

  return Array.isArray(data) ? data.map((row) => mapBugHypothesis(row as BugHypothesisRow)) : [];
}

export async function recordPatch(input: PatchInput): Promise<PatchRecord> {
  const now = new Date().toISOString();
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('patches')
    .insert([
      {
        id: randomUUID(),
        run_id: input.runId,
        hypothesis_id: input.hypothesisId,
        branch_name: input.branchName,
        commit_sha: input.commitSha,
        status: input.status,
        summary: input.summary,
        diff_stat: input.diffStat ?? {},
        files_changed: input.filesChanged ?? [],
        raw: input.raw,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('*');
  throwIfError(error, 'recordPatch');

  return mapPatch(firstRow<PatchRow>(data, 'recordPatch'));
}

export async function listPatches(runId: string): Promise<PatchRecord[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('patches')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listPatches');

  return Array.isArray(data) ? data.map((row) => mapPatch(row as PatchRow)) : [];
}

export async function recordVerificationResult(input: VerificationResultInput): Promise<VerificationResult> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('verification_results')
    .insert([
      {
        id: randomUUID(),
        run_id: input.runId,
        patch_id: input.patchId,
        provider: input.provider,
        status: input.status,
        summary: input.summary,
        test_command: input.testCommand,
        artifacts: input.artifacts ?? [],
        raw: input.raw,
        created_at: new Date().toISOString(),
      },
    ])
    .select('*');
  throwIfError(error, 'recordVerificationResult');

  return mapVerificationResult(firstRow<VerificationResultRow>(data, 'recordVerificationResult'));
}

export async function listVerificationResults(runId: string): Promise<VerificationResult[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('verification_results')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listVerificationResults');

  return Array.isArray(data) ? data.map((row) => mapVerificationResult(row as VerificationResultRow)) : [];
}

export async function recordPullRequest(input: PullRequestInput): Promise<PullRequestRecord> {
  const now = new Date().toISOString();
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('pull_requests')
    .insert([
      {
        id: randomUUID(),
        run_id: input.runId,
        patch_id: input.patchId,
        provider: input.provider ?? 'github',
        number: input.number,
        title: input.title,
        branch_name: input.branchName,
        base_branch: input.baseBranch,
        url: input.url,
        status: input.status,
        raw: input.raw,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('*');
  throwIfError(error, 'recordPullRequest');

  return mapPullRequest(firstRow<PullRequestRow>(data, 'recordPullRequest'));
}

export async function listPullRequests(runId: string): Promise<PullRequestRecord[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('pull_requests')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listPullRequests');

  return Array.isArray(data) ? data.map((row) => mapPullRequest(row as PullRequestRow)) : [];
}

export async function recordPolicyHit(input: PolicyHitInput): Promise<PolicyHit> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('policy_hits')
    .insert([
      {
        id: randomUUID(),
        run_id: input.runId,
        provider: input.provider,
        query: input.query,
        title: input.title,
        source_url: input.sourceUrl,
        summary: input.summary,
        score: input.score,
        raw: input.raw,
        created_at: new Date().toISOString(),
      },
    ])
    .select('*');
  throwIfError(error, 'recordPolicyHit');

  return mapPolicyHit(firstRow<PolicyHitRow>(data, 'recordPolicyHit'));
}

export async function listPolicyHits(runId: string): Promise<PolicyHit[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('policy_hits')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listPolicyHits');

  return Array.isArray(data) ? data.map((row) => mapPolicyHit(row as PolicyHitRow)) : [];
}

export async function recordAgentMemory(input: AgentMemoryInput): Promise<AgentMemory> {
  const client = await getInsForgeClient();
  const now = new Date().toISOString();
  const { data: existing, error: lookupError } = await client.database
    .from('agent_memories')
    .select('*')
    .eq('project_id', input.projectId)
    .eq('scope', input.scope)
    .eq('key', input.key)
    .maybeSingle();
  throwIfError(lookupError, 'recordAgentMemory lookup');

  if (existing) {
    const { data, error } = await client.database
      .from('agent_memories')
      .update({
        run_id: input.runId,
        value: input.value,
        confidence: input.confidence ?? 1,
        expires_at: input.expiresAt,
        updated_at: now,
      })
      .eq('id', (existing as AgentMemoryRow).id)
      .select('*');
    throwIfError(error, 'recordAgentMemory update');

    return mapAgentMemory(firstRow<AgentMemoryRow>(data, 'recordAgentMemory update'));
  }

  const { data, error } = await client.database
    .from('agent_memories')
    .insert([
      {
        id: randomUUID(),
        project_id: input.projectId,
        run_id: input.runId,
        scope: input.scope,
        key: input.key,
        value: input.value,
        confidence: input.confidence ?? 1,
        expires_at: input.expiresAt,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('*');
  throwIfError(error, 'recordAgentMemory insert');

  return mapAgentMemory(firstRow<AgentMemoryRow>(data, 'recordAgentMemory insert'));
}

export async function listAgentMemories(projectId: string): Promise<AgentMemory[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('agent_memories')
    .select('*')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false });
  throwIfError(error, 'listAgentMemories');

  return Array.isArray(data) ? data.map((row) => mapAgentMemory(row as AgentMemoryRow)) : [];
}

export async function recordAgentSession(input: AgentSessionInput): Promise<AgentSession> {
  const now = new Date().toISOString();
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('agent_sessions')
    .insert([
      {
        id: randomUUID(),
        run_id: input.runId,
        sponsor: input.sponsor ?? 'guildai',
        provider_session_id: input.providerSessionId,
        status: input.status,
        goal: input.goal,
        metadata: input.metadata ?? {},
        started_at: input.startedAt,
        ended_at: input.endedAt,
        created_at: now,
        updated_at: now,
      },
    ])
    .select('*');
  throwIfError(error, 'recordAgentSession');

  return mapAgentSession(firstRow<AgentSessionRow>(data, 'recordAgentSession'));
}

export async function updateAgentSessionsForRun(
  runId: string,
  status: AgentSessionStatus,
  metadata: JsonRecord = {},
): Promise<AgentSession[]> {
  const update: JsonRecord = {
    status,
    metadata,
    updated_at: new Date().toISOString(),
  };

  if (status === 'completed' || status === 'failed') {
    update.ended_at = new Date().toISOString();
  }

  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('agent_sessions')
    .update(update)
    .eq('run_id', runId)
    .select('*');
  throwIfError(error, 'updateAgentSessionsForRun');

  return Array.isArray(data) ? data.map((row) => mapAgentSession(row as AgentSessionRow)) : [];
}

export async function listAgentSessions(runId: string): Promise<AgentSession[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('agent_sessions')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listAgentSessions');

  return Array.isArray(data) ? data.map((row) => mapAgentSession(row as AgentSessionRow)) : [];
}

export async function recordActionGate(input: ActionGateInput): Promise<ActionGate> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('action_gates')
    .insert([
      {
        id: randomUUID(),
        run_id: input.runId,
        session_id: input.sessionId,
        gate_type: input.gateType,
        risk_level: input.riskLevel,
        status: input.status,
        reason: input.reason,
        requested_by: input.requestedBy,
        resolved_by: input.resolvedBy,
        metadata: input.metadata ?? {},
        created_at: new Date().toISOString(),
        resolved_at: input.resolvedAt,
      },
    ])
    .select('*');
  throwIfError(error, 'recordActionGate');

  return mapActionGate(firstRow<ActionGateRow>(data, 'recordActionGate'));
}

export async function listActionGates(runId: string): Promise<ActionGate[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('action_gates')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listActionGates');

  return Array.isArray(data) ? data.map((row) => mapActionGate(row as ActionGateRow)) : [];
}

export async function recordBenchmarkEvaluation(
  input: BenchmarkEvaluationInput,
): Promise<BenchmarkEvaluation> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('benchmark_evaluations')
    .insert([
      {
        id: randomUUID(),
        run_id: input.runId,
        sponsor: input.sponsor ?? 'guildai',
        benchmark_name: input.benchmarkName,
        score: input.score,
        status: input.status,
        metrics: input.metrics ?? {},
        artifact_url: input.artifactUrl,
        raw: input.raw,
        created_at: new Date().toISOString(),
      },
    ])
    .select('*');
  throwIfError(error, 'recordBenchmarkEvaluation');

  return mapBenchmarkEvaluation(firstRow<BenchmarkEvaluationRow>(data, 'recordBenchmarkEvaluation'));
}

export async function listBenchmarkEvaluations(runId: string): Promise<BenchmarkEvaluation[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('benchmark_evaluations')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  throwIfError(error, 'listBenchmarkEvaluations');

  return Array.isArray(data) ? data.map((row) => mapBenchmarkEvaluation(row as BenchmarkEvaluationRow)) : [];
}

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  const run = await getRun(runId);

  if (!run) return null;

  const [
    timelineEvents,
    providerArtifacts,
    browserObservations,
    bugHypotheses,
    patches,
    verificationResults,
    pullRequests,
    policyHits,
    agentMemories,
    agentSessions,
    actionGates,
    benchmarkEvaluations,
  ] = await Promise.all([
    listTimelineEvents(runId),
    listProviderArtifacts(runId),
    listBrowserObservations(runId),
    listBugHypotheses(runId),
    listPatches(runId),
    listVerificationResults(runId),
    listPullRequests(runId),
    listPolicyHits(runId),
    listAgentMemories(run.projectId),
    listAgentSessions(runId),
    listActionGates(runId),
    listBenchmarkEvaluations(runId),
  ]);

  return {
    run,
    timelineEvents,
    providerArtifacts,
    browserObservations,
    bugHypotheses,
    patches,
    verificationResults,
    pullRequests,
    policyHits,
    agentMemories,
    agentSessions,
    actionGates,
    benchmarkEvaluations,
  };
}
