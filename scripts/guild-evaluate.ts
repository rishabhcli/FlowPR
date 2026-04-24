import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLocalEnv } from '@flowpr/tools';

loadLocalEnv();

const agentPath = join(process.cwd(), 'guild-agent.json');
const agent = JSON.parse(readFileSync(agentPath, 'utf8')) as {
  agent?: string;
  version?: string;
  permissionProfile?: string;
  capabilities?: string[];
  approvalRequiredFor?: string[];
};

const requiredCapabilities = [
  'browser_evidence',
  'repo_read',
  'patch_generation',
  'local_verification',
  'draft_pull_request',
];
const missingCapabilities = requiredCapabilities.filter(
  (capability) => !agent.capabilities?.includes(capability),
);

if (!agent.agent || !agent.version || !agent.permissionProfile) {
  throw new Error('guild-agent.json must include agent, version, and permissionProfile.');
}

if (missingCapabilities.length > 0) {
  throw new Error(`guild-agent.json is missing capabilities: ${missingCapabilities.join(', ')}`);
}

if (!agent.approvalRequiredFor?.includes('protected_branch')) {
  throw new Error('guild-agent.json must require approval for protected_branch.');
}

console.log(`Guild agent metadata valid: ${agent.agent}@${agent.version}`);
console.log(`Permission profile: ${agent.permissionProfile}`);

if (process.env.GUILD_AI_API_KEY) {
  console.log('Guild live API key configured for control-plane integration.');
} else if (process.env.GUILD_GITHUB_APP_INSTALLED === 'true') {
  console.log('Guild GitHub app marked installed; live API key is not configured.');
} else {
  throw new Error('Configure GUILD_AI_API_KEY or set GUILD_GITHUB_APP_INSTALLED=true.');
}
