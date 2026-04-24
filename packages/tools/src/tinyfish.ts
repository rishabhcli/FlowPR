import type { TinyFish } from '@tiny-fish/sdk';
import { loadLocalEnv } from './env';

export async function createTinyFishClient(): Promise<TinyFish> {
  loadLocalEnv();
  const { TinyFish } = await import('@tiny-fish/sdk');
  const configuredBaseUrl = process.env.TINYFISH_API_BASE_URL?.trim();
  const baseURL =
    configuredBaseUrl && configuredBaseUrl !== 'https://api.tinyfish.ai' ? configuredBaseUrl : undefined;

  return new TinyFish({
    apiKey: process.env.TINYFISH_API_KEY,
    baseURL,
  });
}

export async function listTinyFishRuns(limit = 1) {
  const client = await createTinyFishClient();

  return client.runs.list({ limit, sort_direction: 'desc' });
}
