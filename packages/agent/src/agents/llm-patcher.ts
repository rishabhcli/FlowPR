import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  cloneRepo,
  commitAll,
  createBranch,
  diffStatAgainstBase,
  listChangedFiles,
  readWorkspaceFile,
  runCommand,
  writeWorkspaceFile,
  type CloneRepoResult,
} from '@flowpr/tools/repo';
import { loadLocalEnv } from '@flowpr/tools/env';
import type { TriageOutput } from './visual-triage';
import type { GenerateDemoPatchResult, PatchPlan, PatchPlanFile } from './patcher';

const PATCH_AUTHOR_NAME = 'FlowPR Autonomous Agent';
const PATCH_AUTHOR_EMAIL = 'agent@flowpr.dev';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL_ID = 'claude-sonnet-4-6';
const MAX_FILE_BYTES = 24_000;
const MAX_FILES_IN_CONTEXT = 8;
const MAX_TREE_ENTRIES = 220;

export class LlmPatcherUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmPatcherUnavailableError';
  }
}

export class LlmPatchProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmPatchProposalError';
  }
}

export interface GenerateLlmPatchInput {
  runId: string;
  repoUrl: string;
  baseBranch: string;
  triage: TriageOutput;
  flowGoal: string;
  authToken?: string;
}

interface ProposedPatchEdit {
  find: string;
  replace: string;
}

interface ProposedPatchFile {
  path: string;
  action: 'replace' | 'patch' | 'create';
  summary: string;
  content?: string;
  edits?: ProposedPatchEdit[];
}

interface ProposedPatch {
  branch_name: string;
  commit_message: string;
  explanation: string;
  files: ProposedPatchFile[];
  test_path?: string;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | { type: string; [key: string]: unknown };

interface AnthropicMessageResponse {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}

const proposePatchTool = {
  name: 'propose_patch',
  description: 'Propose a minimal, surgical patch that fixes the diagnosed frontend bug.',
  input_schema: {
    type: 'object' as const,
    properties: {
      branch_name: {
        type: 'string',
        description: 'Branch name for the patch. MUST start with "flowpr/" and contain only lowercase letters, digits, "/", "-".',
      },
      commit_message: {
        type: 'string',
        description: 'Conventional commit message describing the fix in one or two short paragraphs.',
      },
      explanation: {
        type: 'string',
        description: 'One-paragraph plain-language explanation of the root cause and what the patch does.',
      },
      test_path: {
        type: 'string',
        description: 'Suggested path for a Playwright regression test relative to the repo root. May be omitted if the patch already includes a test file in `files`.',
      },
      files: {
        type: 'array',
        description: 'Files to change. Each file uses action="patch" with surgical edits, action="replace" to overwrite an existing file, or action="create" for new files.',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path relative to the repo root. Must not be absolute or escape the repo.' },
            action: { type: 'string', enum: ['patch', 'replace', 'create'] },
            summary: { type: 'string', description: 'One-line description of why this file changes.' },
            content: {
              type: 'string',
              description: 'Required for action="create" or action="replace". Full file contents.',
            },
            edits: {
              type: 'array',
              description: 'Required for action="patch". Find/replace pairs applied in order. Each `find` must be a unique substring of the current file.',
              items: {
                type: 'object',
                properties: {
                  find: { type: 'string' },
                  replace: { type: 'string' },
                },
                required: ['find', 'replace'],
              },
            },
          },
          required: ['path', 'action', 'summary'],
        },
      },
    },
    required: ['branch_name', 'commit_message', 'explanation', 'files'],
  },
};

const SYSTEM_PROMPT = `You are FlowPR's autonomous frontend-QA patcher. A separate browser-QA agent has already exercised the app, captured failure evidence, and produced a triage diagnosis. Your job is to write the minimal source-code patch that fixes the diagnosed bug.

Strict rules:
- Output exactly one tool call to \`propose_patch\`. Do not narrate.
- Touch only files needed to fix the diagnosed bug. No drive-by refactors, no unrelated style changes.
- Prefer action="patch" with surgical find/replace edits. Use action="replace" only when full-file rewrite is the cleaner option, and action="create" for new files.
- Each \`find\` string MUST appear exactly once in the file's current contents. Include enough surrounding context to make it unique.
- Add or update one Playwright regression test that fails when the bug recurs. The test goes in a \`tests/\` directory near the affected app (e.g. \`apps/<app>/tests/<flow>-regression.spec.ts\`). If the repo already has a test of the same name, update it via action="patch" instead of recreating it.
- Branch name MUST start with "flowpr/".
- Do not introduce new dependencies. Do not modify package.json, lockfiles, CI configs, or infrastructure unless the bug is specifically in those files.
- Keep the patch reversible: a single \`git revert\` should undo it cleanly.
`;

