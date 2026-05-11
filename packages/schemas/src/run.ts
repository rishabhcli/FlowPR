import type { ProviderArtifact } from './provider-artifact';

export type RunStatus =
  | 'queued'
  | 'loading_repo'
  | 'discovering_flows'
  | 'running_browser_qa'
  | 'collecting_visual_evidence'
  | 'triaging_failure'
  | 'retrieving_policy'
  | 'searching_memory'
  | 'patching_code'
  | 'running_local_tests'
  | 'running_live_verification'
  | 'creating_pr'
  | 'publishing_artifacts'
  | 'learned'
  | 'done'
  | 'failed';

export const runStatuses: RunStatus[] = [
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
  'failed',
];

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export const riskLevels: RiskLevel[] = ['low', 'medium', 'high', 'critical'];

export type PermissionProfile = 'investigation-only' | 'draft-pr-only' | 'verified-pr';

export const permissionProfiles: PermissionProfile[] = [
  'investigation-only',
  'draft-pr-only',
  'verified-pr',
];

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
  permissionProfile: PermissionProfile;
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
  permissionProfile: PermissionProfile;
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

export interface BrowserObservationResult {
  provider: BrowserObservationProvider;
  providerRunId?: string;
  passed: boolean;
  failedStep?: string;
  visibleError?: string;
  finalUrl: string;
  screenshotUrls: string[];
  traceUrl?: string;
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status?: number; method?: string }>;
  domFindings: string[];
  likelyRootCause?: string;
  confidence: number;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export function isLocalPreviewUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return /(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/.test(value);
  }
}

function stringifyObservationValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function hasPassedLocalPlaywrightObservation(observations: BrowserObservation[]): boolean {
  return observations.some(
    (observation) =>
      observation.provider === 'playwright' &&
      observation.status === 'passed' &&
      observation.result?.passed === true,
  );
}

export function isRemoteLocalhostReachabilityObservation(
  previewUrl: string,
  observation: BrowserObservation,
): boolean {
  if (observation.provider !== 'tinyfish' || !isLocalPreviewUrl(previewUrl)) {
    return false;
  }

  const haystack = [
    observation.failedStep,
    observation.observedBehavior,
    observation.result?.finalUrl,
    observation.networkErrors,
    observation.raw,
  ].map(stringifyObservationValue).join(' ');

  return /(ERR_CONNECTION_REFUSED|ECONNREFUSED|chrome-error:\/\/chromewebdata|refused to connect|loopback|localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(haystack);
}

export function isIgnoredRemoteLocalhostObservation(
  previewUrl: string,
  observations: BrowserObservation[],
  observation: BrowserObservation,
): boolean {
  return hasPassedLocalPlaywrightObservation(observations)
    && isRemoteLocalhostReachabilityObservation(previewUrl, observation);
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

export function hasPullRequestArtifact(
  pullRequest: Pick<PullRequestRecord, 'number' | 'url' | 'status'>,
): boolean {
  return pullRequest.status !== 'failed' && (pullRequest.number != null || Boolean(pullRequest.url));
}

export function isBlockedPullRequestAttempt(
  pullRequest: Pick<PullRequestRecord, 'number' | 'url' | 'status'>,
): boolean {
  return pullRequest.status === 'failed' && pullRequest.number == null && !pullRequest.url;
}

export type EvidenceIntegrityIssueKind = 'browser_observation' | 'verification_result' | 'pull_request';
export type EvidenceIntegrityIssueSeverity = 'warning' | 'danger';

export interface EvidenceIntegrityIssue {
  id: string;
  kind: EvidenceIntegrityIssueKind;
  severity: EvidenceIntegrityIssueSeverity;
  recordId: string;
  provider: string;
  message: string;
  expectedArtifact: string;
}

function providerArtifactHaystack(artifact: ProviderArtifact): string {
  return [
    artifact.sponsor,
    artifact.artifactType,
    artifact.providerId,
    artifact.artifactUrl,
    artifact.storageKey,
    stringifyObservationValue(artifact.requestSummary),
    stringifyObservationValue(artifact.responseSummary),
    stringifyObservationValue(artifact.raw),
  ].join(' ');
}

function artifactMentionsValue(artifact: ProviderArtifact, value: string | undefined): boolean {
  if (!value) return false;

  return artifact.providerId === value ||
    artifact.artifactUrl === value ||
    artifact.storageKey === value ||
    providerArtifactHaystack(artifact).includes(value);
}

function collectStringValues(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string' && value.trim()) {
    output.push(value.trim());
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStringValues(item, output);
    }
    return output;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStringValues(item, output);
    }
  }

  return output;
}

