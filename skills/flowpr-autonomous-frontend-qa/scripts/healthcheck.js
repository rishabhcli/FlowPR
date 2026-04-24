const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const skillDir = join(__dirname, '..');
const required = [
  'SKILL.md',
  'shipables.json',
  'references/sponsor-map.md',
  'references/state-machine.md',
  'references/pr-template.md',
  'references/guild-agent.md',
  'references/benchmark-suite.md',
  'references/demo-runbook.md',
  'scripts/run-flow-test.js',
  'scripts/create-pr.js',
  'scripts/verify-fix.js',
];
const missing = required.filter((file) => !existsSync(join(skillDir, file)));

if (missing.length > 0) {
  throw new Error(`FlowPR skill is missing required files: ${missing.join(', ')}`);
}

const manifest = JSON.parse(readFileSync(join(skillDir, 'shipables.json'), 'utf8'));
const env = manifest.config?.env ?? [];
const requiredEnv = env.filter((entry) => entry.required).map((entry) => entry.name);

for (const name of ['TINYFISH_API_KEY', 'REDIS_URL', 'INSFORGE_API_URL']) {
  if (!requiredEnv.includes(name)) {
    throw new Error(`shipables.json must require ${name}`);
  }
}

const hasGitHubToken = requiredEnv.includes('GITHUB_TOKEN');
const hasGitHubApp = requiredEnv.includes('GITHUB_APP_ID') && requiredEnv.includes('GITHUB_APP_PRIVATE_KEY');

if (!hasGitHubToken && !hasGitHubApp) {
  throw new Error('shipables.json must require either GITHUB_TOKEN or GitHub App credentials');
}

if (!manifest.entrypoints?.run_flow_test) {
  throw new Error('shipables.json must declare run_flow_test entrypoint');
}

console.log(`FlowPR skill dry run ok: ${required.join(', ')}`);
