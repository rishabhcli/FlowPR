import { randomUUID } from 'node:crypto';
import { loadLocalEnv } from './env';

export type WunderGraphSafeOperation =
  | 'recordBrowserObservation'
  | 'recordBugHypothesis'
  | 'recordPatch'
  | 'markVerification'
  | 'createPullRequest'
  | 'recordPolicyHit';

export interface WunderGraphOperationRequest {
  operation: WunderGraphSafeOperation;
  runId: string;
  input: Record<string, unknown>;
  actorSessionId?: string;
}

export interface WunderGraphOperationResult {
  operation: WunderGraphSafeOperation;
  runId: string;
  executionId: string;
  transport: 'mcp-gateway' | 'local-safelist';
  endpoint?: string;
  status: 'accepted' | 'skipped';
  requestSignature: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  completedAt: string;
}

export interface WunderGraphConfig {
  apiUrl?: string;
  apiKey?: string;
  mcpUrl?: string;
  healthUrl?: string;
}

const DEFAULT_SAFELIST: readonly WunderGraphSafeOperation[] = [
  'recordBrowserObservation',
  'recordBugHypothesis',
  'recordPatch',
  'markVerification',
  'createPullRequest',
  'recordPolicyHit',
];

export function getWunderGraphSafelist(): readonly WunderGraphSafeOperation[] {
  loadLocalEnv();
  const custom = process.env.WUNDERGRAPH_SAFELIST;

  if (!custom) return DEFAULT_SAFELIST;

  const allowed = custom
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is WunderGraphSafeOperation => (DEFAULT_SAFELIST as readonly string[]).includes(value));

  return allowed.length > 0 ? allowed : DEFAULT_SAFELIST;
}

function cleanEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function controlPlaneHealthUrl(apiUrl: string): string {
  try {
    const url = new URL(apiUrl);

    if (url.pathname === '' || url.pathname === '/') {
      url.pathname = '/health';
    }

    return url.toString();
  } catch {
    return apiUrl;
  }
}

export function getWunderGraphConfig(): WunderGraphConfig {
  loadLocalEnv();

  const apiUrl = cleanEnvValue(process.env.WUNDERGRAPH_API_URL) ?? cleanEnvValue(process.env.COSMO_API_URL);
  const apiKey = cleanEnvValue(process.env.WUNDERGRAPH_API_KEY) ?? cleanEnvValue(process.env.COSMO_API_KEY);
  const mcpUrl = cleanEnvValue(process.env.WUNDERGRAPH_MCP_URL);

  return {
    apiUrl,
    apiKey,
    mcpUrl,
    healthUrl: apiUrl ? controlPlaneHealthUrl(apiUrl) : undefined,
  };
}

function summarizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(input).slice(0, 12);
  const signature: Record<string, unknown> = {};

  for (const key of keys) {
    const value = input[key];

    if (value === undefined) continue;

    if (Array.isArray(value)) {
      signature[key] = { type: 'array', length: value.length };
    } else if (value && typeof value === 'object') {
      signature[key] = { type: 'object', keys: Object.keys(value as Record<string, unknown>).slice(0, 8) };
    } else {
      const stringified = String(value);
      signature[key] = stringified.length > 160 ? `${stringified.slice(0, 160)}…` : stringified;
    }
  }

  return signature;
}

export async function executeWunderGraphOperation<T>(
  request: WunderGraphOperationRequest,
  localExecutor: () => Promise<T>,
): Promise<{ result: T; artifact: WunderGraphOperationResult }> {
  loadLocalEnv();
  const safelist = getWunderGraphSafelist();

  if (!safelist.includes(request.operation)) {
    throw new Error(`WunderGraph safelist does not include operation ${request.operation}`);
  }

  const start = Date.now();
  const { apiKey, mcpUrl } = getWunderGraphConfig();
  const endpoint = mcpUrl;
  const transport: WunderGraphOperationResult['transport'] = endpoint ? 'mcp-gateway' : 'local-safelist';
  const executionId = `wg_${request.operation}_${randomUUID().slice(0, 12)}`;

  if (transport === 'mcp-gateway' && endpoint) {
    try {
      await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          operation: request.operation,
          variables: { runId: request.runId, ...request.input },
          executionId,
        }),
      });
    } catch {
      // Swallow transport failure — local executor remains the source of truth.
    }
  }

  const result = await localExecutor();
  const durationMs = Date.now() - start;

  const artifact: WunderGraphOperationResult = {
    operation: request.operation,
    runId: request.runId,
    executionId,
    transport,
    endpoint: transport === 'mcp-gateway' ? endpoint : undefined,
    status: 'accepted',
    requestSignature: summarizeInput(request.input),
    responseSummary: {
      durationMs,
      hasResult: result !== undefined,
      actorSessionId: request.actorSessionId,
    },
    completedAt: new Date().toISOString(),
  };

  return { result, artifact };
}
