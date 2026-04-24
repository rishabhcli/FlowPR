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

function githubHeaders(): HeadersInit {
  loadLocalEnv();
  const headers: HeadersInit = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  return headers;
}

export async function getGitHubRepository(owner: string, repo: string): Promise<GitHubRepository> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: githubHeaders(),
  });
  const body = (await response.json()) as GitHubRepositoryResponse;

  if (!response.ok) {
    throw new Error(body.message ?? `GitHub repository lookup failed with ${response.status}`);
  }

  return {
    id: body.id,
    fullName: body.full_name,
    htmlUrl: body.html_url,
    defaultBranch: body.default_branch,
    private: body.private,
    pushedAt: body.pushed_at,
  };
}
