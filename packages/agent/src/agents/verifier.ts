import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { runCommand, type CommandResult } from '@flowpr/tools/repo';

export type VerificationStep = 'install' | 'typecheck' | 'lint' | 'unit' | 'e2e';

export type VerificationStatus = 'passed' | 'failed' | 'skipped' | 'errored';

export interface VerificationOutcome {
  step: VerificationStep;
  status: VerificationStatus;
  command: string;
  durationMs: number;
  exitCode: number;
  stdoutExcerpt: string;
  stderrExcerpt: string;
}

export interface LocalVerificationInput {
  dir: string;
  installDependencies?: boolean;
  onlyTypecheck?: boolean;
  targetedTestPath?: string;
}

export interface LocalVerificationResult {
  dir: string;
  overallStatus: VerificationStatus;
  steps: VerificationOutcome[];
  summary: string;
}

function excerpt(value: string, length = 1200): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length)}\n…[truncated]`;
}

function hasPackageScript(dir: string, name: string): boolean {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return false;

  try {
    const content = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
    return Boolean(parsed.scripts?.[name]);
  } catch {
    return false;
  }
}

function hasInstalledDependencies(dir: string): boolean {
  return existsSync(join(dir, 'node_modules'));
}

function readPackageJson(dir: string): {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} | undefined {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) return undefined;

  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}

function packageUsesNext(dir: string): boolean {
  const parsed = readPackageJson(dir);
  return Boolean(parsed?.dependencies?.next ?? parsed?.devDependencies?.next);
}

async function recordStep(
  step: VerificationStep,
  argv: string[],
  dir: string,
  timeoutMs: number,
  env?: Record<string, string | undefined>,
): Promise<VerificationOutcome> {
  const result = await runCommand(argv, { cwd: dir, timeoutMs, env });
  return toOutcome(step, result);
}

function toOutcome(step: VerificationStep, result: CommandResult): VerificationOutcome {
  return {
    step,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    command: result.command,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    stdoutExcerpt: excerpt(result.stdout),
    stderrExcerpt: excerpt(result.stderr),
  };
}

function skipStep(step: VerificationStep, command: string, reason: string): VerificationOutcome {
  return {
    step,
    status: 'skipped',
    command,
    durationMs: 0,
    exitCode: 0,
    stdoutExcerpt: reason,
    stderrExcerpt: '',
  };
}

function failStep(step: VerificationStep, command: string, reason: string): VerificationOutcome {
  return {
    step,
    status: 'failed',
    command,
    durationMs: 0,
    exitCode: 1,
    stdoutExcerpt: '',
    stderrExcerpt: reason,
  };
}

function normalizeRelativePath(path: string): string | undefined {
  const normalized = path.trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) return undefined;
  if (normalized.split(/[\\/]+/).includes('..')) return undefined;
  return normalized.replace(/\\/g, '/');
}

function isInside(parent: string, child: string): boolean {
  const parentResolved = resolve(parent);
  const childResolved = resolve(child);
  return childResolved === parentResolved || childResolved.startsWith(`${parentResolved}${sep}`);
}

function findPackageDirForPath(repoDir: string, targetPath: string): string | undefined {
  const repoRoot = resolve(repoDir);
  let current = resolve(repoDir, dirname(targetPath));

  if (!isInside(repoRoot, current)) return undefined;

  while (isInside(repoRoot, current)) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }

    const next = dirname(current);
    if (next === current) break;
    current = next;
  }

  return existsSync(join(repoRoot, 'package.json')) ? repoRoot : undefined;
}

function testPortForDir(dir: string): string {
  let hash = 0;
  for (const char of resolve(dir)) {
    hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  }
  return String(4200 + (Math.abs(hash) % 1000));
}

function appendBounded(buffer: string, chunk: string, maxLength = 6000): string {
  const next = buffer + chunk;
  return next.length > maxLength ? next.slice(next.length - maxLength) : next;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function startNextDevServer(
  packageDir: string,
  port: string,
): Promise<{ url: string; logs: () => string; stop: () => Promise<void> } | { error: string }> {
  const url = `http://127.0.0.1:${port}`;
  let output = '';
  let exited = false;
  let exitSummary = '';
  const child = spawn('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', port], {
    cwd: packageDir,
    detached: true,
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    output = appendBounded(output, chunk);
  });
  child.stderr.on('data', (chunk: string) => {
    output = appendBounded(output, chunk);
  });
  child.on('exit', (code, signal) => {
    exited = true;
    exitSummary = `Next dev server exited early with code ${code ?? 'null'}${signal ? ` and signal ${signal}` : ''}.`;
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    if (exited) {
      return { error: `${exitSummary}\n${excerpt(output)}` };
    }

    try {
      const response = await fetch(url);
      if (response.status < 500) {
        return {
          url,
          logs: () => output,
          stop: async () => {
            if (child.pid) {
              try {
                process.kill(-child.pid, 'SIGTERM');
              } catch {
                child.kill('SIGTERM');
              }
            }

            await sleep(500);

            if (!exited && child.pid) {
              try {
                process.kill(-child.pid, 'SIGKILL');
              } catch {
                child.kill('SIGKILL');
              }
            }
          },
        };
      }
    } catch {
      // Keep polling until Next is ready or exits.
    }

    await sleep(750);
  }

  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }

  return { error: `Next dev server did not become ready at ${url}.\n${excerpt(output)}` };
}

