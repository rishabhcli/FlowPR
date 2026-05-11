import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadLocalEnv } from '@flowpr/tools/env';
import {
  describeAgentVersion,
  recordGuildBenchmark,
  guildPromotionSuiteName,
} from '@flowpr/tools/guildai';

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
  expectedEvidence?: {
    providers: string[];
    artifacts: string[];
    signals: string[];
  };
  expectedDiagnosis?: {
    bugType: string;
    severity: string;
    likelyFiles: string[];
  };
  expectedPatch?: {
    filesChanged: string[];
    regressionTest?: string;
  };
  expectedReadiness?: {
    overall: string;
    requiredSignals: string[];
  };
  expectedRecovery?: {
    signals: string[];
    nextActions: string[];
    commands: string[];
  };
  verification?: {
    command: string;
    testName?: string;
    successCondition: string;
  };
  fixtures: Record<string, unknown>;
}

interface VerificationCommandResult {
  command: string;
  status: 'passed' | 'failed';
  durationMs: number;
  output: string;
}

function readCliOption(name: string): string | undefined {
  const longName = `--${name}`;
  const inlinePrefix = `${longName}=`;
  const inline = process.argv.find((arg) => arg.startsWith(inlinePrefix));

  if (inline) return inline.slice(inlinePrefix.length);

  const index = process.argv.indexOf(longName);
  if (index >= 0) return process.argv[index + 1];

  return undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function runVerificationCommand(command: string): VerificationCommandResult {
  const startedAt = Date.now();
  console.log(`Running benchmark verification: ${command}`);
  const result = spawnSync(command, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    shell: true,
    stdio: 'pipe',
  });
  const durationMs = Date.now() - startedAt;
  const status = result.status === 0 ? 'passed' : 'failed';
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';
  const output = `${stdout}\n${stderr}`.trim();

  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  console.log(`Benchmark verification ${status}: ${command} (${durationMs}ms)`);

  return { command, status, durationMs, output };
}

const validRiskLevels = new Set(['low', 'medium', 'high', 'critical']);

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

const agentVersion = readCliOption('agent-version') ?? process.env.FLOWPR_AGENT_VERSION ?? agent.version;

if (!agent.agent || !agentVersion || !agent.permissionProfile) {
  throw new Error('guild-agent.json must include agent, version, and permissionProfile, unless --agent-version is provided.');
}

if (missingCapabilities.length > 0) {
  throw new Error(`guild-agent.json is missing capabilities: ${missingCapabilities.join(', ')}`);
}

if (!agent.approvalRequiredFor?.includes('protected_branch')) {
  throw new Error('guild-agent.json must require approval for protected_branch.');
}

const suite = readCliOption('suite') ?? process.env.FLOWPR_BENCHMARK_SUITE ?? guildPromotionSuiteName;
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
  version: agentVersion,
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

const verificationCommands = Array.from(
  new Set(fixtures.map((fixture) => fixture.verification?.command).filter(nonEmptyString)),
);
const verificationResults = new Map<string, VerificationCommandResult>();

for (const command of verificationCommands) {
  const result = runVerificationCommand(command);
  verificationResults.set(command, result);
}

let passed = 0;
let failed = 0;
const perFixture: Array<{ name: string; expected: string; status: 'passed' | 'failed'; reason: string }> = [];

