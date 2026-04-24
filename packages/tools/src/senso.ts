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