async function recordTargetedE2E(
  repoDir: string,
  targetedTestPath: string,
): Promise<VerificationOutcome> {
  const testPath = normalizeRelativePath(targetedTestPath);
  const command = `pnpm exec playwright test --config playwright.config.ts ${testPath ?? targetedTestPath} --workers=1`;

  if (!testPath) {
    return failStep('e2e', command, `Invalid targeted test path: ${targetedTestPath}`);
  }

  const absoluteTestPath = resolve(repoDir, testPath);
  if (!isInside(repoDir, absoluteTestPath) || !existsSync(absoluteTestPath)) {
    return failStep('e2e', command, `Targeted regression test does not exist: ${testPath}`);
  }

  const packageDir = findPackageDirForPath(repoDir, testPath);
  if (!packageDir) {
    return failStep('e2e', command, `No package.json found for targeted regression test: ${testPath}`);
  }

  const relativeTestPath = relative(packageDir, absoluteTestPath).replace(/\\/g, '/');
  const port = testPortForDir(repoDir);

  if (packageUsesNext(packageDir)) {
    const server = await startNextDevServer(packageDir, port);

    if ('error' in server) {
      return failStep('e2e', `pnpm exec next dev --hostname 127.0.0.1 --port ${port}`, server.error);
    }

    try {
      return await recordStep(
        'e2e',
        ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.config.ts', relativeTestPath, '--workers=1'],
        packageDir,
        300_000,
        {
          DEMO_TARGET_URL: server.url,
          PLAYWRIGHT_RUN_LABEL: 'regression',
        },
      );
    } finally {
      await server.stop();
    }
  }

  return recordStep(
    'e2e',
    ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.config.ts', relativeTestPath, '--workers=1'],
    packageDir,
    300_000,
    {
      DEMO_TARGET_PORT: port,
      PLAYWRIGHT_RUN_LABEL: 'regression',
    },
  );
}