for (const fixture of fixtures) {
  const missing: string[] = [];
  const expectedFiles = Array.isArray(fixture.expectedPatch?.filesChanged)
    ? fixture.expectedPatch.filesChanged
    : Array.isArray(fixture.fixtures?.expectedFilesChanged)
      ? fixture.fixtures.expectedFilesChanged
      : [];

  if (!nonEmptyString(fixture.name)) missing.push('name');
  if (!nonEmptyString(fixture.flowGoal)) missing.push('flowGoal');
  if (!nonEmptyString(fixture.expectedBugType)) missing.push('expectedBugType');
  if (!nonEmptyString(fixture.successCondition)) missing.push('successCondition');
  if (!validRiskLevels.has(fixture.riskLevel)) missing.push('riskLevel');

  const hasFixturePayload = fixture.fixtures && typeof fixture.fixtures === 'object';
  if (!hasFixturePayload) missing.push('fixtures');
  if (!nonEmptyString(fixture.fixtures?.previewUrl)) missing.push('fixtures.previewUrl');

  const hasViewport = fixture.viewport &&
    typeof fixture.viewport === 'object' &&
    typeof fixture.viewport.width === 'number' &&
    typeof fixture.viewport.height === 'number';
  if (!hasViewport) missing.push('viewport.width_height');

  const hasEvidenceContract =
    nonEmptyArray(fixture.expectedEvidence?.providers) &&
    nonEmptyArray(fixture.expectedEvidence.artifacts) &&
    nonEmptyArray(fixture.expectedEvidence.signals);
  if (!hasEvidenceContract) missing.push('expectedEvidence');

  const hasDiagnosisContract =
    fixture.expectedDiagnosis?.bugType === fixture.expectedBugType &&
    nonEmptyString(fixture.expectedDiagnosis.severity) &&
    nonEmptyArray(fixture.expectedDiagnosis.likelyFiles);
  if (!hasDiagnosisContract) missing.push('expectedDiagnosis');

  const hasPatchContract =
    Array.isArray(expectedFiles) &&
    expectedFiles.length > 0 &&
    (nonEmptyString(fixture.expectedPatch?.regressionTest) || fixture.riskLevel !== 'critical');
  if (!hasPatchContract) missing.push('expectedPatch');

  const hasVerificationContract =
    nonEmptyString(fixture.verification?.command) &&
    nonEmptyString(fixture.verification.testName) &&
    nonEmptyString(fixture.verification.successCondition);
  if (!hasVerificationContract) missing.push('verification');

  const runtimeRecoveryFixture = fixture.fixtures?.category === 'runtime-recovery';
  if (runtimeRecoveryFixture) {
    const hasReadinessContract =
      nonEmptyString(fixture.expectedReadiness?.overall) &&
      nonEmptyArray(fixture.expectedReadiness.requiredSignals);
    if (!hasReadinessContract) missing.push('expectedReadiness');

    const hasRecoveryContract =
      nonEmptyArray(fixture.expectedRecovery?.signals) &&
      nonEmptyArray(fixture.expectedRecovery.nextActions) &&
      nonEmptyArray(fixture.expectedRecovery.commands);
    if (!hasRecoveryContract) missing.push('expectedRecovery');
  }

  const verificationResult = nonEmptyString(fixture.verification?.command)
    ? verificationResults.get(fixture.verification.command)
    : undefined;
  if (hasVerificationContract && verificationResult?.status !== 'passed') {
    missing.push(`verification.command:${fixture.verification.command}`);
  }

  if (
    hasVerificationContract &&
    verificationResult?.status === 'passed' &&
    fixture.verification?.testName &&
    !verificationResult.output.includes(fixture.verification.testName)
  ) {
    missing.push(`verification.testName:${fixture.verification.testName}`);
  }

  const status = missing.length === 0
    ? 'passed'
    : 'failed';

  if (status === 'passed') passed += 1;
  else failed += 1;

  perFixture.push({
    name: fixture.name,
    expected: fixture.expectedBugType,
    status,
    reason: status === 'passed'
      ? runtimeRecoveryFixture
        ? 'Fixture defines metadata, evidence, diagnosis, patch signature, verification, readiness, recovery guidance, viewport, payload contracts, and a named executable test that ran.'
        : 'Fixture defines metadata, evidence, diagnosis, patch signature, verification, viewport, payload contracts, and a named executable test that ran.'
      : `Missing contract fields: ${missing.join(', ')}.`,
  });
}

const metrics = {
  fixtureCount: fixtures.length,
  passed,
  failed,
  verificationCommandCount: verificationResults.size,
  verificationCommandsPassed: Array.from(verificationResults.values()).filter((result) => result.status === 'passed').length,
  verificationCommandsFailed: Array.from(verificationResults.values()).filter((result) => result.status === 'failed').length,
  bug_reproduced_rate: passed / fixtures.length,
  verified_fix_rate: passed / fixtures.length,
  avg_files_changed: Math.round(
    (fixtures.reduce((acc, fixture) => {
      const files = fixture.expectedPatch?.filesChanged
        ?? (fixture.fixtures?.expectedFilesChanged as unknown[] | undefined)
        ?? [];
      return acc + files.length;
    }, 0) / fixtures.length) * 10,
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
  console.log(`  - ${entry.name}: ${entry.status} (${entry.expected}) - ${entry.reason}`);
}

if (suite === guildPromotionSuiteName && result.promoted) {
  console.log(`FlowPR agent version ${descriptor.version} is promoted for ${suite}.`);
} else if (suite === guildPromotionSuiteName) {
  console.log(`FlowPR agent version ${descriptor.version} is NOT promoted (failing or zero-pass benchmark).`);
} else {
  console.log(`Benchmark "${suite}" recorded as a non-promotion quality gate for FlowPR agent version ${descriptor.version}.`);
}

if (failed > 0) {
  process.exitCode = 1;
}
