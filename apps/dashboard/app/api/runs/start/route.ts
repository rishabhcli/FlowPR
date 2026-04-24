import { NextResponse } from 'next/server';
import { parseRunStartInput } from '@flowpr/schemas';
import {
  appendTimelineEvent,
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  createRun,
  emitRunStarted,
  ensureFlowPrConsumerGroups,
  recordProviderArtifact,
} from '@flowpr/tools';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInputError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return [
    'Request body',
    'repoUrl',
    'previewUrl',
    'flowGoal',
    'baseBranch',
    'riskLevel',
  ].some((prefix) => error.message.startsWith(prefix));
}

export async function POST(request: Request) {
  try {
    const input = parseRunStartInput(await request.json());
    const run = await createRun(input);

    await appendTimelineEvent({
      runId: run.id,
      actor: 'user',
      phase: 'intake',
      status: 'started',
      title: 'Run created from dashboard input.',
      data: {
        repoUrl: run.repoUrl,
        previewUrl: run.previewUrl,
        flowGoal: run.flowGoal,
      },
    });

    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'insforge',
      artifactType: 'database_record',
      providerId: run.id,
      requestSummary: {
        table: 'qa_runs',
        operation: 'insert',
      },
      responseSummary: {
        status: run.status,
        owner: run.owner,
        repo: run.repo,
      },
      raw: {
        run,
      },
    });

    const warnings: string[] = [];
    let streamId: string | undefined;
    const redis = createFlowPrRedisClient();

    try {
      await connectFlowPrRedisClient(redis);
      await ensureFlowPrConsumerGroups(redis);
      streamId = await emitRunStarted(redis, {
        runId: run.id,
        repoUrl: run.repoUrl,
        previewUrl: run.previewUrl,
        flowGoal: run.flowGoal,
      });

      await appendTimelineEvent({
        runId: run.id,
        actor: 'redis',
        phase: 'queue',
        status: 'completed',
        title: 'Redis run event emitted.',
        data: {
          stream: 'flowpr:runs',
          streamId,
        },
      });

      await recordProviderArtifact({
        runId: run.id,
        sponsor: 'redis',
        artifactType: 'stream_event',
        providerId: streamId,
        requestSummary: {
          stream: 'flowpr:runs',
          eventType: 'run.started',
        },
        responseSummary: {
          streamId,
          consumerGroup: 'flowpr-workers',
        },
        raw: {
          runId: run.id,
          eventType: 'run.started',
          repoUrl: run.repoUrl,
          previewUrl: run.previewUrl,
          flowGoal: run.flowGoal,
        },
      });
    } catch (error) {
      warnings.push(`Redis event emission failed: ${getErrorMessage(error)}`);
      await appendTimelineEvent({
        runId: run.id,
        actor: 'redis',
        phase: 'queue',
        status: 'failed',
        title: 'Redis event emission failed.',
        data: {
          error: getErrorMessage(error),
        },
      });
    } finally {
      if (redis.isOpen) {
        await redis.quit();
      }
    }

    return NextResponse.json(
      {
        run,
        event: streamId ? { stream: 'flowpr:runs', streamId } : null,
        warnings,
      },
      { status: warnings.length > 0 ? 202 : 201 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: isInputError(error) ? 400 : 500 },
    );
  }
}
