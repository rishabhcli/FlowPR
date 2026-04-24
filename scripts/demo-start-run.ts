import { loadLocalEnv } from '@flowpr/tools';

loadLocalEnv();

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const response = await fetch(`${appUrl.replace(/\/+$/, '')}/api/runs/start`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    repoUrl: process.env.FLOWPR_DEMO_REPO_URL ?? 'https://github.com/rishabhcli/FlowPR',
    previewUrl: process.env.FLOWPR_DEMO_PREVIEW_URL ?? 'http://localhost:3100',
    baseBranch: process.env.FLOWPR_DEMO_BASE_BRANCH ?? 'main',
    flowGoal:
      process.env.FLOWPR_DEMO_FLOW_GOAL ??
      'On mobile, choose Pro on pricing, complete checkout, and reach success.',
    riskLevel: process.env.FLOWPR_DEMO_RISK_LEVEL ?? 'medium',
    permissionProfile: process.env.FLOWPR_DEMO_PERMISSION_PROFILE ?? 'draft-pr-only',
  }),
});
const body = await response.json();

if (!response.ok) {
  throw new Error(body.error ?? `Start run failed with ${response.status}`);
}

console.log(`FlowPR run created: ${body.run.id}`);
console.log(`Status: ${body.run.status}`);

if (body.event?.streamId) {
  console.log(`Redis stream event: ${body.event.streamId}`);
}

if (body.warnings?.length) {
  console.log(`Warnings: ${body.warnings.join(' ')}`);
}
