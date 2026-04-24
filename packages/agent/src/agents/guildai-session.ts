import {
  completeGuildAgentSession,
  recordGuildToolCall,
  requestGuildActionGate,
  startGuildAgentSession,
  readGuildBenchmark,
  guildPromotionSuiteName,
  type GuildActionGateDecision,
  type GuildActionGateInput,
  type GuildAgentSession,
  type GuildPermissionProfile,
  type GuildSessionCompletionInput,
  type GuildSessionSummary,
  type GuildToolCallInput,
} from '@flowpr/tools';

export type {
  GuildActionGateDecision,
  GuildAgentSession,
  GuildPermissionProfile,
  GuildSessionSummary,
  GuildToolCallInput,
};

export async function startAgentSession(input: {
  runId: string;
  agentName: string;
  agentVersion: string;
  permissionProfile: GuildPermissionProfile;
  flowGoal?: string;
  repoUrl?: string;
}): Promise<GuildAgentSession> {
  return startGuildAgentSession(input);
}

export async function requestActionGate(input: GuildActionGateInput): Promise<GuildActionGateDecision> {
  return requestGuildActionGate(input);
}

export async function recordToolCall(input: GuildToolCallInput): Promise<void> {
  await recordGuildToolCall(input);
}

export async function completeAgentSession(input: GuildSessionCompletionInput): Promise<GuildSessionSummary> {
  return completeGuildAgentSession(input);
}

export function promotionStatus(agent: string, version: string): 'promoted' | 'not_promoted' {
  return readGuildBenchmark(agent, version, guildPromotionSuiteName)?.promoted ? 'promoted' : 'not_promoted';
}
