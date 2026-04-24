import { randomUUID } from 'node:crypto';
import { loadLocalEnv } from './env';

export type GuildPermissionProfile = 'investigation-only' | 'draft-pr-only' | 'verified-pr';

export type GuildActionName =
  | 'generate_patch'
  | 'push_branch'
  | 'create_pull_request'
  | 'live_verification'
  | 'close_session';

export type GuildActionDecision = 'allowed' | 'denied' | 'requires_approval';

export interface GuildAgentVersion {
  name: string;
  version: string;
  owner: string;
  permissionProfile: GuildPermissionProfile;
  capabilities: string[];
  benchmarkStatus: 'unknown' | 'passed' | 'failed';
}

export interface GuildAgentSession {
  sessionId: string;
  runId: string;
  agentName: string;
  agentVersion: string;
  permissionProfile: GuildPermissionProfile;
  traceUrl?: string;
  traceId?: string;
  startedAt: string;
  provider: 'guildai-live' | 'guildai-local';
}

export interface GuildActionGateInput {
  sessionId: string;
  runId: string;
  action: GuildActionName;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  filesChanged?: string[];
  verificationStatus?: 'passed' | 'failed' | 'pending' | 'skipped';
  extra?: Record<string, unknown>;
}

export interface GuildActionGateDecision {
  decision: GuildActionDecision;
  reason: string;
  providerDecisionId: string;
  permissionProfile: GuildPermissionProfile;
  requiresApproval: boolean;
}

export interface GuildToolCallInput {
  sessionId: string;
  provider: 'tinyfish' | 'redis' | 'insforge' | 'wundergraph' | 'senso' | 'github' | 'playwright';
  action: string;
  status: 'succeeded' | 'failed' | 'skipped';
  durationMs: number;
  artifactId?: string;
  metadata?: Record<string, unknown>;
}

export interface GuildToolCallRecord extends GuildToolCallInput {
  id: string;
  recordedAt: string;
}

export interface GuildSessionCompletionInput {
  sessionId: string;
  outcome: 'verified_pr_created' | 'draft_pr_created' | 'investigation_only' | 'failed';
  prUrl?: string;
  summary: string;
  metrics?: Record<string, unknown>;
}

export interface GuildSessionSummary {
  sessionId: string;
  outcome: string;
  completedAt: string;
  toolCallCount: number;
  gateAllowedCount: number;
  gateDeniedCount: number;
  traceUrl?: string;
  prUrl?: string;
  summary: string;
}

export interface GuildBenchmarkResult {
  agent: string;
  version: string;
  suiteName: string;
  passed: number;
  failed: number;
  metrics: Record<string, unknown>;
  providerEvalId: string;
  promoted: boolean;
  artifactUrl?: string;
  recordedAt: string;
}

interface GuildRuntimeConfig {
  baseUrl?: string;
  apiKey?: string;
  workspace?: string;
  agentId: string;
  githubAppInstalled: boolean;
}

const PROMOTION_SUITE = 'frontend-bugs';

const localToolCalls = new Map<string, GuildToolCallRecord[]>();
const localGateCounts = new Map<string, { allowed: number; denied: number }>();
const localSessions = new Map<string, GuildAgentSession>();
const localBenchmarks = new Map<string, GuildBenchmarkResult>();

function benchmarkKey(agent: string, version: string, suite: string): string {
  return `${agent}@${version}::${suite}`;
}

function readConfig(): GuildRuntimeConfig {
  loadLocalEnv();
  return {
    baseUrl: process.env.GUILD_AI_BASE_URL,
    apiKey: process.env.GUILD_AI_API_KEY,
    workspace: process.env.GUILD_AI_WORKSPACE,
    agentId: process.env.GUILD_AI_AGENT_ID ?? 'flowpr-autonomous-frontend-qa',
    githubAppInstalled: process.env.GUILD_GITHUB_APP_INSTALLED === 'true',
  };
}

function provider(config: GuildRuntimeConfig): 'guildai-live' | 'guildai-local' {
  return config.apiKey || config.githubAppInstalled ? 'guildai-live' : 'guildai-local';
}

export function describeAgentVersion(input: { version: string; permissionProfile: GuildPermissionProfile; capabilities: string[] }): GuildAgentVersion {
  const config = readConfig();

  return {
    name: config.agentId,
    version: input.version,
    owner: process.env.FLOWPR_AGENT_OWNER ?? 'FlowPR',
    permissionProfile: input.permissionProfile,
    capabilities: input.capabilities,
    benchmarkStatus: localBenchmarks.get(benchmarkKey(config.agentId, input.version, PROMOTION_SUITE))?.promoted
      ? 'passed'
      : 'unknown',
  };
}

export async function startGuildAgentSession(input: {
  runId: string;
  agentName: string;
  agentVersion: string;
  permissionProfile: GuildPermissionProfile;
  flowGoal?: string;
  repoUrl?: string;
}): Promise<GuildAgentSession> {
  const config = readConfig();
  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const traceId = `guild_session_${sessionId.slice(0, 8)}`;
  const session: GuildAgentSession = {
    sessionId,
    runId: input.runId,
    agentName: input.agentName,
    agentVersion: input.agentVersion,
    permissionProfile: input.permissionProfile,
    traceId,
    traceUrl: config.workspace
      ? `https://guild.ai/${config.workspace}/agents/${encodeURIComponent(input.agentName)}/sessions/${traceId}`
      : undefined,
    startedAt,
    provider: provider(config),
  };

  localSessions.set(sessionId, session);
  localToolCalls.set(sessionId, []);
  localGateCounts.set(sessionId, { allowed: 0, denied: 0 });

  return session;
}

