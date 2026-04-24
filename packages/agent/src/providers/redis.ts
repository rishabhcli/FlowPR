import { createClient, type RedisClientType } from 'redis';

export function createFlowPrRedisClient(): RedisClientType {
  return createClient({
    url: process.env.REDIS_URL,
  });
}

export const flowPrStreams = {
  runs: 'flowpr:runs',
  artifacts: 'flowpr:artifacts',
  actions: 'flowpr:action-gates',
} as const;
