import {
  BrowserProfile,
  ProxyCountryCode,
  TinyFish,
  type AgentRunAsyncResponse,
} from '@tiny-fish/sdk';

export interface BrowserQaRequest {
  previewUrl: string;
  flowGoal: string;
  runId: string;
}

export function createTinyFishClient() {
  const configuredBaseUrl = process.env.TINYFISH_API_BASE_URL?.trim();
  const baseURL =
    configuredBaseUrl && configuredBaseUrl !== 'https://api.tinyfish.ai' ? configuredBaseUrl : undefined;

  return new TinyFish({
    apiKey: process.env.TINYFISH_API_KEY,
    baseURL,
  });
}

export async function queueBrowserQa(
  client: TinyFish,
  request: BrowserQaRequest,
): Promise<AgentRunAsyncResponse> {
  return client.agent.queue({
    url: request.previewUrl,
    browser_profile: BrowserProfile.STEALTH,
    proxy_config: {
      enabled: true,
      country_code: ProxyCountryCode.US,
    },
    goal: [
      request.flowGoal,
      `Return JSON with run_id="${request.runId}", failed_step, observed_behavior, expected_behavior, severity, and suggested_fix.`,
    ].join('\n\n'),
  });
}
