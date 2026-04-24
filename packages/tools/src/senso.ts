export interface SensoClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface SensoSearchOptions {
  query: string;
  maxResults?: number;
}

export interface SensoRawDocument {
  title: string;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface SensoClient {
  search(options: SensoSearchOptions): Promise<unknown>;
  ingestRaw(document: SensoRawDocument): Promise<unknown>;
}

export interface SensoPolicyContext {
  acceptanceCriteria: Array<{ text: string; source?: string }>;
  severityGuidance: Array<{ text: string; source?: string }>;
  prRequirements: string[];
  codingConstraints: string[];
  citations: Array<{ title: string; url?: string; excerpt?: string }>;
  raw: unknown;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function parseSensoResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = typeof body === 'object' && body && 'error' in body ? String(body.error) : text;
    throw new Error(`Senso request failed (${response.status}): ${message}`);
  }

  return body;
}

export function createSensoClient(options: SensoClientOptions = {}): SensoClient {
  const apiKey = options.apiKey ?? process.env.SENSO_API_KEY;
  const baseUrl = trimTrailingSlash(
    options.baseUrl ?? process.env.SENSO_API_BASE_URL ?? 'https://apiv2.senso.ai/api/v1',
  );

  if (!apiKey) {
    throw new Error('SENSO_API_KEY is required to create a Senso client');
  }

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': apiKey,
  };

  return {
    async search({ query, maxResults = 5 }: SensoSearchOptions): Promise<unknown> {
      const response = await fetch(`${baseUrl}/org/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          max_results: maxResults,
        }),
      });

      return parseSensoResponse(response);
    },

    async ingestRaw(document: SensoRawDocument): Promise<unknown> {
      const response = await fetch(`${baseUrl}/org/kb/raw`, {
        method: 'POST',
        headers,
        body: JSON.stringify(document),
      });

      return parseSensoResponse(response);
    },
  };
}

function extractRecords(raw: unknown): Record<string, unknown>[] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  }

  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const candidateArrays = ['results', 'documents', 'hits', 'data'];

    for (const key of candidateArrays) {
      const candidate = record[key];

      if (Array.isArray(candidate)) {
        return candidate.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
      }
    }

    return [record];
  }

  return [];
}

function pickSummary(record: Record<string, unknown>): string | undefined {
  for (const key of ['summary', 'text', 'excerpt', 'content']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function pickTitle(record: Record<string, unknown>): string | undefined {
  for (const key of ['title', 'name', 'heading']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function pickUrl(record: Record<string, unknown>): string | undefined {
  for (const key of ['url', 'source_url', 'link']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function pickKind(record: Record<string, unknown>): string | undefined {
  const metadata = record.metadata;
  if (metadata && typeof metadata === 'object' && typeof (metadata as Record<string, unknown>).kind === 'string') {
    return String((metadata as Record<string, unknown>).kind);
  }

  if (typeof record.kind === 'string') return record.kind;

  return undefined;
}

const FALLBACK_POLICY: SensoPolicyContext = {
  acceptanceCriteria: [
    { text: 'Primary product flows must succeed on the declared viewport before merging.', source: 'flowpr_policy_fallback' },
    { text: 'Critical CTAs must be reachable and not obstructed by overlays or cookie banners.', source: 'flowpr_policy_fallback' },
  ],
  severityGuidance: [
    { text: 'Blocked checkout or auth flows are always critical severity.', source: 'flowpr_policy_fallback' },
    { text: 'Visual regressions that hide a primary CTA are at least high severity.', source: 'flowpr_policy_fallback' },
  ],
  prRequirements: [
    'Include before and after screenshots from a live browser run.',
    'Include a regression test that fails before the patch and passes after.',
    'Describe the root cause, the files changed, and the verification result.',
  ],
  codingConstraints: [
    'Keep diffs minimal and scoped to suspected files.',
    'Do not introduce unrelated refactors.',
  ],
  citations: [],
  raw: { fallback: true },
};

export interface QueryPolicyContextInput {
  client?: SensoClient;
  flowGoal: string;
  failureSummary?: string;
  bugType?: string;
  evidence?: Record<string, unknown>;
  maxResults?: number;
}

export async function queryPolicyContext(input: QueryPolicyContextInput): Promise<SensoPolicyContext> {
  if (!process.env.SENSO_API_KEY && !input.client) {
    return FALLBACK_POLICY;
  }

  const client = input.client ?? createSensoClient();
  const prompt = [
    'FlowPR frontend QA policy request.',
    `Flow goal: ${input.flowGoal}`,
    input.failureSummary ? `Observed failure: ${input.failureSummary}` : undefined,
    input.bugType ? `Suspected bug type: ${input.bugType}` : undefined,
    'Return relevant acceptance criteria, severity guidance, pull request evidence requirements, and coding constraints.',
  ]
    .filter(Boolean)
    .join('\n');

  let raw: unknown;

  try {
    raw = await client.search({ query: prompt, maxResults: input.maxResults ?? 5 });
  } catch (error) {
    return {
      ...FALLBACK_POLICY,
      citations: [
        {
          title: 'Senso fallback applied',
          excerpt: error instanceof Error ? error.message : String(error),
        },
      ],
      raw: { fallback: true, error: error instanceof Error ? error.message : String(error) },
    };
  }

  const records = extractRecords(raw);

  if (records.length === 0) {
    return { ...FALLBACK_POLICY, raw };
  }

  const acceptanceCriteria: Array<{ text: string; source?: string }> = [];
  const severityGuidance: Array<{ text: string; source?: string }> = [];
  const prRequirements: string[] = [];
  const codingConstraints: string[] = [];
  const citations: Array<{ title: string; url?: string; excerpt?: string }> = [];

  for (const record of records) {
    const title = pickTitle(record) ?? 'Senso policy entry';
    const summary = pickSummary(record) ?? title;
    const url = pickUrl(record);
    const kind = pickKind(record);

    citations.push({ title, url, excerpt: summary });

    if (kind === 'severity' || /severity|critical|risk/i.test(summary)) {
      severityGuidance.push({ text: summary, source: title });
    }

    if (kind === 'pr' || /pull request|pr body|evidence|rollback/i.test(summary)) {
      prRequirements.push(summary);
    }

    if (kind === 'code' || /code style|minimal|diff|refactor/i.test(summary)) {
      codingConstraints.push(summary);
    }

    acceptanceCriteria.push({ text: summary, source: title });
  }

  return {
    acceptanceCriteria,
    severityGuidance: severityGuidance.length > 0 ? severityGuidance : FALLBACK_POLICY.severityGuidance,
    prRequirements: prRequirements.length > 0 ? Array.from(new Set(prRequirements)) : FALLBACK_POLICY.prRequirements,
    codingConstraints: codingConstraints.length > 0 ? Array.from(new Set(codingConstraints)) : FALLBACK_POLICY.codingConstraints,
    citations,
    raw,
  };
}

export const FLOWPR_SENSO_SEED_DOCUMENTS: SensoRawDocument[] = [
  {
    title: 'FlowPR critical flow policy — mobile checkout',
    text: 'Checkout, signup, auth, and payment flows are critical. A blocked primary CTA on mobile is always a critical-severity regression and must ship with regression evidence.',
    metadata: { kind: 'severity', source: 'flowpr_phase5_seed' },
  },
  {
    title: 'FlowPR mobile accessibility policy',
    text: 'Primary CTAs must be visible, reachable, and unobstructed by cookie banners or overlays. elementFromPoint at the CTA center must resolve to the CTA or a descendant.',
    metadata: { kind: 'acceptance_criteria', source: 'flowpr_phase5_seed' },
  },
  {
    title: 'FlowPR PR evidence policy',
    text: 'Every FlowPR pull request must include a root-cause summary, before/after screenshots, a regression test, local verification output, and a rollback plan.',
    metadata: { kind: 'pr', source: 'flowpr_phase5_seed' },
  },
  {
    title: 'FlowPR code-style policy',
    text: 'Patches must be minimal and scoped to suspected files. No unrelated refactors, no broad stylistic rewrites. Keep diffs under three files whenever possible.',
    metadata: { kind: 'code', source: 'flowpr_phase5_seed' },
  },
  {
    title: 'FlowPR product flow contract',
    text: 'The demo target supports pricing → checkout → success. Pro and Basic plans both terminate at /success. Mobile viewport is 390x844.',
    metadata: { kind: 'acceptance_criteria', source: 'flowpr_phase5_seed' },
  },
];
