import type {
  AgentRunWithStreamingResponse,
  BrowserSession,
  Run,
  RunError,
  TinyFish,
} from '@tiny-fish/sdk';
import { loadLocalEnv } from './env';

export interface TinyFishAgentFlowInput {
  runId: string;
  previewUrl: string;
  flowGoal: string;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface TinyFishProgressEvent {
  type: AgentRunWithStreamingResponse['type'];
  runId?: string;
  purpose?: string;
  streamingUrl?: string;
  timestamp?: string;
}

export interface TinyFishBrowserObservation {
  passed: boolean;
  failedStep?: string;
  visibleError?: string;
  finalUrl?: string;
  screenshots: string[];
  consoleErrors: string[];
  networkErrors: Array<{ url: string; status?: number; method?: string }>;
  domFindings: string[];
  likelyRootCause?: string;
  confidence: number;
}

export interface TinyFishAgentFlowResult {
  providerRunId?: string;
  status: Run['status'] | 'STREAM_FAILED';
  streamingUrl?: string;
  progressEvents: TinyFishProgressEvent[];
  observation: TinyFishBrowserObservation;
  rawResult?: Record<string, unknown> | null;
  error?: RunError | { message: string; category: 'UNKNOWN'; retry_after: null };
  attempts: number;
  transport: 'stream';
}

export async function createTinyFishClient(): Promise<TinyFish> {
  loadLocalEnv();
  const { TinyFish } = await import('@tiny-fish/sdk');
  const configuredBaseUrl = process.env.TINYFISH_API_BASE_URL?.trim();
  const baseURL =
    configuredBaseUrl && configuredBaseUrl !== 'https://api.tinyfish.ai' ? configuredBaseUrl : undefined;

  return new TinyFish({
    apiKey: process.env.TINYFISH_API_KEY,
    baseURL,
  });
}

export function buildTinyFishQaGoal(input: TinyFishAgentFlowInput): string {
  return [
    'You are testing a frontend flow for FlowPR.',
    `FlowPR run ID: ${input.runId}`,
    `Start URL: ${input.previewUrl}`,
    'Viewport: mobile 390x844 unless the page forces another viewport.',
    `Goal: ${input.flowGoal}`,
    'Act like a proactive QA engineer: explore the whole requested flow, click the primary actions, and stop at the first clear success, failure, timeout, blocked control, visible error, or unsafe payment step.',
    'Do not use real payment credentials. If payment is required, use only visible test/demo details already present in the app.',
    'If a page breaks, a button is covered, navigation stalls, or an action fails, capture what a user would see and return the exact failed step.',
    'Return strict JSON only. No prose, markdown, or code fences.',
    'The JSON shape must be:',
    JSON.stringify(
      {
        passed: false,
        failed_step: null,
        visible_error: null,
        final_url: input.previewUrl,
        screenshots: [],
        console_errors: [],
        network_errors: [],
        dom_findings: [],
        likely_root_cause: null,
        confidence: 0.5,
      },
      null,
      2,
    ),
  ].join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]?.trim();
  const candidate = fenced ?? trimmed;

  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) return null;

    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return JSON.stringify(item);
      return undefined;
    })
    .filter((item): item is string => Boolean(item));
}

function networkErrors(value: unknown): Array<{ url: string; status?: number; method?: string }> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item === 'string') return [{ url: item }];
    if (!item || typeof item !== 'object') return [];

    const record = item as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : String(record.request ?? record.value ?? '');

    if (!url) return [];

    return [
      {
        url,
        status: typeof record.status === 'number' ? record.status : undefined,
        method: typeof record.method === 'string' ? record.method : undefined,
      },
    ];
  });
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function confidence(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);

  if (!Number.isFinite(numeric)) return 0.5;
  return Math.min(1, Math.max(0, numeric));
}

export function normalizeTinyFishObservation(
  result: unknown,
  fallback: { status: Run['status'] | 'STREAM_FAILED'; previewUrl: string; error?: RunError | { message: string } },
): TinyFishBrowserObservation {
  const parsed = extractJsonObject(result);
  const passed = typeof parsed?.passed === 'boolean'
    ? parsed.passed
    : fallback.status === 'COMPLETED' && !fallback.error;
  const failedStep = optionalString(parsed?.failed_step ?? parsed?.failedStep);
  const visibleError = optionalString(parsed?.visible_error ?? parsed?.visibleError ?? fallback.error?.message);
  const likelyRootCause = optionalString(parsed?.likely_root_cause ?? parsed?.likelyRootCause ?? visibleError);

  return {
    passed,
    failedStep,
    visibleError,
    finalUrl: optionalString(parsed?.final_url ?? parsed?.finalUrl) ?? fallback.previewUrl,
    screenshots: stringArray(parsed?.screenshots ?? parsed?.screenshot_urls ?? parsed?.screenshotUrls),
    consoleErrors: stringArray(parsed?.console_errors ?? parsed?.consoleErrors),
    networkErrors: networkErrors(parsed?.network_errors ?? parsed?.networkErrors),
    domFindings: stringArray(parsed?.dom_findings ?? parsed?.domFindings),
    likelyRootCause,
    confidence: confidence(parsed?.confidence),
  };
}

