import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

export interface RunCommandOptions {
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  input?: string;
}

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export class CommandError extends Error {
  constructor(public readonly result: CommandResult) {
    super(`Command failed (${result.exitCode}): ${result.command}\n${result.stderr.slice(0, 1000)}`);
  }
}

const MAX_OUTPUT_BYTES = 64 * 1024;

function truncate(value: string): string {
  return value.length > MAX_OUTPUT_BYTES ? `${value.slice(0, MAX_OUTPUT_BYTES)}\n…[truncated]` : value;
}

export function runCommand(
  argv: string[],
  options: RunCommandOptions,
): Promise<CommandResult> {
  if (argv.length === 0) {
    throw new Error('runCommand requires at least one argument');
  }

  return new Promise<CommandResult>((resolveCommand, reject) => {
    const start = Date.now();
    const [command, ...args] = argv;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : undefined;

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - start;

      resolveCommand({
        command: argv.join(' '),
        cwd: options.cwd,
        exitCode: exitCode ?? -1,
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        durationMs,
      });
    });

    if (options.input) {
      child.stdin?.end(options.input);
    } else {
      child.stdin?.end();
    }
  });
}

export async function runGit(args: string[], options: RunCommandOptions): Promise<CommandResult> {
  const result = await runCommand(['git', ...args], options);

  if (result.exitCode !== 0) {
    throw new CommandError(result);
  }

  return result;
}

export interface CloneRepoInput {
  repoUrl: string;
  baseBranch: string;
  runId: string;
  workspaceRoot?: string;
  depth?: number;
  authToken?: string;
}

export interface CloneRepoResult {
  runId: string;
  dir: string;
  headSha: string;
  remoteUrl: string;
}

export function sanitizeRemoteUrl(repoUrl: string): string {
  if (repoUrl.startsWith('git@')) return repoUrl;

  try {
    const parsed = new URL(repoUrl);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return repoUrl;
  }
}

