import { parseGitHubRepoUrl } from '@flowpr/schemas';
import { getGitHubRepository, getBranchRef } from './github';

export type ValidationErrorCode =
  | 'repoUrl.invalid'
  | 'repoUrl.notFound'
  | 'previewUrl.invalid'
  | 'previewUrl.unreachable'
  | 'flowGoal.tooShort'
  | 'flowGoal.noSuccess'
  | 'baseBranch.missing'
  | 'baseBranch.notFound';

export interface ValidationIssue {
  code: ValidationErrorCode;
  field: 'repoUrl' | 'previewUrl' | 'flowGoal' | 'baseBranch';
  message: string;
  suggestion: string;
  severity: 'error' | 'warning';
}

export interface ValidationInput {
  repoUrl: string;
  previewUrl: string;
  flowGoal: string;
  baseBranch: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

const FLOW_GOAL_MIN_LENGTH = 25;
const PREVIEW_PROBE_TIMEOUT_MS = 5000;
const SUCCESS_KEYWORDS = [
  'success',
  'complete',
  'completes',
  'reach',
  'reaches',
  'land',
  'lands',
  'arrive',
  'dashboard',
  'confirm',
  'confirmation',
  'receipt',
  'thank you',
  'submitted',
  'redirect',
  'logged in',
  'welcome',
  'checkout complete',
];

async function probePreviewUrl(previewUrl: string): Promise<ValidationIssue | undefined> {
  try {
    const parsed = new URL(previewUrl);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        code: 'previewUrl.invalid',
        field: 'previewUrl',
        message: 'Preview URL must use http or https.',
        suggestion: 'Paste the full URL, e.g. https://preview.example.com/pricing.',
        severity: 'error',
      };
    }
  } catch {
    return {
      code: 'previewUrl.invalid',
      field: 'previewUrl',
      message: 'Preview URL is not a valid URL.',
      suggestion: 'Paste the full URL, e.g. https://preview.example.com/pricing.',
      severity: 'error',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREVIEW_PROBE_TIMEOUT_MS);

  try {
    let response = await fetch(previewUrl, { method: 'HEAD', signal: controller.signal }).catch(() => null);

    if (!response) {
      response = await fetch(previewUrl, { method: 'GET', signal: controller.signal }).catch(() => null);
    }

    if (!response) {
      return {
        code: 'previewUrl.unreachable',
        field: 'previewUrl',
        message: 'FlowPR could not reach the preview URL.',
        suggestion: 'Start the preview deployment, check it is public, or expose it via a tunnel (e.g. localhost.run, ngrok).',
        severity: 'warning',
      };
    }

    if (response.status >= 400) {
      return {
        code: 'previewUrl.unreachable',
        field: 'previewUrl',
        message: `Preview URL returned HTTP ${response.status}.`,
        suggestion: 'Confirm the route exists and is publicly reachable before starting the run.',
        severity: 'warning',
      };
    }
  } catch {
    return {
      code: 'previewUrl.unreachable',
      field: 'previewUrl',
      message: 'FlowPR could not reach the preview URL within 5 seconds.',
      suggestion: 'Start the preview deployment or expose it publicly before the run.',
      severity: 'warning',
    };
  } finally {
    clearTimeout(timer);
  }

  return undefined;
}

function checkFlowGoal(flowGoal: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const trimmed = flowGoal.trim();

  if (trimmed.length < FLOW_GOAL_MIN_LENGTH) {
    issues.push({
      code: 'flowGoal.tooShort',
      field: 'flowGoal',
      message: 'Flow goal is too short to run reliably.',
      suggestion: 'Describe the user journey in a full sentence, e.g. "Start on pricing, choose Pro, complete checkout, and reach the success page."',
      severity: 'error',
    });
    return issues;
  }

  const lower = trimmed.toLowerCase();
  const hasSuccessKeyword = SUCCESS_KEYWORDS.some((keyword) => lower.includes(keyword));

  if (!hasSuccessKeyword) {
    issues.push({
      code: 'flowGoal.noSuccess',
      field: 'flowGoal',
      message: 'Flow goal does not describe what success looks like.',
      suggestion: 'Add the expected end state, e.g. "…and reach the success page" or "…and see the dashboard."',
      severity: 'warning',
    });
  }

  return issues;
}

async function checkRepoAndBranch(repoUrl: string, baseBranch: string): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  let owner: string;
  let repo: string;

  try {
    const parsed = parseGitHubRepoUrl(repoUrl);
    owner = parsed.owner;
    repo = parsed.repo;
  } catch (error) {
    issues.push({
      code: 'repoUrl.invalid',
      field: 'repoUrl',
      message: error instanceof Error ? error.message : 'Repository URL is invalid.',
      suggestion: 'Paste the full GitHub URL (https://github.com/owner/repo) or the owner/repo shorthand.',
      severity: 'error',
    });
    return issues;
  }

  if (!baseBranch.trim()) {
    issues.push({
      code: 'baseBranch.missing',
      field: 'baseBranch',
      message: 'Base branch is required.',
      suggestion: 'Most repositories use main or master. Paste the branch FlowPR should open its PR against.',
      severity: 'error',
    });
  }

  if (!process.env.GITHUB_TOKEN) {
    return issues;
  }

  try {
    await getGitHubRepository(owner, repo);
  } catch (error) {
    issues.push({
      code: 'repoUrl.notFound',
      field: 'repoUrl',
      message: `GitHub repository ${owner}/${repo} is not reachable with the configured token.`,
      suggestion: 'Confirm the repository exists and that GITHUB_TOKEN has contents:read and pull_requests:write on it.',
      severity: 'warning',
    });
    return issues;
  }

  if (baseBranch.trim()) {
    try {
      const ref = await getBranchRef({ owner, repo, branch: baseBranch.trim() });
      if (!ref) {
        issues.push({
          code: 'baseBranch.notFound',
          field: 'baseBranch',
          message: `Branch "${baseBranch}" does not exist on ${owner}/${repo}.`,
          suggestion: 'Use the repository’s default branch (often main) or a branch you can see on GitHub.',
          severity: 'warning',
        });
      }
    } catch {
      // Silent fail: the worker will surface a concrete error later if this really matters.
    }
  }

  return issues;
}

export async function validateRunStartInput(input: ValidationInput): Promise<ValidationResult> {
  const checks = await Promise.all([
    probePreviewUrl(input.previewUrl),
    checkRepoAndBranch(input.repoUrl, input.baseBranch),
  ]);

  const issues: ValidationIssue[] = [];
  const previewIssue = checks[0];
  if (previewIssue) issues.push(previewIssue);
  issues.push(...checks[1]);
  issues.push(...checkFlowGoal(input.flowGoal));

  const ok = issues.every((issue) => issue.severity !== 'error');

  return { ok, issues };
}
