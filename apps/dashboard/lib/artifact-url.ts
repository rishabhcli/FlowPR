export function artifactSrc(
  runId: string,
  input: { url?: string; key?: string } | undefined,
): string | undefined {
  if (!input) return undefined;
  const target = input.key ?? input.url;
  if (!target) return undefined;
  const param = input.key ? 'key' : 'url';
  return `/api/runs/${runId}/screenshot?${param}=${encodeURIComponent(target)}`;
}

export function playwrightTraceViewerUrl(proxySrc: string): string | undefined {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, '');
  if (!base || base.includes('localhost') || base.includes('127.0.0.1')) {
    // trace.playwright.dev can't reach a local dev server — fall back to direct download.
    return undefined;
  }
  const absolute = proxySrc.startsWith('http') ? proxySrc : `${base}${proxySrc}`;
  return `https://trace.playwright.dev/?trace=${encodeURIComponent(absolute)}`;
}
