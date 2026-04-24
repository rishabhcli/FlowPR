import { createSign } from 'node:crypto';
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

interface GitHubInstallationResponse {
  id: number;
  message?: string;
}

interface GitHubInstallationTokenResponse {
  token: string;
  expires_at: string;
  message?: string;
}

export interface GitHubAuthContext {
  owner?: string;
  repo?: string;
  installationId?: string | number;
}

interface CachedInstallationToken {
  token: string;
  expiresAtMs: number;
}

const installationTokenCache = new Map<string, CachedInstallationToken>();
const tokenExpiryBufferMs = 60_000;

function githubBaseHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function configuredPersonalToken(): string | undefined {
  loadLocalEnv();
  const token = process.env.GITHUB_TOKEN?.trim();

  return token || undefined;
}

function configuredAppId(): string | undefined {
  loadLocalEnv();
  const appId = process.env.GITHUB_APP_ID?.trim();

  return appId || undefined;
}

function configuredPrivateKey(): string | undefined {
  loadLocalEnv();
  const encodedKey = process.env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim() || process.env.GITHUB_APP_PRIVATE_KEY_B64?.trim();

  if (encodedKey) {
    return Buffer.from(encodedKey.replace(/\s+/g, ''), 'base64').toString('utf8');
  }

  const rawKey = process.env.GITHUB_APP_PRIVATE_KEY?.trim();

  if (!rawKey) return undefined;

  return rawKey.replace(/\\n/g, '\n');
}

export function hasGitHubAppCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) loadLocalEnv();

  const hasPrivateKey = Boolean(
    env.GITHUB_APP_PRIVATE_KEY?.trim()
      || env.GITHUB_APP_PRIVATE_KEY_BASE64?.trim()
      || env.GITHUB_APP_PRIVATE_KEY_B64?.trim(),
  );

  return Boolean(env.GITHUB_APP_ID?.trim() && hasPrivateKey);
}

export function hasGitHubCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env === process.env) loadLocalEnv();

  return Boolean(env.GITHUB_TOKEN?.trim() || hasGitHubAppCredentials(env));
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createGitHubAppJwt(): string {
  const appId = configuredAppId();
  const privateKey = configuredPrivateKey();

  if (!appId || !privateKey) {
    throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required for GitHub App authentication');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: 'RS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  });
  const unsignedToken = `${header}.${payload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();

  return `${unsignedToken}.${signer.sign(privateKey).toString('base64url')}`;
}

async function getInstallationId(input: GitHubAuthContext): Promise<string> {
  const explicitInstallationId = String(input.installationId ?? process.env.GITHUB_APP_INSTALLATION_ID ?? '').trim();

  if (explicitInstallationId) return explicitInstallationId;

  if (!input.owner || !input.repo) {
    throw new Error('owner/repo or GITHUB_APP_INSTALLATION_ID is required to resolve a GitHub App installation');
  }

  const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/installation`, {
    headers: {
      ...githubBaseHeaders(),
      Authorization: `Bearer ${createGitHubAppJwt()}`,
    },
  });
  const body = await parseGitHubJson<GitHubInstallationResponse>(response, 'getGitHubAppInstallation');

  return String(body.id);
}

async function getInstallationAccessToken(input: GitHubAuthContext): Promise<string> {
  const installationId = await getInstallationId(input);
  const cached = installationTokenCache.get(installationId);

  if (cached && cached.expiresAtMs - tokenExpiryBufferMs > Date.now()) {
    return cached.token;
  }

  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      ...githubBaseHeaders(),
      Authorization: `Bearer ${createGitHubAppJwt()}`,
    },
  });
  const body = await parseGitHubJson<GitHubInstallationTokenResponse>(response, 'createGitHubInstallationAccessToken');
  const expiresAtMs = Date.parse(body.expires_at);

  installationTokenCache.set(installationId, {
    token: body.token,
    expiresAtMs: Number.isNaN(expiresAtMs) ? Date.now() + 55 * 60_000 : expiresAtMs,
  });

  return body.token;
}

export async function getGitHubAuthToken(input: GitHubAuthContext = {}): Promise<string | undefined> {
  const personalToken = configuredPersonalToken();

  if (!hasGitHubAppCredentials()) {
    return personalToken;
  }

  try {
    return await getInstallationAccessToken(input);
  } catch (error) {
    if (personalToken) {
      return personalToken;
    }

    throw error;
  }
}

async function githubHeaders(input: GitHubAuthContext = {}): Promise<Record<string, string>> {
  const headers = githubBaseHeaders();
  const token = await getGitHubAuthToken(input);

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function parseGitHubJson<T>(response: Response, operation: string): Promise<T> {
  const text = await response.text();
  let body: T & { message?: string; errors?: unknown };

  try {
    body = (text ? JSON.parse(text) : {}) as T & { message?: string; errors?: unknown };
  } catch {
    body = { message: text || `${operation} failed with ${response.status}` } as T & { message?: string; errors?: unknown };
  }

  if (!response.ok) {
    const message = body.message ?? `${operation} failed with ${response.status}`;
    throw new Error(`${operation}: ${message}`);
  }

  return body;
}

export async function getGitHubRepository(owner: string, repo: string): Promise<GitHubRepository> {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: await githubHeaders({ owner, repo }),
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
  const headers = await githubHeaders(input);

  if (!headers.Authorization) {
    throw new Error('GitHub credentials are required to create a pull request');
  }

  const response = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}/pulls`, {
    method: 'POST',
    headers: {
      ...headers,
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
  const response = await fetch(url, { headers: await githubHeaders(input) });
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
  const response = await fetch(url, { headers: await githubHeaders(input) });

  if (response.status === 404) return undefined;

  const body = await parseGitHubJson<GitHubRefResponse>(response, 'getBranchRef');
  return { ref: body.ref, sha: body.object.sha };
}
