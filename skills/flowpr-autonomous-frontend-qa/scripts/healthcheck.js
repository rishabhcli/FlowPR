const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const skillDir = join(__dirname, '..');
const required = ['SKILL.md', 'shipables.json', 'references/sponsor-map.md'];
const missing = required.filter((file) => !existsSync(join(skillDir, file)));

if (missing.length > 0) {
  throw new Error(`FlowPR skill is missing required files: ${missing.join(', ')}`);
}

const manifest = JSON.parse(readFileSync(join(skillDir, 'shipables.json'), 'utf8'));
const env = manifest.config?.env ?? [];
const requiredEnv = env.filter((entry) => entry.required).map((entry) => entry.name);

for (const name of ['TINYFISH_API_KEY', 'REDIS_URL', 'INSFORGE_API_URL', 'GITHUB_TOKEN']) {
  if (!requiredEnv.includes(name)) {
    throw new Error(`shipables.json must require ${name}`);
  }
}

console.log(`FlowPR skill dry run ok: ${required.join(', ')}`);
