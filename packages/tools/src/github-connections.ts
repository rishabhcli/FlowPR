import { createClient } from '@insforge/sdk';
import { getInsForgeClient, getInsForgeConfig } from './insforge';
import { hasGitHubAppCredentials, hasGitHubCredentials } from './github';
import { loadLocalEnv } from './env';

type JsonRecord = Record<string, unknown>;

interface GitHubConnectionRow {
  id: string;
  insforge_user_id: string;
  provider: 'github';
  github_login?: string | null;
  github_user_id?: string | null;
  github_avatar_url?: string | null;
  connection_state: string;
  installation_id?: string | null;
  installation_account_login?: string | null;
  repository_selection?: string | null;
  permissions?: JsonRecord | null;
  metadata?: JsonRecord | null;
  last_synced_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubOAuthStart {
  url: string;
  codeVerifier: string;
}

export interface GitHubConnection {
  id: string;
  userId: string;
  githubLogin?: string;
  githubUserId?: string;
  githubAvatarUrl?: string;
  state: string;
  installationId?: string;
  installationAccountLogin?: string;
  repositorySelection?: string;
  updatedAt: string;
}

export interface GitHubConnectionStatus {
  authProvider: 'ready' | 'setup_needed';
  repositoryAccess: 'ready' | 'setup_needed';
  connectionStore: 'ready' | 'setup_needed';
  connectionCount?: number;
  latestConnection?: Pick<
    GitHubConnection,
    'state' | 'updatedAt' | 'githubLogin' | 'githubAvatarUrl'
  >;
  startUrl: string;
  summaries: {
    authProvider: string;
    repositoryAccess: string;
    connectionStore: string;
  };
}

function createInsForgeServerClient() {
  return createClient({
    ...getInsForgeConfig(),
    isServerMode: true,
  });
}

function rowToConnection(row: GitHubConnectionRow): GitHubConnection {
  return {
    id: row.id,
    userId: row.insforge_user_id,
    githubLogin: row.github_login ?? undefined,
    githubUserId: row.github_user_id ?? undefined,
    githubAvatarUrl: row.github_avatar_url ?? undefined,
    state: row.connection_state,
    installationId: row.installation_id ?? undefined,
    installationAccountLogin: row.installation_account_login ?? undefined,
    repositorySelection: row.repository_selection ?? undefined,
    updatedAt: row.updated_at,
  };
}

function stringFromProfile(profile: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = profile[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }

  return undefined;
}

function getOAuthUserProfile(user: unknown): JsonRecord {
  if (!user || typeof user !== 'object') return {};

  const profile = (user as { profile?: unknown }).profile;
  return profile && typeof profile === 'object' ? (profile as JsonRecord) : {};
}

function getOAuthUserId(user: unknown): string | undefined {
  if (!user || typeof user !== 'object') return undefined;
  const id = (user as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

export async function startGitHubOAuth(redirectTo: string): Promise<GitHubOAuthStart> {
  const client = createInsForgeServerClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'github',
    redirectTo,
    skipBrowserRedirect: true,
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data.url || !data.codeVerifier) {
    throw new Error('InsForge did not return a GitHub OAuth URL.');
  }

  return {
    url: data.url,
    codeVerifier: data.codeVerifier,
  };
}

export async function completeGitHubOAuth(input: {
  code: string;
  codeVerifier: string;
}): Promise<GitHubConnection> {
  const authClient = createInsForgeServerClient();
  const { data, error } = await authClient.auth.exchangeOAuthCode(
    input.code,
    input.codeVerifier,
  );

  if (error) {
    throw new Error(error.message);
  }

  const userId = getOAuthUserId(data?.user);

  if (!userId) {
    throw new Error('InsForge completed OAuth but did not return a user id.');
  }

  const profile = getOAuthUserProfile(data?.user);
  const now = new Date().toISOString();
  const row = {
    insforge_user_id: userId,
    provider: 'github',
    github_login: stringFromProfile(profile, [
      'login',
      'user_name',
      'username',
      'preferred_username',
      'nickname',
      'name',
    ]),
    github_user_id: stringFromProfile(profile, ['sub', 'id', 'provider_id']),
    github_avatar_url: stringFromProfile(profile, [
      'avatar_url',
      'picture',
      'image',
    ]),
    connection_state: 'signed_in',
    metadata: {
      profileKeys: Object.keys(profile).sort(),
      providers: Array.isArray((data?.user as { providers?: unknown })?.providers)
        ? (data?.user as { providers?: string[] }).providers
        : undefined,
      accessTokenReceived: Boolean(data?.accessToken),
      refreshTokenReceived: Boolean((data as { refreshToken?: unknown } | null)?.refreshToken),
      completedAt: now,
    },
    last_synced_at: now,
  };

  const client = await getInsForgeClient();
  const existing = await client.database
    .from('github_connections')
    .select('id')
    .eq('insforge_user_id', userId)
    .eq('provider', 'github')
    .maybeSingle();

  if (existing.error) {
    throw new Error(existing.error.message);
  }

  const write = existing.data
    ? await client.database
        .from('github_connections')
        .update(row)
        .eq('id', (existing.data as { id: string }).id)
        .select('*')
    : await client.database.from('github_connections').insert([row]).select('*');

  if (write.error) {
    throw new Error(write.error.message);
  }

  const [connection] = Array.isArray(write.data)
    ? (write.data as GitHubConnectionRow[])
    : [];

  if (!connection) {
    throw new Error('GitHub connection was not saved.');
  }

  return rowToConnection(connection);
}

export async function getGitHubConnectionForUser(
  userId: string,
): Promise<GitHubConnection | null> {
  loadLocalEnv();
  if (!userId.trim()) return null;
  const client = await getInsForgeClient();
  const { data, error } = await client.database
    .from('github_connections')
    .select('*')
    .eq('insforge_user_id', userId)
    .eq('provider', 'github')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return rowToConnection(data as GitHubConnectionRow);
}

export async function getGitHubConnectionStatus(): Promise<GitHubConnectionStatus> {
  loadLocalEnv();
  const client = await getInsForgeClient();
  let latestConnection: GitHubConnectionStatus['latestConnection'];
  let connectionCount: number | undefined;
  let connectionStore: GitHubConnectionStatus['connectionStore'] = 'ready';

  const { data, error, count } = await client.database
    .from('github_connections')
    .select(
      'id, connection_state, updated_at, github_login, github_avatar_url',
      { count: 'exact' },
    )
    .order('updated_at', { ascending: false })
    .limit(1);

  if (error) {
    connectionStore = 'setup_needed';
  } else {
    connectionCount = typeof count === 'number' ? count : undefined;
    const [latest] = Array.isArray(data)
      ? (data as Array<{
          connection_state: string;
          updated_at: string;
          github_login: string | null;
          github_avatar_url: string | null;
        }>)
      : [];
    if (latest) {
      latestConnection = {
        state: latest.connection_state,
        updatedAt: latest.updated_at,
        githubLogin: latest.github_login ?? undefined,
        githubAvatarUrl: latest.github_avatar_url ?? undefined,
      };
    }
  }

  return {
    authProvider: 'ready',
    repositoryAccess: hasGitHubCredentials() || hasGitHubAppCredentials()
      ? 'ready'
      : 'setup_needed',
    connectionStore,
    connectionCount,
    latestConnection,
    startUrl: '/api/connections/github/start',
    summaries: {
      authProvider: 'GitHub OAuth is enabled in InsForge for user sign-in.',
      repositoryAccess: hasGitHubAppCredentials()
        ? 'GitHub App credentials are available for repository operations.'
        : hasGitHubCredentials()
          ? 'A GitHub token is available for repository operations.'
          : 'Add GitHub App credentials before FlowPR opens PRs for connected repositories.',
      connectionStore:
        connectionStore === 'ready'
          ? 'GitHub connection records are stored in InsForge.'
          : 'Run the InsForge connection migration before saving GitHub connections.',
    },
  };
}