function readApiKey(): string | undefined {
  loadLocalEnv();
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

export function isLlmPatcherAvailable(): boolean {
  return Boolean(readApiKey());
}

function truncateFileContent(content: string): { text: string; truncated: boolean } {
  const buffer = Buffer.from(content, 'utf8');
  if (buffer.byteLength <= MAX_FILE_BYTES) return { text: content, truncated: false };
  return {
    text: `${buffer.subarray(0, MAX_FILE_BYTES).toString('utf8')}\n…[truncated for context window]`,
    truncated: true,
  };
}

async function gatherRepoTree(dir: string): Promise<string> {
  const result = await runCommand(['git', 'ls-files'], { cwd: dir, timeoutMs: 30000 });
  if (result.exitCode !== 0) return '';
  const files = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_TREE_ENTRIES);

  return files.join('\n');
}

async function gatherCandidateFiles(dir: string, paths: string[]): Promise<Array<{ path: string; content: string; truncated: boolean }>> {
  const seen = new Set<string>();
  const results: Array<{ path: string; content: string; truncated: boolean }> = [];

  for (const rawPath of paths) {
    if (results.length >= MAX_FILES_IN_CONTEXT) break;
    const path = rawPath.replace(/^\/+/, '').trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);

    const content = await readWorkspaceFile(dir, path);
    if (content === undefined) continue;

    const { text, truncated } = truncateFileContent(content);
    results.push({ path, content: text, truncated });
  }

  return results;
}

function renderUserPrompt(input: {
  triage: TriageOutput;
  flowGoal: string;
  repoTree: string;
  files: Array<{ path: string; content: string; truncated: boolean }>;
}): string {
  const filesBlock = input.files.length === 0
    ? '_No likely files were available to read. Use the repo tree to locate the most relevant source._'
    : input.files
        .map((file) => `### ${file.path}${file.truncated ? ' (truncated)' : ''}\n\`\`\`\n${file.content}\n\`\`\``)
        .join('\n\n');

  const acceptance = input.triage.acceptanceCriteria.length === 0
    ? '_No explicit acceptance criteria were retrieved._'
    : input.triage.acceptanceCriteria.map((entry, index) => `${index + 1}. ${entry.text}`).join('\n');

  return `## Diagnosed bug

Flow under test: ${input.flowGoal}
Bug type: ${input.triage.bugType}
Severity: ${input.triage.severity}
Confidence: ${input.triage.confidence} (${Math.round(input.triage.confidenceScore * 100)}%)
Summary: ${input.triage.summary}

Suspected cause: ${input.triage.suspectedCause || '_unspecified_'}
Hypothesis: ${input.triage.hypothesis}
Failed step: ${input.triage.evidence.failedStep || '_unspecified_'}
Top DOM finding: ${input.triage.evidence.topDomFinding || '_none_'}

## Acceptance criteria
${acceptance}

## Repo tree (truncated)
\`\`\`
${input.repoTree || '_unavailable_'}
\`\`\`

## Candidate files
${filesBlock}

Now propose a minimal, surgical patch via the \`propose_patch\` tool. Add or update one Playwright regression test that fails when the bug recurs.`;
}

function ensureBranchName(name: string, runId: string): string {
  const slug = name.trim().replace(/^\/+|\/+$/g, '');
  if (!slug.startsWith('flowpr/')) {
    return `flowpr/${runId.slice(0, 8)}-llm-patch`;
  }
  if (!/^[a-z0-9/_\-.]+$/i.test(slug)) {
    return `flowpr/${runId.slice(0, 8)}-llm-patch`;
  }
  return slug;
}

function safeRelativePath(path: string): string {
  const normalised = path.replace(/^\/+/, '');
  if (normalised.includes('..')) {
    throw new LlmPatchProposalError(`Refusing to apply patch with parent-directory path: ${path}`);
  }
  return normalised;
}

async function applyPatchEdit(dir: string, file: ProposedPatchFile): Promise<void> {
  const path = safeRelativePath(file.path);
  const target = join(dir, path);

  if (file.action === 'create') {
    if (existsSync(target)) {
      throw new LlmPatchProposalError(`File already exists for action=create: ${path}`);
    }
    if (typeof file.content !== 'string') {
      throw new LlmPatchProposalError(`action=create requires content: ${path}`);
    }
    await writeWorkspaceFile({ dir, path, content: file.content });
    return;
  }

  if (file.action === 'replace') {
    if (typeof file.content !== 'string') {
      throw new LlmPatchProposalError(`action=replace requires content: ${path}`);
    }
    await writeWorkspaceFile({ dir, path, content: file.content });
    return;
  }

  if (file.action === 'patch') {
    if (!Array.isArray(file.edits) || file.edits.length === 0) {
      throw new LlmPatchProposalError(`action=patch requires non-empty edits: ${path}`);
    }
    const original = await readWorkspaceFile(dir, path);
    if (original === undefined) {
      throw new LlmPatchProposalError(`Cannot patch missing file: ${path}`);
    }
    let next = original;
    for (const [index, edit] of file.edits.entries()) {
      if (typeof edit.find !== 'string' || typeof edit.replace !== 'string') {
        throw new LlmPatchProposalError(`Invalid edit #${index + 1} for ${path}: find/replace must be strings.`);
      }
      const matchIndex = next.indexOf(edit.find);
      if (matchIndex === -1) {
        throw new LlmPatchProposalError(`Edit #${index + 1} for ${path} did not match the file contents.`);
      }
      const before = next.slice(0, matchIndex);
      const after = next.slice(matchIndex + edit.find.length);
      next = `${before}${edit.replace}${after}`;
    }
    if (next === original) {
      throw new LlmPatchProposalError(`Patch produced no changes for ${path}`);
    }
    await writeWorkspaceFile({ dir, path, content: next });
    return;
  }

  throw new LlmPatchProposalError(`Unsupported action: ${(file as { action: string }).action}`);
}

