import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { InsForgeClient } from '@insforge/sdk';
import type {
  BrowserObservation,
  FlowPrRun,
  ProviderArtifact,
  ProviderArtifactInput,
  RiskLevel,
  RunDetail,
  RunStartInput,
  RunStatus,
  TimelineEvent,
} from '@flowpr/schemas';
import { parseGitHubRepoUrl } from '@flowpr/schemas';
import { loadLocalEnv } from './env';

interface InsForgeProjectConfig {
  oss_host?: string;
  api_key?: string;
}

type JsonRecord = Record<string, unknown>;

interface RunRow {
  id: string;
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
  created_at: string;
  updated_at: string;
}

interface TimelineEventRow {
  id: string;
  run_id: string;
  status: RunStatus;
  message: string;
  metadata?: JsonRecord | null;
  created_at: string;
}

interface ProviderArtifactRow {
  id: string;
  run_id: string;
  sponsor: ProviderArtifact['sponsor'];
  artifact_type: string;
  provider_id?: string | null;
  artifact_url?: string | null;
  request_summary?: JsonRecord | null;
  response_summary?: JsonRecord | null;
  raw?: JsonRecord | null;
  created_at: string;
}

interface BrowserObservationRow {
  id: string;
  run_id: string;
  provider: BrowserObservation['provider'];
  provider_id?: string | null;
  status: BrowserObservation['status'];
  failed_step?: string | null;
  expected_behavior?: string | null;
  observed_behavior?: string | null;
  severity: RiskLevel;
  screenshot_url?: string | null;
  raw?: JsonRecord | null;
  created_at: string;
}

export interface TimelineEventInput {
  runId: string;
  status: RunStatus;
  message: string;
  metadata?: JsonRecord;
}

export interface BrowserObservationInput {
  runId: string;
  provider: BrowserObservation['provider'];
  providerId?: string;
  status: BrowserObservation['status'];
  failedStep?: string;
  expectedBehavior?: string;
  observedBehavior?: string;
  severity: RiskLevel;
  screenshotUrl?: string;
  raw?: JsonRecord;
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

function mapRun(row: RunRow): FlowPrRun {
  return {
    id: row.id,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTimelineEvent(row: TimelineEventRow): TimelineEvent {
  return {
    id: row.id,
    runId: row.run_id,
    status: row.status,
    message: row.message,
    metadata: row.metadata ?? {},
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
    providerId: row.provider_id ?? undefined,
    status: row.status,
    failedStep: row.failed_step ?? undefined,
    expectedBehavior: row.expected_behavior ?? undefined,
    observedBehavior: row.observed_behavior ?? undefined,
    severity: row.severity,
    screenshotUrl: row.screenshot_url ?? undefined,
    raw: row.raw ?? undefined,
    createdAt: row.created_at,
  };
}

export async function createRun(input: RunStartInput): Promise<FlowPrRun> {
  const client = await getInsForgeClient();
  const now = new Date().toISOString();
  const repoRef = parseGitHubRepoUrl(input.repoUrl);
  const row = {
    id: randomUUID(),
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
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await client.database.from('runs').insert([row]).select('*');
  throwIfError(error, 'createRun');

  return mapRun(firstRow<RunRow>(data, 'createRun'));
}

export async function getRun(runId: string): Promise<FlowPrRun | null> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database.from('runs').select('*').eq('id', runId).maybeSingle();
  throwIfError(error, 'getRun');

  return data ? mapRun(data as RunRow) : null;
}

export async function listRecentRuns(limit = 12): Promise<FlowPrRun[]> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  throwIfError(error, 'listRecentRuns');

  return Array.isArray(data) ? data.map((row) => mapRun(row as RunRow)) : [];
}

export async function updateRunStatus(runId: string, status: RunStatus): Promise<FlowPrRun> {
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('runs')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .select('*');
  throwIfError(error, 'updateRunStatus');

  return mapRun(firstRow<RunRow>(data, 'updateRunStatus'));
}

export async function appendTimelineEvent(input: TimelineEventInput): Promise<TimelineEvent> {
  const client = await getInsForgeClient();
  const row = {
    id: randomUUID(),
    run_id: input.runId,
    status: input.status,
    message: input.message,
    metadata: input.metadata ?? {},
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
    .order('created_at', { ascending: true });
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

export async function recordBrowserObservation(
  input: BrowserObservationInput,
): Promise<BrowserObservation> {
  const client = await getInsForgeClient();
  const row = {
    id: randomUUID(),
    run_id: input.runId,
    provider: input.provider,
    provider_id: input.providerId,
    status: input.status,
    failed_step: input.failedStep,
    expected_behavior: input.expectedBehavior,
    observed_behavior: input.observedBehavior,
    severity: input.severity,
    screenshot_url: input.screenshotUrl,
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

export async function getRunDetail(runId: string): Promise<RunDetail | null> {
  const run = await getRun(runId);

  if (!run) return null;

  const [timelineEvents, providerArtifacts, browserObservations] = await Promise.all([
    listTimelineEvents(runId),
    listProviderArtifacts(runId),
    listBrowserObservations(runId),
  ]);

  return {
    run,
    timelineEvents,
    providerArtifacts,
    browserObservations,
  };
}
