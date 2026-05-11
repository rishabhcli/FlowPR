import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getMissingRecommendedEnv,
  getMissingRequiredEnv,
  loadLocalEnv,
} from '@flowpr/tools/env';
import {
  appendTimelineEvent,
  recordProviderArtifact,
  updateAgentSessionsForRun,
  updateRunStatus,
} from '@flowpr/tools/insforge';
import {
  ackEvent,
  claimStaleEvents,
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  ensureFlowPrConsumerGroups,
  moveToDeadLetter,
  readRunEvents,
  retryRedisEvent,
  writeWorkerHeartbeat,
  type FlowPrRedisEvent,
} from '@flowpr/tools/redis';
import { describeRedisEventFailure, processRedisEvent } from './state-machine';

const maxAttempts = 3;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function markDeadLetter(event: FlowPrRedisEvent, deadLetterStreamId: string, error: unknown): Promise<void> {
  try {
    await updateRunStatus(event.runId, 'failed', {
      failureSummary: getErrorMessage(error),
    });
    await updateAgentSessionsForRun(event.runId, 'failed', {
      stream: event.stream,
      streamId: event.id,
      deadLetterStreamId,
      error: getErrorMessage(error),
    });
    await appendTimelineEvent({
      runId: event.runId,
      actor: 'redis',
      phase: 'dead_letter',
      status: 'failed',
      title: 'Redis moved an event to the dead-letter stream.',
      data: {
        ...describeRedisEventFailure(event, error),
        deadLetterStream: 'flowpr:dead_letter',
        deadLetterStreamId,
      },
    });
    await recordProviderArtifact({
      runId: event.runId,
      sponsor: 'redis',
      artifactType: 'dead_letter_event',
      providerId: deadLetterStreamId,
      requestSummary: {
        sourceStream: event.stream,
        streamId: event.id,
        eventType: event.eventType,
        phase: event.phase,
      },
      responseSummary: {
        attempt: event.attempt,
        error: getErrorMessage(error),
      },
      raw: {
        event,
      },
    });
  } catch {
    // The Redis dead-letter record is the durable failure source of truth if InsForge writes fail.
  }
}

async function markRetry(event: FlowPrRedisEvent, retryStreamId: string, error: unknown): Promise<void> {
  try {
    await appendTimelineEvent({
      runId: event.runId,
      actor: 'redis',
      phase: event.phase ?? 'retry',
      status: 'info',
      title: 'Redis requeued an event for retry.',
      data: {
        ...describeRedisEventFailure(event, error),
        retryStreamId,
        nextAttempt: event.attempt + 1,
      },
    });
    await recordProviderArtifact({
      runId: event.runId,
      sponsor: 'redis',
      artifactType: 'retry_event',
      providerId: retryStreamId,
      requestSummary: {
        sourceStream: event.stream,
        streamId: event.id,
        eventType: event.eventType,
        phase: event.phase,
      },
      responseSummary: {
        previousAttempt: event.attempt,
        nextAttempt: event.attempt + 1,
        error: getErrorMessage(error),
      },
      raw: {
        event,
      },
    });
  } catch {
    // Retry is still durable in Redis if the dashboard metadata write fails.
  }
}

async function handleWorkerFailure(redis: ReturnType<typeof createFlowPrRedisClient>, event: FlowPrRedisEvent, error: unknown) {
  if (event.attempt >= maxAttempts) {
    const deadLetterStreamId = await moveToDeadLetter(redis, event, error);
    await ackEvent(redis, event);
    await markDeadLetter(event, deadLetterStreamId, error);
    console.error(JSON.stringify({
      component: 'flowpr-worker',
      event: 'dead_letter',
      runId: event.runId,
      stream: event.stream,
      streamId: event.id,
      deadLetterStreamId,
      error: getErrorMessage(error),
    }));
    return;
  }

  const retryStreamId = await retryRedisEvent(redis, event, error);
  await ackEvent(redis, event);
  await markRetry(event, retryStreamId, error);
  console.warn(JSON.stringify({
    component: 'flowpr-worker',
    event: 'retry',
    runId: event.runId,
    stream: event.stream,
    streamId: event.id,
    retryStreamId,
    attempt: event.attempt + 1,
    error: getErrorMessage(error),
  }));
}

function isDirectWorkerExecution(): boolean {
  const workerPath = fileURLToPath(import.meta.url);

  return process.argv.slice(1).some((arg) => {
    if (!/\.[cm]?[jt]s$/.test(arg)) return false;
    return resolve(arg) === workerPath;
  });
}

export async function main() {
  loadLocalEnv();
  const missing = getMissingRequiredEnv();
  const recommended = getMissingRecommendedEnv();

  if (missing.length > 0) {
    console.log(`FlowPR worker missing required env: ${missing.join(', ')}`);
  }

  if (recommended.length > 0) {
    console.log(`FlowPR worker missing recommended env: ${recommended.join(', ')}`);
  }

  const redis = createFlowPrRedisClient();
  const once = process.argv.includes('--once');
  const consumerName = process.env.FLOWPR_WORKER_ID ?? `worker-${process.pid}`;

  let processed = 0;

  try {
    await connectFlowPrRedisClient(redis);
    await ensureFlowPrConsumerGroups(redis);
    await writeWorkerHeartbeat(redis, { workerId: consumerName, pid: process.pid, processed });
    console.log(`FlowPR Redis worker listening as ${consumerName}`);

    while (true) {
      await writeWorkerHeartbeat(redis, {
        workerId: consumerName,
        pid: process.pid,
        processed,
      }).catch(() => undefined);

      const reclaimedEvents = await claimStaleEvents(redis, consumerName, {
        minIdleMs: 30000,
        count: 5,
      });
      const events = reclaimedEvents.length > 0
        ? reclaimedEvents
        : await readRunEvents(redis, consumerName, {
            count: 5,
            blockMs: once ? 1000 : 5000,
          });

      if (events.length === 0) {
        if (once) {
          console.log('No Redis events available.');
          break;
        }

        continue;
      }

      for (const event of events) {
        await writeWorkerHeartbeat(redis, {
          workerId: consumerName,
          pid: process.pid,
          processed,
          currentRunId: event.runId,
          currentPhase: event.phase,
        }).catch(() => undefined);

        try {
          await processRedisEvent({ redis, event, consumerName });
          await ackEvent(redis, event);
          processed += 1;
          console.log(JSON.stringify({
            component: 'flowpr-worker',
            event: 'processed',
            runId: event.runId,
            stream: event.stream,
            streamId: event.id,
            eventType: event.eventType,
            phase: event.phase,
            attempt: event.attempt,
          }));
        } catch (error) {
          await handleWorkerFailure(redis, event, error);
        }
      }
    }
  } finally {
    if (redis.isOpen) {
      await redis.quit();
    }
  }
}

if (isDirectWorkerExecution()) {
  main().catch((error: unknown) => {
    console.error(getErrorMessage(error));
    process.exitCode = 1;
  });
}
