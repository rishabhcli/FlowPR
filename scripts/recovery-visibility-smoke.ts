import assert from 'node:assert/strict';
import type { FlowPrRun } from '@flowpr/schemas';
import {
  buildDeadLetterNextAction,
  classifyStuckRuns,
} from '@flowpr/tools/recovery';

const nowMs = new Date('2026-05-11T12:00:00.000Z').getTime();

function run(input: Partial<FlowPrRun> & Pick<FlowPrRun, 'id' | 'status'>): FlowPrRun {
  return {
    projectId: 'local',
    repoUrl: 'https://github.com/rishabhcli/FlowPR',
    owner: 'rishabhcli',
    repo: 'FlowPR',
    baseBranch: 'main',
    previewUrl: 'http://localhost:3100',
    flowGoal: 'Complete checkout on mobile.',
    riskLevel: 'medium',
    permissionProfile: 'investigation-only',
    agentName: 'flowpr-autonomous-frontend-qa',
    agentVersion: 'smoke',
    createdAt: '2026-05-11T11:40:00.000Z',
    updatedAt: '2026-05-11T11:40:00.000Z',
    ...input,
  };
}

const stuck = classifyStuckRuns(
  [
    run({ id: 'active-without-worker', status: 'running_browser_qa' }),
    run({
      id: 'active-with-worker',
      status: 'patching_code',
      updatedAt: '2026-05-11T11:30:00.000Z',
    }),
    run({ id: 'recent-active', status: 'running_local_tests', updatedAt: '2026-05-11T11:59:30.000Z' }),
    run({ id: 'done-run', status: 'done', updatedAt: '2026-05-11T11:00:00.000Z' }),
  ],
  [
    {
      workerId: 'worker-stale',
      currentRunId: 'active-without-worker',
      currentPhase: 'running_browser_qa',
      ageMs: 90_000,
      alive: false,
    },
    {
      workerId: 'worker-live',
      currentRunId: 'active-with-worker',
      currentPhase: 'patching_code',
      ageMs: 2_000,
      alive: true,
    },
  ],
  { nowMs, stuckRunMs: 60_000 },
);

assert.equal(stuck.length, 1);
assert.equal(stuck[0].id, 'active-without-worker');
assert.match(stuck[0].reason, /stopped heartbeating/);
assert.match(stuck[0].nextAction, /pnpm run:replay active-without-worker --fail-on-not-ready/);

const noWorkers = classifyStuckRuns(
  [run({ id: 'queued-too-long', status: 'queued' })],
  [],
  { nowMs, stuckRunMs: 60_000 },
);
assert.equal(noWorkers.length, 1);
assert.match(noWorkers[0].nextAction, /restart the worker with pnpm worker:dev/);

assert.match(
  buildDeadLetterNextAction({
    id: 'dl-1',
    runId: 'failed-run',
    runStatus: 'failed',
    phase: 'patching_code',
    resolved: false,
  }),
  /pnpm run:replay failed-run --fail-on-not-ready/,
);

assert.match(
  buildDeadLetterNextAction({
    id: 'dl-orphan',
    orphaned: true,
    resolved: false,
  }),
  /missing run/,
);

assert.match(
  buildDeadLetterNextAction({
    id: 'dl-resolved',
    runId: 'done-run',
    runStatus: 'done',
    resolved: true,
  }),
  /Historical only/,
);

console.log('Recovery visibility smoke ok.');
