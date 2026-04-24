export type FailureCategory =
  | 'timeout'
  | 'aborted'
  | 'auth'
  | 'target_unreachable'
  | 'rate_limited'
  | 'assertion'
  | 'navigation'
  | 'tool_error'
  | 'unknown';

export interface ClassifiedFailure {
  category: FailureCategory;
  summary: string;
  detail: string;
}

const patterns: Array<{ category: FailureCategory; summary: string; match: RegExp }> = [
  { category: 'timeout', summary: 'Timed out', match: /timeout|timed[- ]out|deadline|ETIMEDOUT/i },
  { category: 'aborted', summary: 'Run aborted', match: /aborted|abort|AbortError|AbortSignal/i },
  { category: 'auth', summary: 'Authentication error', match: /unauthori[sz]ed|forbidden|401|403|invalid api key|expired token/i },
  { category: 'rate_limited', summary: 'Rate limited', match: /rate[- ]limit|429|too many requests|quota exceeded/i },
  { category: 'target_unreachable', summary: 'Target unreachable', match: /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ERR_CONNECTION_REFUSED|ERR_NAME_NOT_RESOLVED|network error|dns|socket hang up|fetch failed/i },
  { category: 'navigation', summary: 'Navigation failed', match: /navigation|page\.goto|net::|waiting for selector|locator|expected.*to be visible/i },
  { category: 'assertion', summary: 'Assertion failed', match: /assert|expect\(|toBe|toEqual|toMatch/i },
  { category: 'tool_error', summary: 'Tool error', match: /tool|provider|sdk|api error|bad request|400|500|502|503/i },
];

export function classifyFailure(input: string | Error | undefined | null): ClassifiedFailure {
  if (!input) {
    return { category: 'unknown', summary: 'Unknown failure', detail: '' };
  }

  const detail = input instanceof Error ? input.message : String(input);

  for (const { category, summary, match } of patterns) {
    if (match.test(detail)) {
      return { category, summary, detail };
    }
  }

  return { category: 'unknown', summary: 'Unknown failure', detail };
}

export function describeFailureCategory(category: FailureCategory): string {
  switch (category) {
    case 'timeout':
      return 'The run exceeded its time budget. Try a shorter goal or a faster preview.';
    case 'aborted':
      return 'The run was aborted before completion — usually an upstream cancellation or signal.';
    case 'auth':
      return 'An API call was rejected for authentication reasons. Rotate or re-check credentials.';
    case 'target_unreachable':
      return 'The preview URL could not be reached from the browser runner.';
    case 'rate_limited':
      return 'A provider rate-limited the request. Back off and retry.';
    case 'navigation':
      return 'The browser failed to reach or render the expected screen.';
    case 'assertion':
      return 'An expected state was not observed on the page.';
    case 'tool_error':
      return 'A downstream tool returned a non-success response.';
    case 'unknown':
    default:
      return 'Review the failing evidence for a root cause.';
  }
}