export async function requestGuildActionGate(input: GuildActionGateInput): Promise<GuildActionGateDecision> {
  const session = localSessions.get(input.sessionId);
  const permissionProfile = session?.permissionProfile ?? 'draft-pr-only';
  const providerDecisionId = `gate_${input.action}_${randomUUID().slice(0, 12)}`;
  const filesChangedCount = input.filesChanged?.length ?? 0;

  const deny = (reason: string): GuildActionGateDecision => {
    localGateCounts.set(input.sessionId, {
      allowed: localGateCounts.get(input.sessionId)?.allowed ?? 0,
      denied: (localGateCounts.get(input.sessionId)?.denied ?? 0) + 1,
    });

    return {
      decision: 'denied',
      providerDecisionId,
      permissionProfile,
      reason,
      requiresApproval: false,
    };
  };

  const approve = (reason: string, requiresApproval = false): GuildActionGateDecision => {
    localGateCounts.set(input.sessionId, {
      allowed: (localGateCounts.get(input.sessionId)?.allowed ?? 0) + 1,
      denied: localGateCounts.get(input.sessionId)?.denied ?? 0,
    });

    return {
      decision: requiresApproval ? 'requires_approval' : 'allowed',
      providerDecisionId,
      permissionProfile,
      reason,
      requiresApproval,
    };
  };

  if (filesChangedCount > 3 && input.action !== 'live_verification') {
    return deny(`Patch touches ${filesChangedCount} files which exceeds the draft-pr-only profile limit of 3.`);
  }

  const touchesSensitive = (input.filesChanged ?? []).some((file) => /auth|payment|billing|secret/i.test(file));

  if (touchesSensitive && permissionProfile !== 'verified-pr') {
    return deny(`Patch touches a sensitive file (${(input.filesChanged ?? []).find((file) => /auth|payment|billing|secret/i.test(file))}); profile requires human approval.`);
  }

  if (input.action === 'create_pull_request') {
    if (input.verificationStatus === 'failed') {
      return deny('Verification failed; PR creation is not allowed without passing evidence.');
    }

    if (permissionProfile === 'investigation-only') {
      return deny('Permission profile is investigation-only.');
    }

    if (input.riskLevel === 'critical' && permissionProfile !== 'verified-pr') {
      return approve('Critical flow PR allowed as draft only; escalate if verification regresses.', true);
    }
  }

  if (input.action === 'generate_patch' && input.riskLevel === 'critical' && filesChangedCount > 2) {
    return approve('Critical-risk patch is allowed but flagged for maintainer review.', true);
  }

  return approve(`Action ${input.action} is within ${permissionProfile} profile limits (files=${filesChangedCount}, risk=${input.riskLevel}).`);
}

export async function recordGuildToolCall(input: GuildToolCallInput): Promise<GuildToolCallRecord> {
  const record: GuildToolCallRecord = {
    ...input,
    id: `tool_${randomUUID().slice(0, 12)}`,
    recordedAt: new Date().toISOString(),
  };

  const existing = localToolCalls.get(input.sessionId) ?? [];
  existing.push(record);
  localToolCalls.set(input.sessionId, existing);

  return record;
}

export async function completeGuildAgentSession(input: GuildSessionCompletionInput): Promise<GuildSessionSummary> {
  const session = localSessions.get(input.sessionId);
  const gateCounts = localGateCounts.get(input.sessionId) ?? { allowed: 0, denied: 0 };
  const toolCalls = localToolCalls.get(input.sessionId) ?? [];
  const completedAt = new Date().toISOString();

  return {
    sessionId: input.sessionId,
    outcome: input.outcome,
    completedAt,
    toolCallCount: toolCalls.length,
    gateAllowedCount: gateCounts.allowed,
    gateDeniedCount: gateCounts.denied,
    traceUrl: session?.traceUrl,
    prUrl: input.prUrl,
    summary: input.summary,
  };
}

export function recordGuildBenchmark(input: {
  agent: string;
  version: string;
  suiteName: string;
  passed: number;
  failed: number;
  metrics?: Record<string, unknown>;
  artifactUrl?: string;
}): GuildBenchmarkResult {
  const promoted = input.failed === 0 && input.passed > 0 && input.suiteName === PROMOTION_SUITE;
  const result: GuildBenchmarkResult = {
    agent: input.agent,
    version: input.version,
    suiteName: input.suiteName,
    passed: input.passed,
    failed: input.failed,
    metrics: input.metrics ?? {},
    providerEvalId: `eval_${randomUUID().slice(0, 12)}`,
    promoted,
    artifactUrl: input.artifactUrl,
    recordedAt: new Date().toISOString(),
  };

  localBenchmarks.set(benchmarkKey(input.agent, input.version, input.suiteName), result);
  return result;
}

export function readGuildBenchmark(agent: string, version: string, suiteName = PROMOTION_SUITE): GuildBenchmarkResult | undefined {
  return localBenchmarks.get(benchmarkKey(agent, version, suiteName));
}

export function readGuildSession(sessionId: string): GuildAgentSession | undefined {
  return localSessions.get(sessionId);
}

export function readGuildSessionToolCalls(sessionId: string): GuildToolCallRecord[] {
  return localToolCalls.get(sessionId) ?? [];
}

export const guildPromotionSuiteName = PROMOTION_SUITE;
