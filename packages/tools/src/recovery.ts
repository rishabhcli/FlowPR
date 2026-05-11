import type { FlowPrRun, RunStatus } from '@flowpr/schemas';

const DEFAULT_STUCK_RUN_MS = 5 * 60 * 1000;

const ACTIVE_RECOVERY_STATUSES = new Set<RunStatus>([
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

export function isRecoverableActiveRunStatus(status: string | undefined): status is RunStatus {
  return ACTIVE_RECOVERY_STATUSES.has(status as RunStatus);
}

type RecoveryRun = Pick<FlowPrRun, 'id' | 'status' | 'flowGoal' | 'createdAt' | 'updatedAt' | 'startedAt'>;

export interface RecoveryWorkerSignal {
  workerId?: string;
  currentRunId?: string;
  currentPhase?: string;
  lastBeat?: string;
  ageMs?: number;
  alive: boolean;
}

export interface StuckRunRecoverySignal {
  id: string;
  status: RunStatus;
  flowGoal: string;
  updatedAt: string;
  ageMs: number;
  reason: string;
  nextAction: string;
  workerId?: string;
  workerPhase?: string;
}

export interface DeadLetterRecoveryInput {
  id: string;
  runId?: string;
  runStatus?: string;
  phase?: string;
  eventType?: string;
  error?: string;
  orphaned?: boolean;
  resolved?: boolean;
}

function recoveryCommand(runId: string): string {
  return `pnpm run:replay ${runId} --fail-on-not-ready`;
}

function runReferenceTime(run: RecoveryRun): string {
  return run.updatedAt ?? run.startedAt ?? run.createdAt;
}

function elapsedMs(value: string | undefined, nowMs: number): number {
  const timestamp = new Date(value ?? '').getTime();
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - timestamp);
}

export function classifyStuckRuns(
  runs: RecoveryRun[],
  workers: RecoveryWorkerSignal[],
  options: { nowMs?: number; stuckRunMs?: number } = {},
): StuckRunRecoverySignal[] {
  const nowMs = options.nowMs ?? Date.now();
  const stuckRunMs = options.stuckRunMs ?? DEFAULT_STUCK_RUN_MS;
  const aliveWorkerRunIds = new Set(
    workers
      .filter((worker) => worker.alive && worker.currentRunId)
      .map((worker) => worker.currentRunId as string),
  );
  const aliveWorkers = workers.filter((worker) => worker.alive);

  return runs
    .filter((run) => isRecoverableActiveRunStatus(run.status))
    .flatMap((run) => {
      const reference = runReferenceTime(run);
      const ageMs = elapsedMs(reference, nowMs);
      if (ageMs < stuckRunMs || aliveWorkerRunIds.has(run.id)) {
        return [];
      }

      const staleWorker = workers.find((worker) => worker.currentRunId === run.id && !worker.alive);
      const reason = staleWorker
        ? `Worker ${staleWorker.workerId ?? 'unknown'} stopped heartbeating while handling ${run.status}.`
        : aliveWorkers.length === 0
          ? 'No live worker heartbeat is available to advance this active run.'
          : 'No live worker is currently claiming this active run.';
      const nextAction = aliveWorkers.length === 0
        ? `${recoveryCommand(run.id)}, then restart the worker with pnpm worker:dev.`
        : `${recoveryCommand(run.id)}, then inspect /health worker and dead-letter rows before retrying.`;

      return [{
        id: run.id,
        status: run.status,
        flowGoal: run.flowGoal,
        updatedAt: reference,
        ageMs,
        reason,
        nextAction,
        workerId: staleWorker?.workerId,
        workerPhase: staleWorker?.currentPhase,
      }];
    })
    .sort((a, b) => b.ageMs - a.ageMs);
}

export function buildDeadLetterNextAction(entry: DeadLetterRecoveryInput): string {
  const label = entry.runId ? recoveryCommand(entry.runId) : 'inspect the Redis dead-letter stream';

  if (entry.resolved) {
    return entry.runId
      ? `Historical only: ${label} if you need to audit the prior failure.`
      : 'Historical orphan: inspect the Redis dead-letter stream only if this event repeats.';
  }

  if (entry.orphaned || !entry.runId) {
    return 'Find the missing run in InsForge or the local fallback store, then decide whether to replay or discard the orphaned Redis event.';
  }

  if (entry.runStatus === 'failed') {
    return `${label}, then inspect the failed phase and provider artifact before starting a replacement run.`;
  }

  if (entry.runStatus === 'done' || entry.runStatus === 'learned') {
    return `${label}; this should become historical once the run completion timestamp is newer than the dead-letter event.`;
  }

  return `${label}, then restart or continue the worker only after the dead-letter reason is understood.`;
}
