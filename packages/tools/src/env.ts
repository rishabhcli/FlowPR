import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const requiredEnv = [
  'TINYFISH_API_KEY',
  'REDIS_URL',
  'INSFORGE_API_URL',
  'INSFORGE_ANON_KEY',
] as const;
const githubAuthRequirement = 'GITHUB_TOKEN or GITHUB_APP_ID/GITHUB_APP_PRIVATE_KEY' as const;

const recommendedEnv = ['GUILD_AI_WORKSPACE', 'SENSO_API_KEY', 'AKASH_API_KEY'] as const;
const guildConnectivityCheck = 'GUILD_AI_API_KEY or GUILD_GITHUB_APP_INSTALLED' as const;

export type RequiredEnvName = (typeof requiredEnv)[number] | typeof githubAuthRequirement;
export type RecommendedEnvName = (typeof recommendedEnv)[number] | typeof guildConnectivityCheck;

export function loadLocalEnv(startDir = process.cwd()): string | undefined {
  let dir = startDir;

  while (true) {
    const envPath = join(dir, '.env');
    if (existsSync(envPath)) {
      const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed
          .slice(separatorIndex + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '');

        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }

      return envPath;
    }

    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function getMissingRequiredEnv(env: NodeJS.ProcessEnv = process.env): RequiredEnvName[] {
  const missing: RequiredEnvName[] = requiredEnv.filter((key) => {
    if (key === 'INSFORGE_API_URL') {
      return !env.INSFORGE_API_URL && !env.INSFORGE_URL && !env.NEXT_PUBLIC_INSFORGE_URL;
    }

    if (key === 'INSFORGE_ANON_KEY') {
      return !env.INSFORGE_ANON_KEY && !env.INSFORGE_API_KEY && !env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
    }

    return !env[key];
  });

  const hasGitHubToken = Boolean(env.GITHUB_TOKEN);
  const hasGitHubApp = Boolean(
    env.GITHUB_APP_ID && (env.GITHUB_APP_PRIVATE_KEY || env.GITHUB_APP_PRIVATE_KEY_BASE64 || env.GITHUB_APP_PRIVATE_KEY_B64),
  );

  if (!hasGitHubToken && !hasGitHubApp) {
    missing.push(githubAuthRequirement);
  }

  return missing;
}

export function getMissingRecommendedEnv(
  env: NodeJS.ProcessEnv = process.env,
): RecommendedEnvName[] {
  const missing: RecommendedEnvName[] = recommendedEnv.filter((key) => !env[key]);

  if (!env.GUILD_AI_API_KEY && env.GUILD_GITHUB_APP_INSTALLED !== 'true') {
    missing.push(guildConnectivityCheck);
  }

  return missing;
}
