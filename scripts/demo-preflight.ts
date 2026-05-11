import { spawnSync } from 'node:child_process';
import { loadLocalEnv } from '@flowpr/tools/env';

interface PreflightOptions {
  appUrl: string;
  runId?: string;
}

const acceptedHealthStates = new Set(['configured', 'live', 'local_artifact']);
const coreHealthKeys = ['redis', 'tinyfish', 'insforge', 'github', 'guildai', 'shipables'];

function parseArgs(argv: string[]): PreflightOptions {
  const options: PreflightOptions = {
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  };

  for (const arg of argv) {
    if (arg.startsWith('--app-url=')) {
      options.appUrl = arg.slice('--app-url='.length);
    } else if (!arg.startsWith('-') && !options.runId) {
      options.runId = arg;
    }
  }

  return options;
}

function runStep(label: string, command: string, args: string[]): void {
  console.log(`\n[preflight] ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function healthUrl(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, '')}/api/health`;
}

async function checkDashboardHealth(appUrl: string): Promise<void> {
  console.log('\n[preflight] Dashboard health');
  const response = await fetch(healthUrl(appUrl), { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`Dashboard health failed with HTTP ${response.status}`);
  }

  const body = await response.json() as {
    envReadiness?: Record<string, string>;
    generatedAt?: string;
  };
  const envReadiness = body.envReadiness ?? {};
  const blockers = coreHealthKeys
    .map((key) => ({ key, state: envReadiness[key] ?? 'missing' }))
    .filter(({ state }) => !acceptedHealthStates.has(state));

  if (blockers.length > 0) {
    throw new Error(`Dashboard health blockers: ${blockers.map(({ key, state }) => `${key}=${state}`).join(', ')}`);
  }

  console.log(`Health ok: ${coreHealthKeys.map((key) => `${key}=${envReadiness[key] ?? 'missing'}`).join(', ')}`);
  if (body.generatedAt) {
    console.log(`Health generated at: ${body.generatedAt}`);
  }
}

async function main() {
  loadLocalEnv();
  const options = parseArgs(process.argv.slice(2));

  runStep('Redis smoke', 'pnpm', ['redis:smoke']);
  runStep('Evidence integrity smoke', 'pnpm', ['evidence:integrity']);
  runStep('PR evidence packet smoke', 'pnpm', ['pr:packet-smoke']);
  runStep('Recovery visibility smoke', 'pnpm', ['recovery:smoke']);
  runStep('Skill dry run', 'pnpm', ['skill:dry-run']);
  await checkDashboardHealth(options.appUrl);

  const replayArgs = ['run:replay'];
  if (options.runId) {
    replayArgs.push(options.runId);
  }
  replayArgs.push('--fail-on-not-ready');
  runStep('Replay readiness gate', 'pnpm', replayArgs);

  console.log('\nFlowPR demo preflight ok.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
