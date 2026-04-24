import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  listDeadLetterEntries,
  listRecentRuns,
  listWorkerHeartbeats,
} from '@flowpr/tools';
import type { FlowPrRun, RunStatus } from '@flowpr/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

const TERMINAL_STATUSES = new Set<RunStatus>(['done', 'failed', 'learned']);
const FAILED_STATUSES = new Set<RunStatus>(['failed']);
const ACTIVE_STATUSES = new Set<RunStatus>([
  'queued',
  'loading_repo',
  'discovering_flows',
  'running_browser_qa',
  'collecting_visual_evidence',
  'triaging_failure',
  'retrieving_policy',
  'searching_memory',
  'patching_code',
  'running_local_tests',
  'running_live_verification',
  'creating_pr',
  'publishing_artifacts',
]);

interface RunBuckets {
  active: number;
  queued: number;
  done24h: number;
  failed24h: number;
  total24h: number;
  durations: number[];
}

function bucketRuns(runs: FlowPrRun[]): RunBuckets {
  const cutoff = Date.now() - DAY_MS;
  const buckets: RunBuckets = {
    active: 0,
    queued: 0,
    done24h: 0,
    failed24h: 0,
    total24h: 0,
    durations: [],
  };

  for (const run of runs) {
    if (run.status === 'queued') buckets.queued += 1;
    if (ACTIVE_STATUSES.has(run.status)) buckets.active += 1;

    const reference = run.completedAt ?? run.updatedAt ?? run.createdAt;
    const referenceTs = new Date(reference).getTime();
    if (!Number.isFinite(referenceTs) || referenceTs < cutoff) continue;

    if (TERMINAL_STATUSES.has(run.status)) {
      buckets.total24h += 1;
      if (FAILED_STATUSES.has(run.status)) {
        buckets.failed24h += 1;
      } else {
        buckets.done24h += 1;
        if (run.startedAt && run.completedAt) {
          const duration =
            new Date(run.completedAt).getTime() -
            new Date(run.startedAt).getTime();
          if (Number.isFinite(duration) && duration > 0) {
            buckets.durations.push(duration);
          }
        }
      }
    }
  }

  return buckets;
}

export async function GET() {
  const redis = createFlowPrRedisClient();
  let runs: FlowPrRun[] = [];
  let workersAlive = 0;
  let workerCount = 0;
  let activeWorkerRunId: string | undefined;
  let activeWorkerPhase: string | undefined;
  let deadLetterCount = 0;
  let mostRecentDeadLetter: string | undefined;
  let runsError: string | undefined;
  let redisError: string | undefined;

  try {
    runs = await listRecentRuns(50);
  } catch (error) {
    runsError = error instanceof Error ? error.message : String(error);
  }

  try {
    await connectFlowPrRedisClient(redis);
    const heartbeats = await listWorkerHeartbeats(redis);
    const now = Date.now();
    workerCount = heartbeats.length;
    for (const beat of heartbeats) {
      const lastBeatMs = new Date(beat.lastBeat).getTime();
      const ageMs = Number.isFinite(lastBeatMs)
        ? now - lastBeatMs
        : Number.POSITIVE_INFINITY;
      if (ageMs <= 30000) {
        workersAlive += 1;
        if (beat.currentRunId && !activeWorkerRunId) {
          activeWorkerRunId = beat.currentRunId;
          activeWorkerPhase = beat.currentPhase;
        }
      }
    }
    const dl = await listDeadLetterEntries(redis, 5);
    deadLetterCount = dl.length;
    if (dl[0]) {
      mostRecentDeadLetter = dl[0].fields.runId ?? dl[0].id;
    }
  } catch (error) {
    redisError = error instanceof Error ? error.message : String(error);
  } finally {
    if (redis.isOpen) {
      await redis.quit().catch(() => undefined);
    }
  }

  const buckets = bucketRuns(runs);
  const successRate24h =
    buckets.total24h > 0 ? buckets.done24h / buckets.total24h : null;
  const meanDurationMs =
    buckets.durations.length > 0
      ? buckets.durations.reduce((sum, value) => sum + value, 0) /
        buckets.durations.length
      : null;
  const lastRun = runs[0]
    ? {
        id: runs[0].id,
        status: runs[0].status,
        flowGoal: runs[0].flowGoal,
        updatedAt: runs[0].updatedAt,
      }
    : null;

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    runs: {
      active: buckets.active,
      queued: buckets.queued,
      done24h: buckets.done24h,
      failed24h: buckets.failed24h,
      total24h: buckets.total24h,
      successRate24h,
      meanDurationMs,
      lastRun,
      error: runsError,
    },
    workers: {
      alive: workersAlive,
      total: workerCount,
      activeRunId: activeWorkerRunId,
      activePhase: activeWorkerPhase,
    },
    deadLetter: {
      count: deadLetterCount,
      mostRecentRunId: mostRecentDeadLetter,
    },
    redisError,
  });
}
