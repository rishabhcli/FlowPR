import { createHash } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import type { RunStatus } from '@flowpr/schemas';
import { loadLocalEnv } from './env';

export const flowPrStreams = {
  runs: 'flowpr:runs',
  agentSteps: 'flowpr:agent_steps',
  browserResults: 'flowpr:browser_results',
  patches: 'flowpr:patches',
  verification: 'flowpr:verification',
  artifacts: 'flowpr:artifacts',
  actions: 'flowpr:action-gates',
  deadLetter: 'flowpr:dead_letter',
} as const;

export const flowPrReadableStreams = [
  flowPrStreams.runs,
  flowPrStreams.agentSteps,
  flowPrStreams.browserResults,
  flowPrStreams.patches,
  flowPrStreams.verification,
] as const;

export const flowPrConsumerGroup = 'flowpr-workers';

export const redisMemoryKeys = {
  bugSignature: (hash: string) => `flowpr:memory:bug-signatures:${hash}`,
  successfulPatch: (hash: string) => `flowpr:memory:successful-patches:${hash}`,
} as const;

export const redisLockKeys = {
  run: (runId: string) => `flowpr:locks:run:${runId}`,
  patch: (runId: string) => `flowpr:locks:patch:${runId}`,
  pr: (runId: string) => `flowpr:locks:pr:${runId}`,
} as const;

export type RunEventType = 'run.started';
export type AgentStepEventType = 'agent.step';
export type BrowserResultEventType = 'browser.result';
export type PatchEventType = 'patch.result';
export type VerificationEventType = 'verification.result';
export type FlowPrRedisEventType =
  | RunEventType
  | AgentStepEventType
  | BrowserResultEventType
  | PatchEventType
  | VerificationEventType;

export interface FlowPrRedisEvent {
  stream: string;
  id: string;
  runId: string;
  eventType: FlowPrRedisEventType;
  attempt: number;
  dedupeKey: string;
  createdAt: string;
  phase?: RunStatus;
  payload: Record<string, string>;
}

export type RunStreamEvent = FlowPrRedisEvent & { eventType: RunEventType };

interface EmitRunStartedInput {
  runId: string;
  repoUrl?: string;
  previewUrl?: string;
  flowGoal?: string;
  attempt?: number;
}

interface EmitAgentStepInput {
  runId: string;
  phase: RunStatus;
  attempt?: number;
  reason?: string;
  previousStreamId?: string;
  dedupeKey?: string;
}

interface StreamEntry {
  id: string;
  message: Record<string, string>;
}

export interface RedisStreamStats {
  stream: string;
  length: number;
  groups: Array<Record<string, unknown>>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function compactFields(input: Record<string, string | number | boolean | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
}

function normalizeMessage(message: unknown): Record<string, string> {
  if (!message || typeof message !== 'object') return {};

  return Object.fromEntries(
    Object.entries(message as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]),
  );
}

