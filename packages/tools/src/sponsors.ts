import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { getGitHubRepository, hasGitHubCredentials } from './github';
import { getInsForgeClient, listRecentRuns } from './insforge';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  ensureFlowPrConsumerGroups,
  flowPrStreams,
  getRedisStreamStats,
} from './redis';
import { createSensoClient } from './senso';
import { listTinyFishRuns } from './tinyfish';
import { loadLocalEnv } from './env';
import { getWunderGraphConfig } from './wundergraph';

export type SponsorStatusState =
  | 'live'
  | 'configured'
  | 'not_configured'
  | 'partial'
  | 'failed'
  | 'local_artifact';

export interface SponsorStatus {
  sponsor: string;
  state: SponsorStatusState;
  summary: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

const SPONSOR_STATUS_CACHE_TTL_MS = 30_000;
let sponsorStatusCache: {
  key: string;
  expiresAt: number;
  value: SponsorStatus[];
} | undefined;
let sponsorStatusInFlight: {
  key: string;
  promise: Promise<SponsorStatus[]>;
} | undefined;

function findRepoRoot(startDir = process.cwd()): string {
  let dir = startDir;

  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }

    const parent = dirname(dir);

    if (parent === dir) return startDir;
    dir = parent;
  }
}

async function checkSponsor(
  sponsor: string,
  fn: () => Promise<Omit<SponsorStatus, 'sponsor' | 'checkedAt'>>,
): Promise<SponsorStatus> {
  const checkedAt = new Date().toISOString();

  try {
    const status = await fn();

    return { sponsor, checkedAt, ...status };
  } catch (error) {
    return {
      sponsor,
      checkedAt,
      state: 'failed',
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

async function probeSponsorStatuses(): Promise<SponsorStatus[]> {
  loadLocalEnv();

  return Promise.all([
    checkSponsor('tinyfish', async () => {
      if (!process.env.TINYFISH_API_KEY) {
        return { state: 'not_configured', summary: 'TINYFISH_API_KEY is missing.' };
      }

      const runs = await listTinyFishRuns(1);

      return {
        state: 'live',
        summary: 'TinyFish runs API responded.',
        metadata: {
          total: runs.pagination.total,
          latestRunId: runs.data[0]?.run_id,
          latestStatus: runs.data[0]?.status,
        },
      };
    }),
    checkSponsor('redis', async () => {
      if (!process.env.REDIS_URL) {
        return { state: 'not_configured', summary: 'REDIS_URL is missing.' };
      }

      const redis = createFlowPrRedisClient();

      try {
        await connectFlowPrRedisClient(redis);
        await ensureFlowPrConsumerGroups(redis);
        const pong = await redis.ping();
        const stats = await getRedisStreamStats(redis);
        const memoryKeyCount = await redis.keys('flowpr:memory:*').then((keys) => keys.length);

        return {
          state: 'live',
          summary: 'Redis Streams, consumer groups, locks, and memory namespace are reachable.',
          metadata: {
            response: pong,
            streams: Object.values(flowPrStreams),
            streamLengths: Object.fromEntries(stats.map((stat) => [stat.stream, stat.length])),
            consumerGroups: Object.fromEntries(stats.map((stat) => [stat.stream, stat.groups.length])),
            memoryKeyCount,
          },
        };
      } finally {
        if (redis.isOpen) {
          await redis.quit();
        }
      }
    }),
    checkSponsor('insforge', async () => {
      const hasUrl = Boolean(
        process.env.INSFORGE_API_URL ||
          process.env.INSFORGE_URL ||
          process.env.NEXT_PUBLIC_INSFORGE_URL,
      );
      const hasKey = Boolean(
        process.env.INSFORGE_ANON_KEY ||
          process.env.INSFORGE_API_KEY ||
          process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
      );

      if (!hasUrl && !hasKey) {
        return {
          state: 'not_configured',
          summary: 'INSFORGE_API_URL and an InsForge key are missing.',
        };
      }

      if (!hasUrl || !hasKey) {
        return {
          state: 'partial',
          summary: 'InsForge configuration is incomplete; both the API URL and key are required.',
        };
      }

      await getInsForgeClient();
      const runs = await listRecentRuns(1);

      return {
        state: 'live',
        summary: 'InsForge database responded.',
        metadata: {
          recentRuns: runs.length,
          latestRunId: runs[0]?.id,
        },
      };
    }),
    checkSponsor('github', async () => {
      const repository = await getGitHubRepository('rishabhcli', 'FlowPR');
      const authenticated = hasGitHubCredentials();

      return {
        state: authenticated ? 'live' : 'partial',
        summary: authenticated
          ? 'GitHub repository API responded with authenticated credentials.'
          : 'GitHub public repository API responded; authenticated credentials are missing.',
        metadata: {
          ...(repository as unknown as Record<string, unknown>),
          authenticated,
        },
      };
    }),
    checkSponsor('senso', async () => {
      if (!process.env.SENSO_API_KEY) {
        return { state: 'not_configured', summary: 'SENSO_API_KEY is missing.' };
      }

      const result = await createSensoClient().search({
        query: 'FlowPR frontend QA primary action mobile checkout',
        maxResults: 1,
      });

      return {
        state: 'live',
        summary: 'Senso search API responded.',
        metadata: {
          resultType: Array.isArray(result) ? 'array' : typeof result,
        },
      };
    }),
    checkSponsor('wundergraph', async () => {
      const { apiKey, apiUrl, healthUrl, mcpUrl } = getWunderGraphConfig();

      if (!apiUrl && !mcpUrl) {
        return {
          state: 'not_configured',
          summary: 'Add a WunderGraph control-plane or MCP endpoint to enable checks.',
        };
      }

      const endpoint = mcpUrl ?? healthUrl ?? apiUrl!;
      let response = await fetch(endpoint, {
        method: 'HEAD',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      });

      if (response.status === 405) {
        response = await fetch(endpoint, {
          method: 'GET',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
        });
      }

      if (!response.ok) {
        throw new Error(`WunderGraph endpoint returned ${response.status}`);
      }

      return {
        state: 'live',
        summary: mcpUrl
          ? 'WunderGraph MCP endpoint responded.'
          : 'WunderGraph control-plane health endpoint responded.',
        metadata: {
          endpointType: mcpUrl ? 'mcp-gateway' : 'control-plane',
          authenticated: Boolean(apiKey),
          status: response.status,
        },
      };
    }),
    checkSponsor('guildai', async () => {
      if (process.env.GUILD_AI_API_KEY) {
        return {
          state: 'configured',
          summary: 'Guild.ai API key is configured; remote control-plane calls were not verified by this runtime.',
          metadata: {
            workspace: process.env.GUILD_AI_WORKSPACE,
            agentId: process.env.GUILD_AI_AGENT_ID,
            remoteVerified: false,
          },
        };
      }

      if (process.env.GUILD_GITHUB_APP_INSTALLED === 'true') {
        return {
          state: 'local_artifact',
          summary: 'Guild GitHub app is marked installed; the local action-gate adapter is active and no remote call was verified.',
          metadata: {
            workspace: process.env.GUILD_AI_WORKSPACE,
            agentId: process.env.GUILD_AI_AGENT_ID,
            remoteVerified: false,
          },
        };
      }

      return {
        state: 'not_configured',
        summary: 'GUILD_AI_API_KEY or GUILD_GITHUB_APP_INSTALLED=true is required.',
      };
    }),
    checkSponsor('shipables', async () => {
      const repoRoot = findRepoRoot();
      const skillPath = join(repoRoot, 'skills', 'flowpr-autonomous-frontend-qa', 'shipables.json');

      if (!existsSync(skillPath)) {
        return {
          state: 'failed',
          summary: 'Shipables manifest is missing.',
        };
      }

      return {
        state: process.env.SHIPABLES_API_KEY ? 'configured' : 'local_artifact',
        summary: process.env.SHIPABLES_API_KEY
          ? 'Shipables API key and local skill manifest are present; remote delivery was not verified by this runtime.'
          : 'Local Shipables skill manifest is present; API key is not configured.',
        metadata: {
          manifest: relative(repoRoot, skillPath),
          ...(process.env.SHIPABLES_API_KEY ? { remoteVerified: false } : {}),
        },
      };
    }),
    checkSponsor('akash', async () => {
      if (!process.env.AKASH_API_KEY) {
        return { state: 'not_configured', summary: 'AKASH_API_KEY is missing.' };
      }

      const response = await fetch('https://console-api.akash.network/v1/deployments?skip=0&limit=1', {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.AKASH_API_KEY,
        },
      });

      if (!response.ok) {
        throw new Error(`Akash Console API returned ${response.status}`);
      }

      const result = (await response.json()) as Record<string, unknown>;

      return {
        state: 'live',
        summary: 'Akash Console deployments API responded.',
        metadata: {
          network: process.env.AKASH_NETWORK ?? 'mainnet',
          accountConfigured: Boolean(process.env.AKASH_ACCOUNT_ADDRESS),
          responseKeys: Object.keys(result),
        },
      };
    }),
  ]);
}

function sponsorStatusCacheKey(): string {
  return JSON.stringify({
    dataMode: process.env.FLOWPR_DATA_MODE ?? '',
    localStoreDir: process.env.FLOWPR_LOCAL_STORE_DIR ?? '',
    tinyfish: Boolean(process.env.TINYFISH_API_KEY),
    redisUrl: process.env.REDIS_URL ?? '',
    insforgeUrl: process.env.INSFORGE_API_URL
      ?? process.env.INSFORGE_URL
      ?? process.env.NEXT_PUBLIC_INSFORGE_URL
      ?? '',
    insforgeKey: Boolean(
      process.env.INSFORGE_ANON_KEY
      || process.env.INSFORGE_API_KEY
      || process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
    ),
    github: hasGitHubCredentials(),
    senso: Boolean(process.env.SENSO_API_KEY),
    wundergraph: {
      apiUrl: process.env.WUNDERGRAPH_API_URL ?? '',
      mcpUrl: process.env.WUNDERGRAPH_MCP_URL ?? '',
      apiKey: Boolean(process.env.WUNDERGRAPH_API_KEY),
    },
    guild: Boolean(
      process.env.GUILD_AI_API_KEY
      || process.env.GUILD_GITHUB_APP_INSTALLED === 'true',
    ),
    shipables: Boolean(process.env.SHIPABLES_API_KEY),
    akash: Boolean(process.env.AKASH_API_KEY),
  });
}

export async function checkSponsorStatuses(): Promise<SponsorStatus[]> {
  loadLocalEnv();
  const key = sponsorStatusCacheKey();
  const now = Date.now();

  if (sponsorStatusCache && sponsorStatusCache.key === key && sponsorStatusCache.expiresAt > now) {
    return sponsorStatusCache.value;
  }

  if (sponsorStatusInFlight?.key === key) {
    return sponsorStatusInFlight.promise;
  }

  const promise = probeSponsorStatuses();
  sponsorStatusInFlight = { key, promise };
  try {
    const value = await promise;
    sponsorStatusCache = {
      key,
      expiresAt: Date.now() + SPONSOR_STATUS_CACHE_TTL_MS,
      value,
    };
    return value;
  } finally {
    if (sponsorStatusInFlight?.promise === promise) {
      sponsorStatusInFlight = undefined;
    }
  }
}
