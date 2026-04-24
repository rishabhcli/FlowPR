import { createClient, type RedisClientType } from 'redis';
import { loadLocalEnv } from './env';

export const flowPrStreams = {
  runs: 'flowpr:runs',
  artifacts: 'flowpr:artifacts',
  actions: 'flowpr:action-gates',
  deadLetter: 'flowpr:dead_letter',
} as const;

export const flowPrConsumerGroup = 'flowpr-workers';

export type RunEventType = 'run.started';

export interface RunStreamEvent {
  stream: string;
  id: string;
  runId: string;
  eventType: RunEventType;
  attempt: number;
  dedupeKey: string;
  createdAt: string;
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

export async function ensureFlowPrConsumerGroup(client: RedisClientType): Promise<void> {
  try {
    await client.xGroupCreate(flowPrStreams.runs, flowPrConsumerGroup, '0', { MKSTREAM: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes('BUSYGROUP')) {
      throw error;
    }
  }
}

export async function emitRunStarted(
  client: RedisClientType,
  runId: string,
  attempt = 1,
): Promise<string> {
  const createdAt = new Date().toISOString();
  const dedupeKey = `run:${runId}:started`;

  return client.xAdd(flowPrStreams.runs, '*', {
    runId,
    eventType: 'run.started',
    attempt: String(attempt),
    dedupeKey,
    createdAt,
  });
}

function parseMessage(stream: string, id: string, message: Record<string, string>): RunStreamEvent {
  if (message.eventType !== 'run.started') {
    throw new Error(`Unsupported run event type: ${message.eventType}`);
  }

  return {
    stream,
    id,
    runId: message.runId,
    eventType: message.eventType,
    attempt: Number.parseInt(message.attempt || '1', 10),
    dedupeKey: message.dedupeKey,
    createdAt: message.createdAt,
  };
}

export async function readRunEvents(
  client: RedisClientType,
  consumerName: string,
  options: { count?: number; blockMs?: number } = {},
): Promise<RunStreamEvent[]> {
  const response = await client.xReadGroup(
    flowPrConsumerGroup,
    consumerName,
    { key: flowPrStreams.runs, id: '>' },
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
    stream.messages.map((entry) => parseMessage(stream.name, entry.id, entry.message)),
  );
}

export async function ackRunEvent(client: RedisClientType, eventId: string): Promise<number> {
  return client.xAck(flowPrStreams.runs, flowPrConsumerGroup, eventId);
}

export async function moveToDeadLetter(
  client: RedisClientType,
  event: RunStreamEvent,
  error: unknown,
): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);

  return client.xAdd(flowPrStreams.deadLetter, '*', {
    runId: event.runId,
    eventId: event.id,
    eventType: event.eventType,
    attempt: String(event.attempt),
    dedupeKey: event.dedupeKey,
    error: message,
    createdAt: new Date().toISOString(),
  });
}
