import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, writeFile as writeFileAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FLOWPR_OPERATOR_CANCELLATION_SUMMARY,
  isOperatorCancelledRun,
  parseFlowProfileInput,
  type FlowProfileInput,
} from '@flowpr/schemas';
import {
  localCreateFlowProfile,
  localCreateRun,
  localDownloadRunArtifact,
  localDeleteFlowProfile,
  localGetRun,
  localGetRunDetail,
  localGetFlowProfile,
  localListRecentRuns,
  localListFlowProfiles,
  localTouchFlowProfile,
  localUploadRunArtifact,
  localUpdateFlowProfile,
} from '../../packages/tools/src/local-store';
import { createRun, downloadRunArtifact } from '../../packages/tools/src/insforge';
import { createSessionValue, verifySessionValue } from '../../apps/dashboard/lib/session';
import {
  selectFinalVerificationResults,
  selectLocalVerification,
} from '../../apps/dashboard/lib/verification';
import { isSeededDemoPatchAllowed } from '../../packages/agent/src/agents/patcher';
import { buildVerificationEnv } from '../../packages/agent/src/agents/verifier';
import { startGuildAgentSession } from '../../packages/tools/src/guildai';
import { normalizeTinyFishObservation } from '../../packages/tools/src/tinyfish';
import { readWorkspaceFile, sanitizeRemoteUrl, writeWorkspaceFile } from '../../packages/tools/src/repo';
import { validateRunStartInput } from '../../packages/tools/src/validators';

function profileInput(overrides: Partial<FlowProfileInput> = {}): FlowProfileInput {
  return {
    name: 'Mobile checkout',
    description: 'Protect the checkout journey',
    repoUrl: 'https://github.com/rishabhcli/FlowPR',
    previewUrl: 'http://localhost:3100',
    baseBranch: 'main',
    flowGoal: 'Complete checkout on mobile and reach success.',
    riskLevel: 'medium',
    permissionProfile: 'draft-pr-only',
    tags: ['checkout', 'mobile'],
    enabled: true,
    ...overrides,
  };
}

test('flow profile input is normalized and validated', () => {
  const parsed = parseFlowProfileInput({
    ...profileInput(),
    tags: [' Checkout ', 'MOBILE', '', 42],
  });

  assert.deepEqual(parsed.tags, ['checkout', 'mobile']);
  assert.equal(parsed.enabled, true);
  assert.equal(parseFlowProfileInput({ ...profileInput(), description: '' }).description, '');
  assert.throws(
    () => parseFlowProfileInput({ ...profileInput(), previewUrl: 'file:///tmp/preview' }),
    /previewUrl must be a valid http or https URL/,
  );
  assert.throws(
    () => parseFlowProfileInput({ ...profileInput(), name: 'x'.repeat(81) }),
    /name must be 80 characters or fewer/,
  );
});

test('session values are signed and tamper-evident', () => {
  const previousSecret = process.env.FLOWPR_SESSION_SECRET;
  process.env.FLOWPR_SESSION_SECRET = 'unit-test-session-secret';
  try {
    const session = createSessionValue('insforge-user-123');
    assert.equal(verifySessionValue(session), 'insforge-user-123');
    assert.equal(verifySessionValue(`${session}tampered`), null);
    assert.equal(verifySessionValue('connected'), null);
  } finally {
    if (previousSecret === undefined) delete process.env.FLOWPR_SESSION_SECRET;
    else process.env.FLOWPR_SESSION_SECRET = previousSecret;
  }
});

test('operator cancellation is a durable worker stop marker', () => {
  assert.equal(
    isOperatorCancelledRun({ status: 'failed', failureSummary: FLOWPR_OPERATOR_CANCELLATION_SUMMARY }),
    true,
  );
  assert.equal(
    isOperatorCancelledRun({ status: 'failed', failureSummary: 'Another failure' }),
    false,
  );
  assert.equal(
    isOperatorCancelledRun({ status: 'done', failureSummary: FLOWPR_OPERATOR_CANCELLATION_SUMMARY }),
    false,
  );
});

