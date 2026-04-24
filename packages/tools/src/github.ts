import { loadLocalEnv } from './env';

export interface GitHubRepository {
  id: number;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
  private: boolean;
  pushedAt?: string;
}

interface GitHubRepositoryResponse {
  id: number;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  pushed_at?: string;
  message?: string;
}

interface GitHubPullRequestResponse {
  id: number;
  number: number;
  html_url: string;
  state: string;
  draft: boolean;
  head: { ref: string; sha: string };
  base: { ref: string };
  title: string;
  body?: string;
  message?: string;
  errors?: Array<{ message?: string; resource?: string; field?: string }>;
}

interface GitHubRefResponse {
  ref: string;
  object: { sha: string; type: string; url: string };
  message?: string;
}

function githubHeaders(): HeadersInit {
  loadLocalEnv();
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

async function parseGitHubJson<T>(response: Response, operation: string): Promise<T> {
  const text = await response.text();
  const body = (text ? JSON.parse(text) : {}) as T & { message?: string; errors?: unknown };

  if (!response.ok) {
    const message = body.message ?? `${operation} failed with ${response.status}`;
    throw new Error(`${operation}: ${message}`);
  }

  return body;
}

export async function getGitHubRepository(owner: string, repo: string): Promise<GitHubRepository> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: githubHeaders(),
  });
  const body = await parseGitHubJson<GitHubRepositoryResponse>(response, 'getGitHubRepository');

  return {
    id: body.id,
    fullName: body.full_name,
    htmlUrl: body.html_url,
    defaultBranch: body.default_branch,
    private: body.private,
    pushedAt: body.pushed_at,
  };
}

export interface CreatePullRequestInput {
  owner: string;
  repo: string;
  title: string;
  body: string;
  head: string;
  base: string;
  draft?: boolean;
  maintainerCanModify?: boolean;
}

export interface PullRequestSummary {
  number: number;
  url: string;
  branch: string;
  base: string;
  state: string;
  draft: boolean;
  title: string;
}

export async function createGitHubPullRequest(input: CreatePullRequestInput): Promise<PullRequestSummary> {
  loadLocalEnv();

  if (!process.env.GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN is required to create a pull request');
  }

  const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls`, {
    method: 'POST',
    headers: {
      ...githubHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: input.title,
      body: input.body,
      head: input.head,
      base: input.base,
      draft: input.draft ?? false,
      maintainer_can_modify: input.maintainerCanModify ?? true,
    }),
  });

  const body = await parseGitHubJson<GitHubPullRequestResponse>(response, 'createGitHubPullRequest');

  return {
    number: body.number,
    url: body.html_url,
    branch: body.head?.ref ?? input.head,
    base: body.base?.ref ?? input.base,
    state: body.state ?? 'open',
    draft: Boolean(body.draft),
    title: body.title,
  };
}

export interface FindOpenPullRequestInput {
  owner: string;
  repo: string;
  head: string;
  base: string;
}

export async function findOpenPullRequestForHead(
  input: FindOpenPullRequestInput,
): Promise<PullRequestSummary | undefined> {
  const headParam = `${input.owner}:${input.head}`;
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/pulls?state=open&head=${encodeURIComponent(headParam)}&base=${encodeURIComponent(input.base)}`;
  const response = await fetch(url, { headers: githubHeaders() });
  const body = await parseGitHubJson<GitHubPullRequestResponse[]>(response, 'findOpenPullRequestForHead');
  const match = Array.isArray(body) ? body[0] : undefined;

  if (!match) return undefined;

  return {
    number: match.number,
    url: match.html_url,
    branch: match.head?.ref ?? input.head,
    base: match.base?.ref ?? input.base,
    state: match.state ?? 'open',
    draft: Boolean(match.draft),
    title: match.title,
  };
}

export interface GitHubBranchRef {
  ref: string;
  sha: string;
}

export async function getBranchRef(input: { owner: string; repo: string; branch: string }): Promise<GitHubBranchRef | undefined> {
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/git/ref/heads/${encodeURIComponent(input.branch)}`;
  const response = await fetch(url, { headers: githubHeaders() });

  if (response.status === 404) return undefined;

  const body = await parseGitHubJson<GitHubRefResponse>(response, 'getBranchRef');
  return { ref: body.ref, sha: body.object.sha };
}
