import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getGitHubRepository } from './github';
import { getInsForgeClient, listRecentRuns } from './insforge';
import { connectFlowPrRedisClient, createFlowPrRedisClient, flowPrStreams } from './redis';
import { createSensoClient } from './senso';
import { listTinyFishRuns } from './tinyfish';
import { loadLocalEnv } from './env';

export type SponsorStatusState = 'live' | 'not_configured' | 'failed' | 'local_artifact';

export interface SponsorStatus {
  sponsor: string;
  state: SponsorStatusState;
  summary: string;
  checkedAt: string;
  metadata?: Record<string, unknown>;
}

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

export async function checkSponsorStatuses(): Promise<SponsorStatus[]> {
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
        const pong = await redis.ping();

        return {
          state: 'live',
          summary: 'Redis responded to PING.',
          metadata: {
            response: pong,
            streams: Object.values(flowPrStreams),
          },
        };
      } finally {
        if (redis.isOpen) {
          await redis.quit();
        }
      }
    }),
    checkSponsor('insforge', async () => {
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

      return {
        state: 'live',
        summary: 'GitHub repository API responded.',
        metadata: repository as unknown as Record<string, unknown>,
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
      if (!process.env.WUNDERGRAPH_API_URL && !process.env.WUNDERGRAPH_MCP_URL) {
        return {
          state: 'not_configured',
          summary: 'WUNDERGRAPH_API_URL or WUNDERGRAPH_MCP_URL is missing.',
        };
      }

      const url = process.env.WUNDERGRAPH_API_URL ?? process.env.WUNDERGRAPH_MCP_URL;
      const response = await fetch(url!, {
        method: 'HEAD',
        headers: process.env.WUNDERGRAPH_API_KEY
          ? { Authorization: `Bearer ${process.env.WUNDERGRAPH_API_KEY}` }
          : undefined,
      });

      if (!response.ok) {
        throw new Error(`WunderGraph endpoint returned ${response.status}`);
      }

      return {
        state: 'live',
        summary: 'WunderGraph endpoint responded.',
        metadata: {
          status: response.status,
        },
      };
    }),
    checkSponsor('guildai', async () => {
      if (process.env.GUILD_AI_API_KEY) {
        return {
          state: 'live',
          summary: 'Guild.ai API key is configured for live control-plane calls.',
          metadata: {
            workspace: process.env.GUILD_AI_WORKSPACE,
            agentId: process.env.GUILD_AI_AGENT_ID,
          },
        };
      }

      if (process.env.GUILD_GITHUB_APP_INSTALLED === 'true') {
        return {
          state: 'local_artifact',
          summary: 'Guild GitHub app is marked installed; live API key is not configured.',
          metadata: {
            workspace: process.env.GUILD_AI_WORKSPACE,
            agentId: process.env.GUILD_AI_AGENT_ID,
          },
        };
      }

      return {
        state: 'not_configured',
        summary: 'GUILD_AI_API_KEY or GUILD_GITHUB_APP_INSTALLED=true is required.',
      };
    }),
    checkSponsor('shipables', async () => {
      const skillPath = join(findRepoRoot(), 'skills', 'flowpr-autonomous-frontend-qa', 'shipables.json');

      if (!existsSync(skillPath)) {
        return {
          state: 'failed',
          summary: 'Shipables manifest is missing.',
        };
      }

      return {
        state: process.env.SHIPABLES_API_KEY ? 'live' : 'local_artifact',
        summary: process.env.SHIPABLES_API_KEY
          ? 'Shipables API key and local skill manifest are present.'
          : 'Local Shipables skill manifest is present; API key is not configured.',
        metadata: {
          manifest: skillPath,
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