function parseAttempt(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '1', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseMessage(stream: string, id: string, message: Record<string, string>): FlowPrRedisEvent {
  const eventType = message.eventType as FlowPrRedisEventType | undefined;

  if (!eventType) {
    throw new Error(`Redis stream ${stream} event ${id} is missing eventType`);
  }

  if (!message.runId) {
    throw new Error(`Redis stream ${stream} event ${id} is missing runId`);
  }

  return {
    stream,
    id,
    runId: message.runId,
    eventType,
    attempt: parseAttempt(message.attempt),
    dedupeKey: message.dedupeKey || `${eventType}:${message.runId}:${id}`,
    createdAt: message.createdAt || nowIso(),
    phase: message.phase as RunStatus | undefined,
    payload: message,
  };
}

export function createFlowPrRedisClient(): RedisClientType {
  loadLocalEnv();
  const url = process.env.REDIS_URL;

  if (!url) {
    throw new Error('REDIS_URL is required');
  }

  return createClient({ url });
}

export async function connectFlowPrRedisClient(client = createFlowPrRedisClient()): Promise<RedisClientType> {
  if (!client.isOpen) {
    await client.connect();
  }

  return client;
}

export async function ensureFlowPrConsumerGroups(client: RedisClientType): Promise<void> {
  for (const stream of flowPrReadableStreams) {
    try {
      await client.xGroupCreate(stream, flowPrConsumerGroup, '0', { MKSTREAM: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.includes('BUSYGROUP')) {
        throw error;
      }
    }
  }
}

export async function ensureFlowPrConsumerGroup(client: RedisClientType): Promise<void> {
  await ensureFlowPrConsumerGroups(client);
}

export async function emitRunStarted(
  client: RedisClientType,
  input: string | EmitRunStartedInput,
  attempt = 1,
): Promise<string> {
  const runInput = typeof input === 'string' ? { runId: input, attempt } : input;
  const createdAt = nowIso();
  const dedupeKey = `run.started:${runInput.runId}`;

  return client.xAdd(
    flowPrStreams.runs,
    '*',
    compactFields({
      runId: runInput.runId,
      eventType: 'run.started',
      attempt: runInput.attempt ?? attempt,
      dedupeKey,
      createdAt,
      repoUrl: runInput.repoUrl,
      previewUrl: runInput.previewUrl,
      flowGoal: runInput.flowGoal,
    }),
  );
}

export async function emitAgentStep(client: RedisClientType, input: EmitAgentStepInput): Promise<string> {
  const createdAt = nowIso();
  const dedupeKey = input.dedupeKey ?? `agent.step:${input.runId}:${input.phase}`;

  return client.xAdd(
    flowPrStreams.agentSteps,
    '*',
    compactFields({
      runId: input.runId,
      eventType: 'agent.step',
      phase: input.phase,
      attempt: input.attempt ?? 1,
      dedupeKey,
      createdAt,
      reason: input.reason,
      previousStreamId: input.previousStreamId,
    }),
  );
}

export async function emitBrowserResult(
  client: RedisClientType,
  input: { runId: string; providerRunId?: string; status: string; attempt?: number; dedupeKey?: string },
): Promise<string> {
  return client.xAdd(
    flowPrStreams.browserResults,
    '*',
    compactFields({
      runId: input.runId,
      eventType: 'browser.result',
      providerRunId: input.providerRunId,
      status: input.status,
      attempt: input.attempt ?? 1,
      dedupeKey: input.dedupeKey ?? `browser.result:${input.runId}:${input.providerRunId ?? input.status}`,
      createdAt: nowIso(),
    }),
  );
}

export async function emitPatchResult(
  client: RedisClientType,
  input: { runId: string; status: string; lockKey?: string; attempt?: number; dedupeKey?: string },
): Promise<string> {
  return client.xAdd(
    flowPrStreams.patches,
    '*',
    compactFields({
      runId: input.runId,
      eventType: 'patch.result',
      status: input.status,
      lockKey: input.lockKey,
      attempt: input.attempt ?? 1,
      dedupeKey: input.dedupeKey ?? `patch.result:${input.runId}:${input.status}`,
      createdAt: nowIso(),
    }),
  );
}

export async function emitVerificationResult(
  client: RedisClientType,
  input: { runId: string; status: string; provider?: string; attempt?: number; dedupeKey?: string },
): Promise<string> {
  return client.xAdd(
    flowPrStreams.verification,
    '*',
    compactFields({
      runId: input.runId,
      eventType: 'verification.result',
      provider: input.provider,
      status: input.status,
      attempt: input.attempt ?? 1,
      dedupeKey: input.dedupeKey ?? `verification.result:${input.runId}:${input.provider ?? input.status}`,
      createdAt: nowIso(),
    }),
  );
}

export async function readRunEvents(
  client: RedisClientType,
  consumerName: string,
  options: { count?: number; blockMs?: number } = {},
): Promise<FlowPrRedisEvent[]> {
  const response = await client.xReadGroup(
    flowPrConsumerGroup,
    consumerName,
    flowPrReadableStreams.map((stream) => ({ key: stream, id: '>' })),
    {
      COUNT: options.count ?? 1,
      BLOCK: options.blockMs ?? 5000,
    },
  );

  if (!response) return [];

  const streams = response as Array<{
    name: string;
    messages: Array<{ id: string; message: Record<string, string> }>;
  }>;

  return streams.flatMap((stream) =>
    stream.messages.map((entry) => parseMessage(stream.name, entry.id, normalizeMessage(entry.message))),
  );
}

export async function ackEvent(client: RedisClientType, event: FlowPrRedisEvent): Promise<number> {
  return client.xAck(event.stream, flowPrConsumerGroup, event.id);
}

export async function ackRunEvent(client: RedisClientType, eventId: string): Promise<number> {
  return client.xAck(flowPrStreams.runs, flowPrConsumerGroup, eventId);
}

export async function retryRedisEvent(
  client: RedisClientType,
  event: FlowPrRedisEvent,
  error: unknown,
): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  const fields = {
    ...event.payload,
    attempt: String(event.attempt + 1),
    previousStreamId: event.id,
    retryReason: redactRedisValue(message),
    createdAt: nowIso(),
  };

  return client.xAdd(event.stream, '*', compactFields(fields));
}

export async function moveToDeadLetter(
  client: RedisClientType,
  event: FlowPrRedisEvent,
  error: unknown,
): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);

  return client.xAdd(
    flowPrStreams.deadLetter,
    '*',
    compactFields({
      runId: event.runId,
      sourceStream: event.stream,
      eventId: event.id,
      eventType: event.eventType,
      phase: event.phase,
      attempt: event.attempt,
      dedupeKey: event.dedupeKey,
      error: redactRedisValue(message),
      createdAt: nowIso(),
    }),
  );
}

