#!/usr/bin/env node
// FlowPR skill helper — polls the dashboard until a run completes or fails.

const DASHBOARD_URL = process.env.FLOWPR_DASHBOARD_URL ?? 'http://localhost:3000';
const runId = process.env.FLOWPR_RUN_ID;

if (!runId) {
  console.error('FLOWPR_RUN_ID is required to check PR status.');
  process.exit(1);
}

async function main() {
  const timeoutMs = Number(process.env.FLOWPR_POLL_TIMEOUT_MS ?? 300000);
  const intervalMs = Number(process.env.FLOWPR_POLL_INTERVAL_MS ?? 4000);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const response = await fetch(`${DASHBOARD_URL}/api/runs/${runId}`, { cache: 'no-store' });
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error ?? `FlowPR returned ${response.status}`);
    }

    const { run, pullRequests } = body;

    if (run.status === 'done' || run.status === 'failed') {
      console.log(JSON.stringify({
        runId,
        status: run.status,
        pullRequestUrl: pullRequests?.[pullRequests.length - 1]?.url,
        pullRequestNumber: pullRequests?.[pullRequests.length - 1]?.number,
      }, null, 2));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`FlowPR run ${runId} did not complete within ${timeoutMs}ms`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