function verificationArtifactValues(result: VerificationResult): string[] {
  return Array.from(new Set([
    result.id,
    result.testCommand,
    ...collectStringValues(result.artifacts),
    ...collectStringValues(result.raw),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function providerArtifactMatchesAnyValue(artifact: ProviderArtifact, values: string[]): boolean {
  return values.some((value) => artifactMentionsValue(artifact, value));
}

function hasObservationArtifact(observation: BrowserObservation, artifacts: ProviderArtifact[]): boolean {
  const values = [
    observation.providerRunId,
    observation.screenshotUrl,
    observation.screenshotKey,
    observation.traceUrl,
    observation.traceKey,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  if (values.length === 0) return false;

  return artifacts.some(
    (artifact) =>
      artifact.sponsor === observation.provider &&
      providerArtifactMatchesAnyValue(artifact, values),
  );
}

function expectedVerificationArtifact(input: VerificationResult): {
  sponsor: ProviderArtifact['sponsor'];
  artifactType: string;
} | undefined {
  if (input.provider === 'local') {
    return { sponsor: 'playwright', artifactType: 'local_verification' };
  }

  if (input.provider === 'playwright') {
    return { sponsor: 'playwright', artifactType: 'trace_capture' };
  }

  if (input.provider === 'tinyfish') {
    return { sponsor: 'tinyfish', artifactType: 'browser_flow_test' };
  }

  if (input.provider === 'tinyfish-live') {
    return { sponsor: 'tinyfish', artifactType: 'live_reverification' };
  }

  return undefined;
}

function hasVerificationArtifact(result: VerificationResult, artifacts: ProviderArtifact[]): boolean {
  const expected = expectedVerificationArtifact(result);

  if (!expected) return true;

  const values = verificationArtifactValues(result);

  return artifacts.some((artifact) => {
    if (artifact.sponsor !== expected.sponsor || artifact.artifactType !== expected.artifactType) {
      return false;
    }

    if (expected.artifactType === 'live_reverification') {
      return true;
    }

    return providerArtifactMatchesAnyValue(artifact, values);
  });
}

function hasOpenedPullRequestArtifact(pullRequest: PullRequestRecord, artifacts: ProviderArtifact[]): boolean {
  const values = [
    pullRequest.url,
    pullRequest.number != null ? String(pullRequest.number) : undefined,
    pullRequest.branchName,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return artifacts.some(
    (artifact) =>
      artifact.sponsor === 'github' &&
      artifact.artifactType === 'pull_request' &&
      providerArtifactMatchesAnyValue(artifact, values),
  );
}

function hasBlockedPullRequestArtifact(pullRequest: PullRequestRecord, artifacts: ProviderArtifact[]): boolean {
  const gate = pullRequest.raw?.gate as { providerDecisionId?: unknown } | undefined;
  const decisionId = typeof gate?.providerDecisionId === 'string' ? gate.providerDecisionId : undefined;
  const values = [
    decisionId,
    pullRequest.title,
    pullRequest.branchName,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return artifacts.some(
    (artifact) =>
      artifact.sponsor === 'guildai' &&
      artifact.artifactType === 'action_gate_create_pull_request' &&
      providerArtifactMatchesAnyValue(artifact, values),
  );
}

export function validateRunEvidenceIntegrity(
  detail: Pick<RunDetail, 'browserObservations' | 'verificationResults' | 'pullRequests' | 'providerArtifacts'>,
): EvidenceIntegrityIssue[] {
  const issues: EvidenceIntegrityIssue[] = [];

  for (const observation of detail.browserObservations) {
    if (!hasObservationArtifact(observation, detail.providerArtifacts)) {
      issues.push({
        id: `browser_observation:${observation.id}`,
        kind: 'browser_observation',
        severity: 'danger',
        recordId: observation.id,
        provider: observation.provider,
        expectedArtifact: `${observation.provider} provider artifact linked by providerRunId, screenshot, or trace`,
        message: `${observation.provider} observation ${observation.id.slice(0, 8)} has no matching durable provider artifact.`,
      });
    }
  }

  for (const result of detail.verificationResults) {
    const expected = expectedVerificationArtifact(result);

    if (!expected && result.status !== 'queued' && result.status !== 'skipped') {
      issues.push({
        id: `verification_result:${result.id}:unknown_provider`,
        kind: 'verification_result',
        severity: result.status === 'passed' ? 'danger' : 'warning',
        recordId: result.id,
        provider: result.provider,
        expectedArtifact: 'known provider-artifact mapping',
        message: `${result.provider} verification ${result.id.slice(0, 8)} has no provider-artifact integrity mapping.`,
      });
    }

    if (expected && !hasVerificationArtifact(result, detail.providerArtifacts)) {
      issues.push({
        id: `verification_result:${result.id}`,
        kind: 'verification_result',
        severity: result.status === 'passed' ? 'danger' : 'warning',
        recordId: result.id,
        provider: result.provider,
        expectedArtifact: `${expected.sponsor}/${expected.artifactType}`,
        message: `${result.provider} verification ${result.id.slice(0, 8)} is not backed by a ${expected.sponsor}/${expected.artifactType} provider artifact.`,
      });
    }
  }

  for (const pullRequest of detail.pullRequests) {
    if (hasPullRequestArtifact(pullRequest) && !hasOpenedPullRequestArtifact(pullRequest, detail.providerArtifacts)) {
      issues.push({
        id: `pull_request:${pullRequest.id}`,
        kind: 'pull_request',
        severity: 'danger',
        recordId: pullRequest.id,
        provider: pullRequest.provider,
        expectedArtifact: 'github/pull_request',
        message: `Pull request ${pullRequest.title} has URL or number data but no matching github/pull_request provider artifact.`,
      });
    }

    if (isBlockedPullRequestAttempt(pullRequest) && !hasBlockedPullRequestArtifact(pullRequest, detail.providerArtifacts)) {
      issues.push({
        id: `pull_request_gate:${pullRequest.id}`,
        kind: 'pull_request',
        severity: 'warning',
        recordId: pullRequest.id,
        provider: pullRequest.provider,
        expectedArtifact: 'guildai/action_gate_create_pull_request',
        message: `Blocked PR attempt ${pullRequest.title} has no matching Guild.ai action gate provider artifact.`,
      });
    }
  }

  return issues;
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
  const permissionProfile = value.permissionProfile === undefined
    ? 'draft-pr-only'
    : requiredString(value.permissionProfile, 'permissionProfile');

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

  if (!permissionProfiles.includes(permissionProfile as PermissionProfile)) {
    throw new Error(`permissionProfile must be one of: ${permissionProfiles.join(', ')}`);
  }

  return {
    repoUrl,
    previewUrl,
    flowGoal,
    baseBranch,
    riskLevel: riskLevel as RiskLevel,
    permissionProfile: permissionProfile as PermissionProfile,
  };
}

export function createDraftRun(input: {
  repoUrl: string;
  previewUrl: string;
  flowGoal: string;
  baseBranch?: string;
  riskLevel?: RiskLevel;
  permissionProfile?: PermissionProfile;
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
    permissionProfile: input.permissionProfile ?? 'draft-pr-only',
    agentName: 'flowpr-autonomous-frontend-qa',
    agentVersion: '0.1.0',
    createdAt: now,
    updatedAt: now,
  };
}
