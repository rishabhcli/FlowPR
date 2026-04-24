import type { ProviderArtifact } from './provider-artifact';

export type RunStatus =
  | 'queued'
  | 'loading_repo'
  | 'running_browser_qa'
  | 'triaging_failure'
  | 'retrieving_policy'
  | 'patching_code'
  | 'running_local_tests'
  | 'running_live_verification'
  | 'creating_pr'
  | 'done'
  | 'failed';

export const runStatuses: RunStatus[] = [
  'queued',
  'loading_repo',
  'running_browser_qa',
  'triaging_failure',
  'retrieving_policy',
  'patching_code',
  'running_local_tests',
  'running_live_verification',
  'creating_pr',
  'done',
  'failed',
];

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export const riskLevels: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

export interface FlowPrRun {
  id: string;
  projectId: string;
  repoUrl: string;
  owner: string;
  repo: string;
  baseBranch: string;
  workingBranch?: string;
  previewUrl: string;
  flowGoal: string;
  status: RunStatus;
  riskLevel: RiskLevel;
  agentName: string;
  agentVersion: string;
  guildTraceId?: string;
  startedAt?: string;
  completedAt?: string;
  failureSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunStartInput {
  repoUrl: string;
  previewUrl: string;
  flowGoal: string;
  baseBranch: string;
  riskLevel: RiskLevel;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface RunDetail {
  run: FlowPrRun;
  timelineEvents: TimelineEvent[];
  providerArtifacts: ProviderArtifact[];
  browserObservations: BrowserObservation[];
  bugHypotheses: BugHypothesis[];
  patches: PatchRecord[];
  verificationResults: VerificationResult[];
  pullRequests: PullRequestRecord[];
  policyHits: PolicyHit[];
  agentMemories: AgentMemory[];
  agentSessions: AgentSession[];
  actionGates: ActionGate[];
  benchmarkEvaluations: BenchmarkEvaluation[];
}

export type TimelineActor =
  | 'user'
  | 'system'
  | 'worker'
  | 'agent'
  | 'insforge'
  | 'github'
  | 'redis'
  | 'tinyfish'
  | 'senso'
  | 'guildai'
  | 'shipables'
  | 'akash'
  | 'wundergraph'
  | 'playwright';

export type TimelineEventStatus = 'started' | 'completed' | 'failed' | 'skipped' | 'info';

export interface TimelineEvent {
  id: string;
  runId: string;
  sequence: number;
  actor: TimelineActor;
  phase: string;
  status: TimelineEventStatus;
  title: string;
  detail?: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export type BrowserObservationProvider = 'tinyfish' | 'playwright';
export type BrowserObservationStatus = 'queued' | 'passed' | 'failed' | 'errored';

export interface BrowserObservation {
  id: string;
  runId: string;
  provider: BrowserObservationProvider;
  providerRunId?: string;
  status: BrowserObservationStatus;
  severity: RiskLevel;
  failedStep?: string;
  expectedBehavior?: string;
  observedBehavior?: string;
  viewport: Record<string, unknown>;
  screenshotUrl?: string;
  screenshotKey?: string;
  traceUrl?: string;
  traceKey?: string;
  domSummary?: string;
  consoleErrors: Record<string, unknown>[];
  networkErrors: Record<string, unknown>[];
  result: Record<string, unknown>;
  raw?: Record<string, unknown>;
  createdAt: string;
}

export type HypothesisConfidence = 'low' | 'medium' | 'high';

export interface BugHypothesis {
  id: string;
  runId: string;
  summary: string;
  affectedFlow: string;
  suspectedCause?: string;
  confidence: HypothesisConfidence;
  severity: RiskLevel;
  acceptanceCriteria: Array<{ text: string; source?: string }>;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export type PatchStatus = 'planned' | 'generated' | 'applied' | 'tested' | 'failed' | 'abandoned';

export interface PatchRecord {
  id: string;
  runId: string;
  hypothesisId?: string;
  branchName?: string;
  commitSha?: string;
  status: PatchStatus;
  summary: string;
  diffStat: Record<string, unknown>;
  filesChanged: Record<string, unknown>[];
  raw?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type VerificationStatus = 'queued' | 'passed' | 'failed' | 'errored' | 'skipped';

export interface VerificationResult {
  id: string;
  runId: string;
  patchId?: string;
  provider: string;
  status: VerificationStatus;
  summary: string;
  testCommand?: string;
  artifacts: Record<string, unknown>[];
  raw?: Record<string, unknown>;
  createdAt: string;
}

export type PullRequestStatus = 'draft' | 'open' | 'merged' | 'closed' | 'failed';

export interface PullRequestRecord {
  id: string;
  runId: string;
  patchId?: string;
  provider: string;
  number?: number;
  title: string;
  branchName: string;
  baseBranch: string;
  url?: string;
  status: PullRequestStatus;
  raw?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyHit {
  id: string;
  runId: string;
  provider: string;
  query: string;
  title?: string;
  sourceUrl?: string;
  summary?: string;
  score?: number;
  raw?: Record<string, unknown>;
  createdAt: string;
}

export interface AgentMemory {
  id: string;
  projectId: string;
  runId?: string;
  scope: string;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type AgentSessionStatus = 'created' | 'running' | 'completed' | 'failed';

export interface AgentSession {
  id: string;
  runId: string;
  sponsor: string;
  providerSessionId?: string;
  status: AgentSessionStatus;
  goal: string;
  metadata: Record<string, unknown>;
  startedAt?: string;
  endedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ActionGateStatus = 'pending' | 'allowed' | 'blocked' | 'approved' | 'rejected';

export interface ActionGate {
  id: string;
  runId: string;
  sessionId?: string;
  gateType: string;
  riskLevel: RiskLevel;
  status: ActionGateStatus;
  reason: string;
  requestedBy: string;
  resolvedBy?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string;
}

export type BenchmarkEvaluationStatus = 'passed' | 'failed' | 'errored' | 'skipped';

export interface BenchmarkEvaluation {
  id: string;
  runId: string;
  sponsor: string;
  benchmarkName: string;
  score?: number;
  status: BenchmarkEvaluationStatus;
  metrics: Record<string, unknown>;
  artifactUrl?: string;
  raw?: Record<string, unknown>;
  createdAt: string;
}

export const artifactStorageBucket = 'flowpr-artifacts';

export function screenshotStorageKey(input: { runId: string; timestamp: string; label: string }): string {
  return `runs/${input.runId}/screenshots/${input.timestamp}-${input.label}.png`;
}

export function traceStorageKey(input: { runId: string; label: string }): string {
  return `runs/${input.runId}/traces/${input.label}.zip`;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  return value.trim();
}

export function parseGitHubRepoUrl(repoUrl: string): GitHubRepoRef {
  const trimmed = repoUrl.trim();
  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);

  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  const shorthandMatch = /^([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);

  if (shorthandMatch && !trimmed.includes('://')) {
    return { owner: shorthandMatch[1], repo: shorthandMatch[2] };
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('repoUrl must be a GitHub URL, SSH URL, or owner/repo pair');
  }

  if (parsed.hostname !== 'github.com') {
    throw new Error('repoUrl must point to github.com');
  }

  const [owner, rawRepo] = parsed.pathname.replace(/^\/+/, '').split('/');
  const repo = rawRepo?.replace(/\.git$/, '');

  if (!owner || !repo) {
    throw new Error('repoUrl must include both owner and repository name');
  }

  return { owner, repo };
}

export function parseRunStartInput(input: unknown): RunStartInput {
  if (!input || typeof input !== 'object') {
    throw new Error('Request body must be an object');
  }

  const value = input as Record<string, unknown>;
  const repoUrl = requiredString(value.repoUrl, 'repoUrl');
  const previewUrl = requiredString(value.previewUrl, 'previewUrl');
  const flowGoal = requiredString(value.flowGoal, 'flowGoal');
  const baseBranch = requiredString(value.baseBranch ?? 'main', 'baseBranch');
  const riskLevel = value.riskLevel === undefined ? 'medium' : requiredString(value.riskLevel, 'riskLevel');

  parseGitHubRepoUrl(repoUrl);

  try {
    const parsedPreview = new URL(previewUrl);

    if (!['http:', 'https:'].includes(parsedPreview.protocol)) {
      throw new Error('previewUrl must use http or https');
    }
  } catch {
    throw new Error('previewUrl must be a valid http or https URL');
  }

  if (!riskLevels.includes(riskLevel as RiskLevel)) {
    throw new Error(`riskLevel must be one of: ${riskLevels.join(', ')}`);
  }

  return {
    repoUrl,
    previewUrl,
    flowGoal,
    baseBranch,
    riskLevel: riskLevel as RiskLevel,
  };
}

export function createDraftRun(input: {
  repoUrl: string;
  previewUrl: string;
  flowGoal: string;
  baseBranch?: string;
  riskLevel?: RiskLevel;
}): FlowPrRun {
  const now = new Date().toISOString();
  const repoRef = parseGitHubRepoUrl(input.repoUrl);

  return {
    id: 'local-draft-run',
    projectId: 'local-draft-project',
    repoUrl: input.repoUrl,
    owner: repoRef.owner,
    repo: repoRef.repo,
    baseBranch: input.baseBranch ?? 'main',
    previewUrl: input.previewUrl,
    flowGoal: input.flowGoal,
    status: 'queued',
    riskLevel: input.riskLevel ?? 'medium',
    agentName: 'flowpr-autonomous-frontend-qa',
    agentVersion: '0.1.0',
    createdAt: now,
    updatedAt: now,
  };
}
