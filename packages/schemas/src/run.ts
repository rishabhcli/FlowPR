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
}

export interface TimelineEvent {
  id: string;
  runId: string;
  status: RunStatus;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface BrowserObservation {
  id: string;
  runId: string;
  provider: 'tinyfish' | 'playwright';
  providerId?: string;
  status: 'queued' | 'passed' | 'failed' | 'errored';
  failedStep?: string;
  expectedBehavior?: string;
  observedBehavior?: string;
  severity: RiskLevel;
  screenshotUrl?: string;
  raw?: Record<string, unknown>;
  createdAt: string;
}

export interface BugHypothesis {
  id: string;
  runId: string;
  summary: string;
  affectedFlow: string;
  suspectedCause?: string;
  confidence: 'low' | 'medium' | 'high';
  severity: RiskLevel;
  acceptanceCriteria: Array<{ text: string; source?: string }>;
  createdAt: string;
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