function summarize(steps: VerificationOutcome[]): { overallStatus: VerificationStatus; summary: string } {
  const failures = steps.filter((outcome) => outcome.status === 'failed');
  const errors = steps.filter((outcome) => outcome.status === 'errored');
  const checkSteps = steps.filter((outcome) => outcome.step !== 'install');
  const skips = checkSteps.filter((outcome) => outcome.status === 'skipped');

  if (errors.length > 0) {
    return {
      overallStatus: 'errored',
      summary: `${errors.length} verification step(s) errored; ${failures.length} failed.`,
    };
  }

  if (failures.length > 0) {
    return {
      overallStatus: 'failed',
      summary: `${failures.length} verification step(s) failed: ${failures.map((outcome) => outcome.step).join(', ')}.`,
    };
  }

  const passed = checkSteps.filter((outcome) => outcome.status === 'passed');
  const passedSetup = steps.some((outcome) => outcome.step === 'install' && outcome.status === 'passed');
  return {
    overallStatus: passed.length > 0 ? 'passed' : 'skipped',
    summary:
      passed.length > 0
        ? `Verification passed: ${passed.map((outcome) => outcome.step).join(', ')}${skips.length ? ` (skipped: ${skips.map((outcome) => outcome.step).join(', ')})` : ''}.`
        : `Verification skipped checks: ${skips.map((outcome) => outcome.step).join(', ')}.${passedSetup ? ' Dependency install passed.' : ''}`,
  };
}

export async function runLocalVerification(input: LocalVerificationInput): Promise<LocalVerificationResult> {
  const steps: VerificationOutcome[] = [];

  if (input.installDependencies) {
    if (hasInstalledDependencies(input.dir)) {
      steps.push(skipStep('install', 'pnpm install --frozen-lockfile --prefer-offline', 'Dependencies already installed.'));
    } else {
      try {
        const install = await runCommand(['pnpm', 'install', '--frozen-lockfile', '--prefer-offline'], {
          cwd: input.dir,
          timeoutMs: 300_000,
        });

        steps.push({
          step: 'install',
          status: install.exitCode === 0 ? 'passed' : 'errored',
          command: install.command,
          durationMs: install.durationMs,
          exitCode: install.exitCode,
          stdoutExcerpt: excerpt(install.stdout),
          stderrExcerpt: excerpt(install.stderr),
        });
      } catch (error) {
        steps.push({
          step: 'install',
          status: 'errored',
          command: 'pnpm install --frozen-lockfile --prefer-offline',
          durationMs: 0,
          exitCode: -1,
          stdoutExcerpt: '',
          stderrExcerpt: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const installOutcome = steps.find((step) => step.step === 'install');
    if (installOutcome?.status === 'errored' || installOutcome?.status === 'failed') {
      steps.push({
        step: 'typecheck',
        status: 'skipped',
        command: 'pnpm typecheck',
        durationMs: 0,
        exitCode: 0,
        stdoutExcerpt: 'Skipped because dependency installation failed.',
        stderrExcerpt: '',
      });
      return { dir: input.dir, steps, ...summarize(steps) };
    }
  }

  if (hasPackageScript(input.dir, 'typecheck')) {
    steps.push(await recordStep('typecheck', ['pnpm', 'typecheck'], input.dir, 300_000));
  } else {
    steps.push(skipStep('typecheck', 'pnpm typecheck', 'No typecheck script declared.'));
  }

  if (steps.some((step) => step.status === 'failed' || step.status === 'errored')) {
    if (input.targetedTestPath) {
      steps.push(skipStep('e2e', `playwright ${input.targetedTestPath}`, 'Skipped because an earlier verification step failed.'));
    }
    return { dir: input.dir, steps, ...summarize(steps) };
  }

  if (input.targetedTestPath) {
    steps.push(await recordTargetedE2E(input.dir, input.targetedTestPath));
    return { dir: input.dir, steps, ...summarize(steps) };
  }

  if (input.onlyTypecheck) {
    return { dir: input.dir, steps, ...summarize(steps) };
  }

  if (hasPackageScript(input.dir, 'lint')) {
    steps.push(await recordStep('lint', ['pnpm', 'lint'], input.dir, 300_000));
  } else {
    steps.push(skipStep('lint', 'pnpm lint', 'No lint script declared.'));
  }

  if (hasPackageScript(input.dir, 'test')) {
    steps.push(await recordStep('unit', ['pnpm', 'test', '--if-present'], input.dir, 300_000));
  } else {
    steps.push(skipStep('unit', 'pnpm test --if-present', 'No test script declared.'));
  }

  return { dir: input.dir, steps, ...summarize(steps) };
}