export async function claimStaleEvents(
  client: RedisClientType,
  consumerName: string,
  options: { minIdleMs?: number; count?: number } = {},
): Promise<FlowPrRedisEvent[]> {
  const minIdleMs = String(options.minIdleMs ?? 30000);
  const count = String(options.count ?? 10);
  const events: FlowPrRedisEvent[] = [];

  for (const stream of flowPrReadableStreams) {
    const response = await client.sendCommand([
      'XAUTOCLAIM',
      stream,
      flowPrConsumerGroup,
      consumerName,
      minIdleMs,
      '0-0',
      'COUNT',
      count,
    ]);
    const rawEntries = Array.isArray(response) && Array.isArray(response[1]) ? response[1] : [];

    for (const rawEntry of rawEntries) {
      if (!Array.isArray(rawEntry) || rawEntry.length < 2) continue;

      const id = String(rawEntry[0]);
      const fieldArray = Array.isArray(rawEntry[1]) ? rawEntry[1] : [];
      const message: Record<string, string> = {};

      for (let index = 0; index < fieldArray.length; index += 2) {
        message[String(fieldArray[index])] = String(fieldArray[index + 1] ?? '');
      }

      events.push(parseMessage(stream, id, message));
    }
  }

  return events;
}

export async function startIdempotentOperation(
  client: RedisClientType,
  dedupeKey: string,
  ttlSeconds = 86400,
): Promise<boolean> {
  const key = `flowpr:idempotency:${dedupeKey}`;
  const existing = await client.get(key);

  if (existing === 'completed') {
    return false;
  }

  if (existing) {
    return true;
  }

  const result = await client.sendCommand([
    'SET',
    key,
    'started',
    'NX',
    'EX',
    String(ttlSeconds),
  ]) as unknown;

  return result === 'OK';
}

export async function completeIdempotentOperation(
  client: RedisClientType,
  dedupeKey: string,
  ttlSeconds = 604800,
): Promise<void> {
  await client.set(`flowpr:idempotency:${dedupeKey}`, 'completed', { EX: ttlSeconds });
}

export async function failIdempotentOperation(client: RedisClientType, dedupeKey: string): Promise<void> {
  await client.del(`flowpr:idempotency:${dedupeKey}`);
}