export async function runAgentFlow(input: TinyFishAgentFlowInput): Promise<TinyFishAgentFlowResult> {
  const { BrowserProfile, ProxyCountryCode } = await import('@tiny-fish/sdk');
  const client = await createTinyFishClient();
  const maxAttempts = input.maxAttempts ?? 2;
  const timeoutMs = input.timeoutMs ?? 120000;
  const goal = buildTinyFishQaGoal(input);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const progressEvents: TinyFishProgressEvent[] = [];
    let providerRunId: string | undefined;
    let streamingUrl: string | undefined;
    let completeEvent: Extract<AgentRunWithStreamingResponse, { type: 'COMPLETE' }> | undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const stream = await client.agent.stream(
        {
          url: input.previewUrl,
          goal,
          browser_profile: BrowserProfile.STEALTH,
          proxy_config: {
            enabled: true,
            country_code: ProxyCountryCode.US,
          },
        },
        {
          signal: controller.signal,
          onStarted: (event) => {
            providerRunId = event.run_id;
            progressEvents.push({ type: event.type, runId: event.run_id, timestamp: event.timestamp });
          },
          onStreamingUrl: (event) => {
            providerRunId = event.run_id;
            streamingUrl = event.streaming_url;
            progressEvents.push({
              type: event.type,
              runId: event.run_id,
              streamingUrl: event.streaming_url,
              timestamp: event.timestamp,
            });
          },
          onProgress: (event) => {
            providerRunId = event.run_id;
            progressEvents.push({
              type: event.type,
              runId: event.run_id,
              purpose: event.purpose,
              timestamp: event.timestamp,
            });
          },
          onComplete: (event) => {
            providerRunId = event.run_id;
            completeEvent = event;
            progressEvents.push({ type: event.type, runId: event.run_id, timestamp: event.timestamp });
          },
        },
      );

      for await (const event of stream) {
        if (event.type === 'COMPLETE') {
          providerRunId = event.run_id;
          completeEvent = event;
        }
      }

      if (!completeEvent) {
        throw new Error('TinyFish stream ended without a COMPLETE event');
      }

      return {
        providerRunId,
        status: completeEvent.status,
        streamingUrl,
        progressEvents,
        observation: normalizeTinyFishObservation(completeEvent.result, {
          status: completeEvent.status,
          previewUrl: input.previewUrl,
          error: completeEvent.error ?? undefined,
        }),
        rawResult: completeEvent.result,
        error: completeEvent.error ?? undefined,
        attempts: attempt,
        transport: 'stream',
      };
    } catch (error) {
      lastError = error;

      if (attempt < maxAttempts) {
        await sleep(1500 * attempt);
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  const errorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  const error = { message: errorMessage, category: 'UNKNOWN' as const, retry_after: null };

  return {
    status: 'STREAM_FAILED',
    progressEvents: [],
    observation: normalizeTinyFishObservation(null, {
      status: 'STREAM_FAILED',
      previewUrl: input.previewUrl,
      error,
    }),
    error,
    attempts: maxAttempts,
    transport: 'stream',
  };
}

export async function createBrowserSession(input: { url?: string }): Promise<BrowserSession> {
  const client = await createTinyFishClient();
  return client.browser.sessions.create(input.url ? { url: input.url } : undefined);
}

export async function terminateBrowserSession(sessionId: string): Promise<void> {
  loadLocalEnv();
  const apiKey = process.env.TINYFISH_API_KEY;

  if (!apiKey) {
    throw new Error('TINYFISH_API_KEY is required to terminate a TinyFish browser session');
  }

  const baseUrl = process.env.TINYFISH_BROWSER_API_BASE_URL ?? 'https://api.browser.tinyfish.ai';
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/${sessionId}`, {
    method: 'DELETE',
    headers: {
      'X-API-Key': apiKey,
    },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`TinyFish browser session termination failed with ${response.status}`);
  }
}

export async function listTinyFishRuns(limit = 1) {
  const client = await createTinyFishClient();

  return client.runs.list({ limit, sort_direction: 'desc' });
}
