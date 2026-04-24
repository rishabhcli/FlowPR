import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand, type CommandResult } from '@flowpr/tools';

export type VerificationStep = 'typecheck' | 'lint' | 'unit' | 'e2e';

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
    const content = require('node:fs').readFileSync(pkgPath, 'utf8') as string;
    const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
    return Boolean(parsed.scripts?.[name]);
  } catch {
    return false;
  }
}

async function recordStep(
  step: VerificationStep,
  argv: string[],
  dir: string,
  timeoutMs: number,
): Promise<VerificationOutcome> {
  const result = await runCommand(argv, { cwd: dir, timeoutMs });
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

function summarize(steps: VerificationOutcome[]): { overallStatus: VerificationStatus; summary: string } {
  const failures = steps.filter((outcome) => outcome.status === 'failed');
  const errors = steps.filter((outcome) => outcome.status === 'errored');
  const skips = steps.filter((outcome) => outcome.status === 'skipped');

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

  const passed = steps.filter((outcome) => outcome.status === 'passed');
  return {
    overallStatus: passed.length > 0 ? 'passed' : 'skipped',
    summary:
      passed.length > 0
        ? `Verification passed: ${passed.map((outcome) => outcome.step).join(', ')}${skips.length ? ` (skipped: ${skips.map((outcome) => outcome.step).join(', ')})` : ''}.`
        : `Verification skipped all steps: ${skips.map((outcome) => outcome.step).join(', ')}.`,
  };
}

export async function runLocalVerification(input: LocalVerificationInput): Promise<LocalVerificationResult> {
  const steps: VerificationOutcome[] = [];

  if (input.installDependencies) {
    try {
      const install = await runCommand(['pnpm', 'install', '--prefer-offline'], {
        cwd: input.dir,
        timeoutMs: 300_000,
      });

      steps.push({
        step: 'typecheck',
        status: install.exitCode === 0 ? 'skipped' : 'errored',
        command: install.command,
        durationMs: install.durationMs,
        exitCode: install.exitCode,
        stdoutExcerpt: excerpt(install.stdout),
        stderrExcerpt: excerpt(install.stderr),
      });
    } catch (error) {
      steps.push({
        step: 'typecheck',
        status: 'errored',
        command: 'pnpm install',
        durationMs: 0,
        exitCode: -1,
        stdoutExcerpt: '',
        stderrExcerpt: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (hasPackageScript(input.dir, 'typecheck')) {
    steps.push(await recordStep('typecheck', ['pnpm', 'typecheck'], input.dir, 300_000));
  } else {
    steps.push(skipStep('typecheck', 'pnpm typecheck', 'No typecheck script declared.'));
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
