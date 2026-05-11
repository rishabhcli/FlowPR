import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  listDeadLetterEntries,
  listWorkerHeartbeats,
} from '@flowpr/tools/redis';
import { listRecentRuns } from '@flowpr/tools/insforge';
import { classifyStuckRuns, isRecoverableActiveRunStatus } from '@flowpr/tools/recovery';
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

interface DeadLetterEntry {
  id: string;
  runId?: string;
  createdAt?: string;
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

function isDeadLetterResolved(entry: DeadLetterEntry, run: FlowPrRun | undefined): boolean {
  if (!run) return true;
  if (run.status !== 'done' && run.status !== 'learned') return false;

  const deadLetterTs = new Date(entry.createdAt ?? '').getTime();
  const resolutionTs = new Date(run.completedAt ?? run.updatedAt ?? '').getTime();

  if (!Number.isFinite(deadLetterTs) || !Number.isFinite(resolutionTs)) {
    return true;
  }

  return resolutionTs >= deadLetterTs;
}

export async function GET() {
  const redis = createFlowPrRedisClient();
  let runs: FlowPrRun[] = [];
  let workersAlive = 0;
  let workerCount = 0;
  let activeWorkerRunId: string | undefined;
  let activeWorkerPhase: string | undefined;
  let deadLetterCount = 0;
  let deadLetterTotal = 0;
  let deadLetterResolved = 0;
  let deadLetterOrphaned = 0;
  let mostRecentDeadLetter: string | undefined;
  let stuckRuns: ReturnType<typeof classifyStuckRuns> = [];
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
    const runsById = new Map(runs.map((run) => [run.id, run]));
    workerCount = heartbeats.length;
    const workerSignals = heartbeats.map((beat) => {
      const lastBeatMs = new Date(beat.lastBeat).getTime();
      const ageMs = Number.isFinite(lastBeatMs)
        ? now - lastBeatMs
        : Number.POSITIVE_INFINITY;
      return {
        ...beat,
        ageMs,
        alive: ageMs <= 30000,
      };
    });

    for (const beat of heartbeats) {
      const lastBeatMs = new Date(beat.lastBeat).getTime();
      const ageMs = Number.isFinite(lastBeatMs)
        ? now - lastBeatMs
        : Number.POSITIVE_INFINITY;
      if (ageMs <= 30000) {
        workersAlive += 1;
        const currentRunStatus = beat.currentRunId
          ? runsById.get(beat.currentRunId)?.status
          : undefined;
        if (
          beat.currentRunId &&
          isRecoverableActiveRunStatus(currentRunStatus) &&
          !activeWorkerRunId
        ) {
          activeWorkerRunId = beat.currentRunId;
          activeWorkerPhase = beat.currentPhase;
        }
      }
    }

    stuckRuns = classifyStuckRuns(runs, workerSignals, { nowMs: now });

    const dl = await listDeadLetterEntries(redis, 50);
    deadLetterTotal = dl.length;
    for (const entry of dl) {
      const deadLetter = {
        id: entry.id,
        runId: entry.fields.runId,
        createdAt: entry.fields.createdAt,
      };
      const run = deadLetter.runId ? runsById.get(deadLetter.runId) : undefined;
      if (!run) {
        deadLetterOrphaned += 1;
      }
      if (isDeadLetterResolved(deadLetter, run)) {
        deadLetterResolved += 1;
        continue;
      }

      deadLetterCount += 1;
      if (!mostRecentDeadLetter) {
        mostRecentDeadLetter = deadLetter.runId ?? deadLetter.id;
      }
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
      total: deadLetterTotal,
      resolved: deadLetterResolved,
      orphaned: deadLetterOrphaned,
      mostRecentRunId: mostRecentDeadLetter,
    },
    recovery: {
      stuckCount: stuckRuns.length,
      stuckRuns: stuckRuns.slice(0, 5),
      oldestStuckRunId: stuckRuns[0]?.id,
      actionSummary: stuckRuns[0]?.nextAction,
    },
    redisError,
  });
}
