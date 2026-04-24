#!/usr/bin/env node
// FlowPR skill entrypoint — posts a run start request to a dashboard instance.

const DASHBOARD_URL = process.env.FLOWPR_DASHBOARD_URL ?? 'http://localhost:3000';

async function main() {
  const input = {
    repoUrl: process.env.FLOWPR_REPO_URL,
    previewUrl: process.env.FLOWPR_PREVIEW_URL,
    baseBranch: process.env.FLOWPR_BASE_BRANCH ?? 'main',
    flowGoal: process.env.FLOWPR_FLOW_GOAL,
    riskLevel: process.env.FLOWPR_RISK_LEVEL ?? 'medium',
  };

  for (const key of ['repoUrl', 'previewUrl', 'flowGoal']) {
    if (!input[key]) {
      throw new Error(`Missing required env FLOWPR_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
    }
  }

  const response = await fetch(`${DASHBOARD_URL}/api/runs/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error ?? `FlowPR dashboard returned ${response.status}`);
  }

  console.log(JSON.stringify({ runId: body.run.id, status: body.run.status, warnings: body.warnings ?? [] }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