test('preview intake blocks private addresses outside explicit local mode', async () => {
  const previousMode = process.env.FLOWPR_DATA_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.FLOWPR_DATA_MODE = '';
  process.env.NODE_ENV = 'test';

  try {
    const result = await validateRunStartInput({
      repoUrl: 'https://github.com/rishabhcli/FlowPR',
      previewUrl: 'http://169.254.169.254/latest/meta-data',
      flowGoal: 'Complete checkout and reach the success page.',
      baseBranch: 'main',
    });

    assert.equal(result.issues.some((issue) => issue.code === 'previewUrl.blocked'), true);
  } finally {
    if (previousMode === undefined) delete process.env.FLOWPR_DATA_MODE;
    else process.env.FLOWPR_DATA_MODE = previousMode;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('preview intake permits loopback only in explicit local mode', async () => {
  const previousMode = process.env.FLOWPR_DATA_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.FLOWPR_DATA_MODE = 'local';
  process.env.NODE_ENV = 'test';

  try {
    const result = await validateRunStartInput({
      repoUrl: 'https://github.com/rishabhcli/FlowPR',
      previewUrl: 'http://127.0.0.1:9',
      flowGoal: 'Complete checkout and reach the success page.',
      baseBranch: 'main',
    });

    assert.equal(result.issues.some((issue) => issue.code === 'previewUrl.blocked'), false);

    const wildcardResult = await validateRunStartInput({
      repoUrl: 'https://github.com/rishabhcli/FlowPR',
      previewUrl: 'http://0.0.0.0:9',
      flowGoal: 'Complete checkout and reach the success page.',
      baseBranch: 'main',
    });
    assert.equal(wildcardResult.issues.some((issue) => issue.code === 'previewUrl.blocked'), true);
  } finally {
    if (previousMode === undefined) delete process.env.FLOWPR_DATA_MODE;
    else process.env.FLOWPR_DATA_MODE = previousMode;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test('artifact proxy blocks private URLs before making a request', async () => {
  const previousMode = process.env.FLOWPR_DATA_MODE;
  const previousFetch = globalThis.fetch;
  let fetchCalled = false;
  process.env.FLOWPR_DATA_MODE = '';
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error('fetch should not run');
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => downloadRunArtifact('http://127.0.0.1/private.png'),
      /private, loopback, or reserved/i,
    );
    assert.equal(fetchCalled, false);
  } finally {
    if (previousMode === undefined) delete process.env.FLOWPR_DATA_MODE;
    else process.env.FLOWPR_DATA_MODE = previousMode;
    globalThis.fetch = previousFetch;
  }
});

test('artifact proxy does not send InsForge credentials to external URLs', async () => {
  const previousApiUrl = process.env.INSFORGE_API_URL;
  const previousAnonKey = process.env.INSFORGE_ANON_KEY;
  const previousApiKey = process.env.INSFORGE_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  process.env.INSFORGE_API_URL = 'https://insforge.example';
  process.env.INSFORGE_ANON_KEY = 'anon-secret';
  process.env.INSFORGE_API_KEY = 'service-secret';
  globalThis.fetch = (async (_input, init) => {
    requests.push(init ?? {});
    return new Response('artifact', {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }) as typeof fetch;

  try {
    const artifact = await downloadRunArtifact('https://1.1.1.1/evidence.txt');
    assert.equal(new TextDecoder().decode(artifact.bytes), 'artifact');
    assert.deepEqual(requests[0]?.headers, {});
  } finally {
    if (previousApiUrl === undefined) delete process.env.INSFORGE_API_URL;
    else process.env.INSFORGE_API_URL = previousApiUrl;
    if (previousAnonKey === undefined) delete process.env.INSFORGE_ANON_KEY;
    else process.env.INSFORGE_ANON_KEY = previousAnonKey;
    if (previousApiKey === undefined) delete process.env.INSFORGE_API_KEY;
    else process.env.INSFORGE_API_KEY = previousApiKey;
    globalThis.fetch = previousFetch;
  }
});

test('InsForge failures do not silently persist data outside explicit local mode', async () => {
  const storeDir = await mkdtemp(join(tmpdir(), 'flowpr-insforge-fail-closed-'));
  const previousMode = process.env.FLOWPR_DATA_MODE;
  const previousStoreDir = process.env.FLOWPR_LOCAL_STORE_DIR;
  const configKeys = [
    'INSFORGE_API_URL',
    'INSFORGE_URL',
    'NEXT_PUBLIC_INSFORGE_URL',
    'INSFORGE_ANON_KEY',
    'INSFORGE_API_KEY',
    'NEXT_PUBLIC_INSFORGE_ANON_KEY',
  ] as const;
  const previousConfig = Object.fromEntries(
    configKeys.map((key) => [key, process.env[key]]),
  ) as Record<(typeof configKeys)[number], string | undefined>;

  process.env.FLOWPR_DATA_MODE = '';
  process.env.FLOWPR_LOCAL_STORE_DIR = storeDir;
  for (const key of configKeys) process.env[key] = '';

  try {
    await assert.rejects(
      () => createRun({
        ownerKey: 'owner-remote',
        repoUrl: 'https://github.com/rishabhcli/FlowPR',
        previewUrl: 'https://preview.example.com',
        baseBranch: 'main',
        flowGoal: 'Complete checkout and reach success.',
        riskLevel: 'medium',
        permissionProfile: 'draft-pr-only',
      }),
      /INSFORGE_API_URL|INSFORGE_URL/i,
    );
    assert.equal((await localListRecentRuns(10, 'owner-remote')).length, 0);

    process.env.FLOWPR_DATA_MODE = 'local';
    const localRun = await createRun({
      ownerKey: 'owner-local',
      repoUrl: 'https://github.com/rishabhcli/FlowPR',
      previewUrl: 'http://localhost:3100',
      baseBranch: 'main',
      flowGoal: 'Complete checkout and reach success.',
      riskLevel: 'medium',
      permissionProfile: 'draft-pr-only',
    });
    assert.equal(localRun.ownerKey, 'owner-local');
    assert.equal((await localListRecentRuns(10, 'owner-local')).length, 1);

    await localUploadRunArtifact({ key: 'runs/owner-local/evidence.txt', body: 'local artifact' });
    process.env.FLOWPR_DATA_MODE = '';
    await assert.rejects(
      () => downloadRunArtifact('runs/owner-local/evidence.txt'),
      /INSFORGE_API_URL|INSFORGE_URL/i,
    );
  } finally {
    if (previousMode === undefined) delete process.env.FLOWPR_DATA_MODE;
    else process.env.FLOWPR_DATA_MODE = previousMode;
    if (previousStoreDir === undefined) delete process.env.FLOWPR_LOCAL_STORE_DIR;
    else process.env.FLOWPR_LOCAL_STORE_DIR = previousStoreDir;
    for (const key of configKeys) {
      const value = previousConfig[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(storeDir, { recursive: true, force: true });
  }
});

test('verification child environments exclude provider credentials and arbitrary overrides', () => {
  const env = buildVerificationEnv(
    {
      DEMO_TARGET_URL: 'http://127.0.0.1:3310',
      PORT: '4310',
      FLOWPR_TEST_SECRET: 'override-secret',
    },
    {
      PATH: '/usr/bin',
      HOME: '/Users/example',
      NODE_ENV: 'test',
      LC_CTYPE: 'UTF-8',
      TINYFISH_API_KEY: 'tinyfish-secret',
      INSFORGE_ANON_KEY: 'insforge-secret',
      FLOWPR_SESSION_SECRET: 'session-secret',
    },
  );

  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.NODE_ENV, 'test');
  assert.equal(env.LC_CTYPE, 'UTF-8');
  assert.equal(env.DEMO_TARGET_URL, 'http://127.0.0.1:3310');
  assert.equal(env.PORT, '4310');
  assert.equal(env.TINYFISH_API_KEY, undefined);
  assert.equal(env.INSFORGE_ANON_KEY, undefined);
  assert.equal(env.FLOWPR_SESSION_SECRET, undefined);
  assert.equal(env.FLOWPR_TEST_SECRET, undefined);
});

test('authenticated clone URLs are never persisted with credentials', () => {
  assert.equal(
    sanitizeRemoteUrl('https://x-access-token:ghp_example-secret@github.com/acme/store.git?ref=main#source'),
    'https://github.com/acme/store.git',
  );
  assert.equal(sanitizeRemoteUrl('git@github.com:acme/store.git'), 'git@github.com:acme/store.git');
});

test('workspace file helpers reject paths outside the checkout', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'flowpr-workspace-paths-'));
  const outside = await mkdtemp(join(tmpdir(), 'flowpr-workspace-outside-'));

  try {
    await writeFileAsync(join(outside, 'secret.txt'), 'must not read');
    await symlink(outside, join(workspace, 'linked-directory'), 'dir');

    await assert.rejects(readWorkspaceFile(workspace, '../outside.txt'), /escapes the checkout/);
    await assert.rejects(
      writeWorkspaceFile({ dir: workspace, path: '../outside.txt', content: 'must not write' }),
      /escapes the checkout/,
    );
    await assert.rejects(readWorkspaceFile(workspace, 'linked-directory/secret.txt'), /escapes the checkout/);
    await assert.rejects(
      writeWorkspaceFile({ dir: workspace, path: 'linked-directory/new.txt', content: 'must not write' }),
      /escapes the checkout/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('local artifact keys cannot escape the artifact directory', async () => {
  const storeDir = await mkdtemp(join(tmpdir(), 'flowpr-artifact-test-'));
  const previousStoreDir = process.env.FLOWPR_LOCAL_STORE_DIR;
  process.env.FLOWPR_LOCAL_STORE_DIR = storeDir;

  try {
    await assert.rejects(
      () => localUploadRunArtifact({ key: '../outside.txt', body: 'secret' }),
      /inside the artifact directory/i,
    );
    await assert.rejects(
      () => localDownloadRunArtifact('../../outside.txt'),
      /inside the artifact directory/i,
    );
  } finally {
    if (previousStoreDir === undefined) delete process.env.FLOWPR_LOCAL_STORE_DIR;
    else process.env.FLOWPR_LOCAL_STORE_DIR = previousStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
});

test('dashboard treats a Playwright browser proof as local verification when no patch check exists', () => {
  const playwright = {
    id: 'playwright-result',
    runId: 'run-1',
    provider: 'playwright',
    status: 'passed',
    summary: 'Browser flow passed.',
    artifacts: [],
    createdAt: new Date().toISOString(),
  } as const;
  const local = {
    ...playwright,
    id: 'local-result',
    provider: 'local',
    summary: 'Patch verification passed.',
  } as const;
  const live = {
    ...playwright,
    id: 'tinyfish-result',
    provider: 'tinyfish-live',
    status: 'skipped',
  } as const;

  assert.equal(selectLocalVerification([playwright, live])?.id, 'playwright-result');
  assert.equal(selectLocalVerification([playwright, local, live])?.id, 'local-result');
  assert.deepEqual(
    selectFinalVerificationResults([playwright, local, live]).map((result) => result.id),
    ['local-result', 'tinyfish-result'],
  );
});

test('seeded patch fallback is restricted to the FlowPR mobile cookie-banner demo', () => {
  const triage = {
    bugType: 'blocked_cta',
    likelyFiles: ['apps/demo-target/app/styles.css'],
    hypothesis: 'The cookie banner obstructs the checkout CTA.',
    suspectedCause: 'Cookie banner is above the CTA.',
    evidence: { topDomFinding: 'cookie banner' },
  } as const;

  assert.equal(
    isSeededDemoPatchAllowed({
      repoUrl: 'https://github.com/rishabhcli/FlowPR.git',
      previewUrl: 'http://localhost:3100',
      triage,
    }),
    true,
  );
  assert.equal(
    isSeededDemoPatchAllowed({
      repoUrl: 'https://github.com/example/customer-app',
      previewUrl: 'http://localhost:3100',
      triage,
    }),
    false,
  );
  assert.equal(
    isSeededDemoPatchAllowed({
      repoUrl: 'https://github.com/rishabhcli/FlowPR',
      previewUrl: 'https://preview.example.com',
      triage,
    }),
    false,
  );
});

test('Guild app marker does not claim a live provider without a remote API key', async () => {
  const previousApiKey = process.env.GUILD_AI_API_KEY;
  const previousInstalled = process.env.GUILD_GITHUB_APP_INSTALLED;
  const previousWorkspace = process.env.GUILD_AI_WORKSPACE;

  delete process.env.GUILD_AI_API_KEY;
  process.env.GUILD_GITHUB_APP_INSTALLED = 'true';
  process.env.GUILD_AI_WORKSPACE = 'test-workspace';

  try {
    const session = await startGuildAgentSession({
      runId: 'run-guild-local',
      agentName: 'flowpr-autonomous-frontend-qa',
      agentVersion: '0.1.0',
      permissionProfile: 'draft-pr-only',
    });

    assert.equal(session.provider, 'guildai-local');
    assert.equal(session.traceUrl, undefined);

    process.env.GUILD_AI_API_KEY = 'configured-but-unverified';
    const configuredSession = await startGuildAgentSession({
      runId: 'run-guild-configured',
      agentName: 'flowpr-autonomous-frontend-qa',
      agentVersion: '0.1.0',
      permissionProfile: 'draft-pr-only',
    });
    assert.equal(configuredSession.provider, 'guildai-local');
    assert.equal(configuredSession.traceUrl, undefined);
  } finally {
    if (previousApiKey === undefined) delete process.env.GUILD_AI_API_KEY;
    else process.env.GUILD_AI_API_KEY = previousApiKey;
    if (previousInstalled === undefined) delete process.env.GUILD_GITHUB_APP_INSTALLED;
    else process.env.GUILD_GITHUB_APP_INSTALLED = previousInstalled;
    if (previousWorkspace === undefined) delete process.env.GUILD_AI_WORKSPACE;
    else process.env.GUILD_AI_WORKSPACE = previousWorkspace;
  }
});

test('TinyFish completion without structured QA output does not claim a passing flow', () => {
  const incomplete = normalizeTinyFishObservation('provider prose', {
    status: 'COMPLETED',
    previewUrl: 'https://preview.example.com/checkout',
  });
  assert.equal(incomplete.passed, false);
  assert.match(incomplete.visibleError ?? '', /structured QA result/i);

  const explicit = normalizeTinyFishObservation(JSON.stringify({ passed: true }), {
    status: 'COMPLETED',
    previewUrl: 'https://preview.example.com/checkout',
  });
  assert.equal(explicit.passed, true);
});

test('local flow profiles persist and remain owner-scoped', async () => {
  const storeDir = await mkdtemp(join(tmpdir(), 'flowpr-profile-test-'));
  const previousStoreDir = process.env.FLOWPR_LOCAL_STORE_DIR;
  process.env.FLOWPR_LOCAL_STORE_DIR = storeDir;

  try {
    const created = await localCreateFlowProfile('owner-a', profileInput());
    assert.equal((await localListFlowProfiles('owner-a')).length, 1);
    assert.equal((await localListFlowProfiles('owner-b')).length, 0);
    assert.equal(await localGetFlowProfile('owner-b', created.id), null);

    const updated = await localUpdateFlowProfile('owner-a', created.id, {
      description: 'Updated acceptance journey',
      enabled: false,
    });
    assert.equal(updated.description, 'Updated acceptance journey');
    assert.equal(updated.enabled, false);

    const touched = await localTouchFlowProfile('owner-a', created.id);
    assert.equal(touched.runCount, 1);
    assert.ok(touched.lastRunAt);

    const run = await localCreateRun({
      ownerKey: 'owner-a',
      repoUrl: 'https://github.com/rishabhcli/FlowPR',
      previewUrl: 'http://localhost:3100',
      baseBranch: 'main',
      flowGoal: 'Complete checkout on mobile and reach success.',
      riskLevel: 'medium',
      permissionProfile: 'draft-pr-only',
    });
    assert.equal((await localListRecentRuns(10, 'owner-a')).length, 1);
    assert.equal((await localListRecentRuns(10, 'owner-b')).length, 0);
    assert.equal(await localGetRun(run.id, 'owner-b'), null);

    const otherRun = await localCreateRun({
      ownerKey: 'owner-b',
      repoUrl: 'https://github.com/rishabhcli/FlowPR',
      previewUrl: 'http://localhost:3100',
      baseBranch: 'main',
      flowGoal: 'Review the account flow and reach the dashboard.',
      riskLevel: 'low',
      permissionProfile: 'investigation-only',
    });
    const detail = await localGetRunDetail(run.id);
    assert.ok(detail);
    assert.equal(detail.agentMemories.every((memory) => memory.runId === run.id), true);
    assert.notEqual(otherRun.id, run.id);

    await localDeleteFlowProfile('owner-a', created.id);
    assert.equal(await localGetFlowProfile('owner-a', created.id), null);
  } finally {
    if (previousStoreDir === undefined) delete process.env.FLOWPR_LOCAL_STORE_DIR;
    else process.env.FLOWPR_LOCAL_STORE_DIR = previousStoreDir;
    await rm(storeDir, { recursive: true, force: true });
  }
});
