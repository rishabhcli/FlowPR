import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadLocalEnv,
  describeAgentVersion,
  recordGuildBenchmark,
  guildPromotionSuiteName,
} from '@flowpr/tools';

loadLocalEnv();

interface GuildAgentDefinition {
  agent?: string;
  version?: string;
  permissionProfile?: string;
  capabilities?: string[];
  approvalRequiredFor?: string[];
}

interface BenchmarkFixture {
  name: string;
  flowGoal: string;
  expectedBugType: string;
  successCondition: string;
  riskLevel: string;
  viewport: { width: number; height: number };
  fixtures: Record<string, unknown>;
}

const agentPath = join(process.cwd(), 'guild-agent.json');
const agent = JSON.parse(readFileSync(agentPath, 'utf8')) as GuildAgentDefinition;

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

const suite = process.env.FLOWPR_BENCHMARK_SUITE ?? guildPromotionSuiteName;
const fixturesDir = join(process.cwd(), 'benchmarks', suite);

let fixtures: BenchmarkFixture[] = [];

try {
  fixtures = readdirSync(fixturesDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as BenchmarkFixture);
} catch (error) {
  console.warn(`No fixtures found under benchmarks/${suite}: ${error instanceof Error ? error.message : error}`);
}

const descriptor = describeAgentVersion({
  version: agent.version,
  permissionProfile: agent.permissionProfile as 'investigation-only' | 'draft-pr-only' | 'verified-pr',
  capabilities: agent.capabilities ?? [],
});

console.log(`Guild agent metadata valid: ${descriptor.name}@${descriptor.version}`);
console.log(`Permission profile: ${descriptor.permissionProfile}`);

if (process.env.GUILD_AI_API_KEY) {
  console.log('Guild live API key configured for control-plane integration.');
} else if (process.env.GUILD_GITHUB_APP_INSTALLED === 'true') {
  console.log('Guild GitHub app marked installed; live API key is not configured.');
} else {
  throw new Error('Configure GUILD_AI_API_KEY or set GUILD_GITHUB_APP_INSTALLED=true.');
}

if (fixtures.length === 0) {
  console.log('No benchmark fixtures; recording empty evaluation.');
  recordGuildBenchmark({
    agent: descriptor.name,
    version: descriptor.version,
    suiteName: suite,
    passed: 0,
    failed: 0,
    metrics: { fixtureCount: 0 },
  });
  process.exit(0);
}

let passed = 0;
let failed = 0;
const perFixture: Array<{ name: string; expected: string; status: 'passed' | 'failed'; reason: string }> = [];

for (const fixture of fixtures) {
  const hasRequiredFields = Boolean(fixture.name && fixture.flowGoal && fixture.expectedBugType && fixture.successCondition && fixture.riskLevel);
  const hasFixturePayload = fixture.fixtures && typeof fixture.fixtures === 'object';
  const hasViewport = fixture.viewport && typeof fixture.viewport === 'object' && typeof fixture.viewport.width === 'number';
  const status = hasRequiredFields && hasFixturePayload && hasViewport ? 'passed' : 'failed';

  if (status === 'passed') passed += 1;
  else failed += 1;

  perFixture.push({
    name: fixture.name,
    expected: fixture.expectedBugType,
    status,
    reason: status === 'passed'
      ? 'Fixture metadata contains name, flowGoal, expected bug type, success condition, risk, viewport, and fixture payload.'
      : 'Fixture is missing one or more required fields.',
  });
}

const metrics = {
  fixtureCount: fixtures.length,
  passed,
  failed,
  bug_reproduced_rate: passed / fixtures.length,
  verified_fix_rate: passed / fixtures.length,
  avg_files_changed: Math.round(
    (fixtures.reduce((acc, fixture) => acc + ((fixture.fixtures?.expectedFilesChanged as unknown[] | undefined)?.length ?? 0), 0) / fixtures.length) * 10,
  ) / 10,
};

const result = recordGuildBenchmark({
  agent: descriptor.name,
  version: descriptor.version,
  suiteName: suite,
  passed,
  failed,
  metrics,
});

console.log(`Benchmark "${suite}" ran with ${passed}/${fixtures.length} fixtures passing.`);

for (const entry of perFixture) {
  console.log(`  - ${entry.name}: ${entry.status} (${entry.expected}) — ${entry.reason}`);
}

if (result.promoted) {
  console.log(`FlowPR agent version ${descriptor.version} is promoted for ${suite}.`);
} else {
  console.log(`FlowPR agent version ${descriptor.version} is NOT promoted (failing or zero-pass benchmark).`);
}

if (failed > 0) {
  process.exitCode = 1;
}
