#!/usr/bin/env node
// FlowPR skill helper — fetches the latest verification result for a run.

const DASHBOARD_URL = process.env.FLOWPR_DASHBOARD_URL ?? 'http://localhost:3000';
const runId = process.env.FLOWPR_RUN_ID;

if (!runId) {
  console.error('FLOWPR_RUN_ID is required to check verification status.');
  process.exit(1);
}

async function main() {
  const response = await fetch(`${DASHBOARD_URL}/api/runs/${runId}`, { cache: 'no-store' });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? `FlowPR returned ${response.status}`);
  }

  const latestVerification = body.verificationResults?.[body.verificationResults.length - 1];
  const result = {
    runId,
    overallStatus: body.run.status,
    verification: latestVerification
      ? {
          provider: latestVerification.provider,
          status: latestVerification.status,
          summary: latestVerification.summary,
          artifacts: latestVerification.artifacts,
        }
      : null,
  };

  console.log(JSON.stringify(result, null, 2));

  if (latestVerification?.status === 'failed' || latestVerification?.status === 'errored') {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