async function callAnthropic(input: {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<ProposedPatch> {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_ID,
      max_tokens: 4096,
      system: [
        {
          type: 'text',
          text: input.systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [proposePatchTool],
      tool_choice: { type: 'tool', name: 'propose_patch' },
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: input.userPrompt }],
        },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new LlmPatchProposalError(`Anthropic API ${response.status}: ${text.slice(0, 500)}`);
  }

  const body = (await response.json()) as AnthropicMessageResponse;
  const toolUse = body.content.find((block): block is AnthropicToolUseBlock => block.type === 'tool_use' && block.name === 'propose_patch');

  if (!toolUse) {
    throw new LlmPatchProposalError('Anthropic response did not include a propose_patch tool call.');
  }

  return toolUse.input as ProposedPatch;
}

function buildPatchPlanFiles(files: ProposedPatchFile[]): PatchPlanFile[] {
  return files.map((file) => ({
    path: safeRelativePath(file.path),
    action: file.action === 'create' ? 'create' : file.action === 'replace' ? 'replace' : 'patch',
    summary: file.summary,
  }));
}

function pickTestPath(proposed: ProposedPatch): string {
  if (proposed.test_path) return safeRelativePath(proposed.test_path);
  const testFile = proposed.files.find((file) => /\.spec\.[jt]sx?$/.test(file.path) || /\.test\.[jt]sx?$/.test(file.path));
  if (testFile) return safeRelativePath(testFile.path);
  return 'apps/demo-target/tests/regression.spec.ts';
}

export async function generateLlmPatch(input: GenerateLlmPatchInput): Promise<GenerateDemoPatchResult> {
  const apiKey = readApiKey();
  if (!apiKey) {
    throw new LlmPatcherUnavailableError('ANTHROPIC_API_KEY is not configured.');
  }

  const workspace: CloneRepoResult = await cloneRepo({
    runId: input.runId,
    repoUrl: input.repoUrl,
    baseBranch: input.baseBranch,
    depth: 2,
    authToken: input.authToken,
  });

  const repoTree = await gatherRepoTree(workspace.dir);
  const candidateFiles = await gatherCandidateFiles(workspace.dir, input.triage.likelyFiles);

  const proposed = await callAnthropic({
    apiKey,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: renderUserPrompt({
      triage: input.triage,
      flowGoal: input.flowGoal,
      repoTree,
      files: candidateFiles,
    }),
  });

  if (!Array.isArray(proposed.files) || proposed.files.length === 0) {
    throw new LlmPatchProposalError('LLM returned no files to change.');
  }

  const branchName = ensureBranchName(proposed.branch_name, input.runId);
  await createBranch({ dir: workspace.dir, branchName, baseBranch: input.baseBranch });

  for (const file of proposed.files) {
    await applyPatchEdit(workspace.dir, file);
  }

  const plan: PatchPlan = {
    branchName,
    commitMessage: proposed.commit_message.trim() || `fix: FlowPR repair for ${input.triage.bugType}`,
    explanation: proposed.explanation.trim() || input.triage.hypothesis,
    testPath: pickTestPath(proposed),
    files: buildPatchPlanFiles(proposed.files),
  };

  const { commitSha } = await commitAll({
    dir: workspace.dir,
    message: plan.commitMessage,
    authorName: PATCH_AUTHOR_NAME,
    authorEmail: PATCH_AUTHOR_EMAIL,
  });

  const [filesChanged, diffStat] = await Promise.all([
    listChangedFiles(workspace.dir, input.baseBranch),
    diffStatAgainstBase(workspace.dir, input.baseBranch),
  ]);

  let regressionTestContent = '';
  if (plan.testPath) {
    const testFile = join(workspace.dir, plan.testPath);
    if (existsSync(testFile)) {
      regressionTestContent = await fs.readFile(testFile, 'utf8');
    }
  }

  return {
    workspace,
    plan,
    commitSha,
    filesChanged,
    diffStat,
    preFixStyles: '',
    postFixStyles: '',
    regressionTestContent,
    raw: {
      branchName,
      commitSha,
      diffStat,
      filesChanged,
      provider: 'anthropic',
      model: MODEL_ID,
      explanation: plan.explanation,
      testPath: plan.testPath,
    },
  };
}
