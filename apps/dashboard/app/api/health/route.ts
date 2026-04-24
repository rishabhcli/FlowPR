import { NextResponse } from 'next/server';
import { checkSponsorStatuses, flowPrStreams, hasGitHubCredentials, loadLocalEnv } from '@flowpr/tools';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

function envFlag(name: string): 'configured' | 'missing' {
  return process.env[name] ? 'configured' : 'missing';
}

function insforgeState(): 'configured' | 'missing' | 'partial' {
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

  if (hasUrl && hasKey) return 'configured';
  if (hasUrl || hasKey) return 'partial';
  return 'missing';
}

export async function GET() {
  loadLocalEnv();
  const repoRoot = findRepoRoot();

  const envReadiness = {
    redis: envFlag('REDIS_URL'),
    tinyfish: envFlag('TINYFISH_API_KEY'),
    insforge: insforgeState(),
    github: hasGitHubCredentials() ? 'configured' : 'missing',
    senso: envFlag('SENSO_API_KEY'),
    wundergraph: process.env.WUNDERGRAPH_API_URL || process.env.WUNDERGRAPH_MCP_URL ? 'configured' : 'missing',
    guildai:
      process.env.GUILD_AI_API_KEY
        ? 'configured'
        : process.env.GUILD_GITHUB_APP_INSTALLED === 'true'
          ? 'local_artifact'
          : 'missing',
    akash: envFlag('AKASH_API_KEY'),
    shipables: existsSync(join(repoRoot, 'skills', 'flowpr-autonomous-frontend-qa', 'shipables.json')) ? 'configured' : 'missing',
    chainguard: existsSync(join(repoRoot, 'Dockerfile')) ? 'configured' : 'missing',
  };

  let sponsorStatuses: Awaited<ReturnType<typeof checkSponsorStatuses>> = [];
  let sponsorError: string | undefined;

  try {
    sponsorStatuses = await checkSponsorStatuses();
  } catch (error) {
    sponsorError = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json({
    envReadiness,
    sponsorStatuses,
    sponsorError,
    streams: Object.values(flowPrStreams),
    generatedAt: new Date().toISOString(),
  });
}