function buildCloneAuthEnv(repoUrl: string, authToken?: string): Record<string, string> | undefined {
  if (!authToken) return undefined;

  try {
    if (new URL(repoUrl).protocol !== 'https:') return undefined;
  } catch {
    return undefined;
  }

  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${authToken}`,
    GIT_TERMINAL_PROMPT: '0',
  };
}

export async function ensureWorkspaceRoot(root?: string): Promise<string> {
  const base = root ?? join(process.cwd(), '.flowpr-workspaces');

  if (!existsSync(base)) {
    mkdirSync(base, { recursive: true });
  }

  return resolve(base);
}

export async function cloneRepo(input: CloneRepoInput): Promise<CloneRepoResult> {
  const workspaceRoot = await ensureWorkspaceRoot(input.workspaceRoot);
  const dir = join(workspaceRoot, input.runId);
  const remoteUrl = sanitizeRemoteUrl(input.repoUrl);

  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }

  const args = ['clone', '--branch', input.baseBranch, '--single-branch'];

  if (input.depth && input.depth > 0) {
    args.push('--depth', String(input.depth));
  }

  args.push(remoteUrl, dir);
  await runGit(args, {
    cwd: workspaceRoot,
    timeoutMs: 180000,
    env: buildCloneAuthEnv(remoteUrl, input.authToken),
  });
  await runGit(['remote', 'set-url', 'origin', remoteUrl], { cwd: dir, timeoutMs: 15000 });
  const rev = await runGit(['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 15000 });

  return {
    runId: input.runId,
    dir,
    headSha: rev.stdout.trim(),
    remoteUrl,
  };
}

export interface CreateBranchInput {
  dir: string;
  branchName: string;
  baseBranch: string;
}

export async function createBranch(input: CreateBranchInput): Promise<CommandResult> {
  return runGit(['checkout', '-B', input.branchName, input.baseBranch], {
    cwd: input.dir,
    timeoutMs: 30000,
  });
}

export interface CommitAllInput {
  dir: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
}

export async function commitAll(input: CommitAllInput): Promise<{ commitSha: string }> {
  await runGit(['add', '--all'], { cwd: input.dir, timeoutMs: 30000 });
  const statusResult = await runGit(['status', '--porcelain'], { cwd: input.dir, timeoutMs: 15000 });

  if (statusResult.stdout.trim().length === 0) {
    throw new Error('commitAll called on a working tree with no staged changes.');
  }

  const env: Record<string, string> = {};

  if (input.authorName) env.GIT_AUTHOR_NAME = input.authorName;
  if (input.authorEmail) env.GIT_AUTHOR_EMAIL = input.authorEmail;
  if (input.authorName) env.GIT_COMMITTER_NAME = input.authorName;
  if (input.authorEmail) env.GIT_COMMITTER_EMAIL = input.authorEmail;

  await runGit(['commit', '-m', input.message], {
    cwd: input.dir,
    env,
    timeoutMs: 30000,
  });

  const rev = await runGit(['rev-parse', 'HEAD'], { cwd: input.dir, timeoutMs: 15000 });
  return { commitSha: rev.stdout.trim() };
}

export interface PushBranchInput {
  dir: string;
  branchName: string;
  remote?: string;
}

export async function pushBranch(input: PushBranchInput): Promise<CommandResult> {
  return runGit(['push', '-u', input.remote ?? 'origin', input.branchName], {
    cwd: input.dir,
    timeoutMs: 120000,
  });
}

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export async function diffStatAgainstBase(dir: string, baseBranch: string): Promise<DiffStat> {
  const result = await runGit(['diff', '--numstat', `origin/${baseBranch}...HEAD`], {
    cwd: dir,
    timeoutMs: 30000,
  }).catch(async () => runGit(['diff', '--numstat', `${baseBranch}...HEAD`], { cwd: dir, timeoutMs: 30000 }));
  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  for (const line of result.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);

    if (parts.length < 3) continue;

    const added = Number.parseInt(parts[0], 10);
    const removed = Number.parseInt(parts[1], 10);

    if (!Number.isNaN(added)) insertions += added;
    if (!Number.isNaN(removed)) deletions += removed;

    filesChanged += 1;
  }

  return { filesChanged, insertions, deletions };
}

export async function listChangedFiles(dir: string, baseBranch: string): Promise<string[]> {
  const result = await runGit(['diff', '--name-only', `origin/${baseBranch}...HEAD`], {
    cwd: dir,
    timeoutMs: 30000,
  }).catch(async () => runGit(['diff', '--name-only', `${baseBranch}...HEAD`], { cwd: dir, timeoutMs: 30000 }));

  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export interface WriteWorkspaceFileInput {
  dir: string;
  path: string;
  content: string;
}

function workspaceTarget(dir: string, path: string): string {
  const root = resolve(dir);
  const target = resolve(root, path);

  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`Workspace path escapes the checkout: ${path}`);
  }

  return target;
}

function isInsideWorkspace(root: string, target: string): boolean {
  return target === root || target.startsWith(`${root}${sep}`);
}

async function assertWorkspaceTarget(dir: string, target: string): Promise<void> {
  const root = await fs.realpath(dir);
  let resolvedTarget: string;

  try {
    resolvedTarget = await fs.realpath(target);
  } catch {
    resolvedTarget = await fs.realpath(dirname(target));
  }

  if (!isInsideWorkspace(root, resolvedTarget)) {
    throw new Error(`Workspace path escapes the checkout: ${target}`);
  }
}

export async function writeWorkspaceFile(input: WriteWorkspaceFileInput): Promise<void> {
  const target = workspaceTarget(input.dir, input.path);
  await fs.mkdir(dirname(target), { recursive: true });
  await assertWorkspaceTarget(input.dir, target);
  await fs.writeFile(target, input.content, 'utf8');
}

export async function readWorkspaceFile(dir: string, path: string): Promise<string | undefined> {
  const target = workspaceTarget(dir, path);

  if (!existsSync(target)) return undefined;

  await assertWorkspaceTarget(dir, target);
  return fs.readFile(target, 'utf8');
}

export async function removeWorkspace(dir: string): Promise<void> {
  if (existsSync(dir)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
}