export async function acquireRedisLock(
  client: RedisClientType,
  key: string,
  owner: string,
  ttlMs = 120000,
): Promise<boolean> {
  const result = await client.sendCommand(['SET', key, owner, 'NX', 'PX', String(ttlMs)]) as unknown;
  return result === 'OK';
}

export async function releaseRedisLock(
  client: RedisClientType,
  key: string,
  owner: string,
): Promise<boolean> {
  const result = await client.sendCommand([
    'EVAL',
    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
    '1',
    key,
    owner,
  ]) as unknown;

  return Number(result) === 1;
}

function stableMemoryInput(input: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((memo, key) => {
        memo[key] = input[key];
        return memo;
      }, {}),
  );
}

export function createBugSignatureHash(input: Record<string, unknown>): string {
  return createHash('sha256').update(stableMemoryInput(input)).digest('hex').slice(0, 24);
}

export async function lookupBugSignatureMemory(
  client: RedisClientType,
  hash: string,
): Promise<Record<string, string>> {
  return normalizeMessage(await client.hGetAll(redisMemoryKeys.bugSignature(hash)));
}

export async function storeBugSignatureMemory(
  client: RedisClientType,
  hash: string,
  value: Record<string, string | number | boolean | undefined>,
  ttlSeconds = 2592000,
): Promise<void> {
  await client.hSet(redisMemoryKeys.bugSignature(hash), compactFields(value));
  await client.expire(redisMemoryKeys.bugSignature(hash), ttlSeconds);
}

export async function lookupSuccessfulPatchMemory(
  client: RedisClientType,
  hash: string,
): Promise<Record<string, string>> {
  return normalizeMessage(await client.hGetAll(redisMemoryKeys.successfulPatch(hash)));
}

export async function storeSuccessfulPatchMemory(
  client: RedisClientType,
  hash: string,
  value: Record<string, string | number | boolean | undefined>,
  ttlSeconds = 2592000,
): Promise<void> {
  await client.hSet(redisMemoryKeys.successfulPatch(hash), compactFields(value));
  await client.expire(redisMemoryKeys.successfulPatch(hash), ttlSeconds);
}

function parseXRangeResponse(response: unknown): StreamEntry[] {
  if (!Array.isArray(response)) return [];

  return response.flatMap((entry): StreamEntry[] => {
    if (!Array.isArray(entry) || entry.length < 2) return [];

    const id = String(entry[0]);
    const fieldArray = Array.isArray(entry[1]) ? entry[1] : [];
    const message: Record<string, string> = {};

    for (let index = 0; index < fieldArray.length; index += 2) {
      message[String(fieldArray[index])] = String(fieldArray[index + 1] ?? '');
    }

    return [{ id, message }];
  });
}

export async function listRedisStreamEntries(
  client: RedisClientType,
  stream: string,
  count = 10,
): Promise<StreamEntry[]> {
  const response = await client.sendCommand(['XREVRANGE', stream, '+', '-', 'COUNT', String(count)]);
  return parseXRangeResponse(response);
}

export async function getRedisStreamStats(client: RedisClientType): Promise<RedisStreamStats[]> {
  const stats: RedisStreamStats[] = [];

  for (const stream of [...flowPrReadableStreams, flowPrStreams.deadLetter]) {
    const length = Number(await client.xLen(stream).catch(() => 0));
    const rawGroups: unknown = await client.sendCommand(['XINFO', 'GROUPS', stream]).catch(() => []);
    const groups = Array.isArray(rawGroups)
      ? rawGroups.map((group) => {
          if (!Array.isArray(group)) return {};

          const record: Record<string, unknown> = {};
          for (let index = 0; index < group.length; index += 2) {
            record[String(group[index])] = group[index + 1];
          }
          return record;
        })
      : [];

    stats.push({ stream, length, groups });
  }

  return stats;
}

export function redactRedisValue(value: string): string {
  return value
    .replace(/(api[_-]?key|token|authorization|password|secret)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [redacted]')
    .replace(/[A-Za-z0-9_]{20,}\.[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}/g, '[redacted.jwt]');
}
