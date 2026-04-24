import { NextResponse } from 'next/server';
import { parseRunStartInput } from '@flowpr/schemas';
import {
  appendTimelineEvent,
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  createRun,
  emitRunStarted,
  ensureFlowPrConsumerGroup,
  getGitHubRepository,
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
      status: 'queued',
      message: 'Run created from dashboard input.',
      metadata: {
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
        table: 'runs',
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

    try {
      const repository = await getGitHubRepository(run.owner, run.repo);

      await appendTimelineEvent({
        runId: run.id,
        status: 'loading_repo',
        message: 'GitHub repository metadata loaded.',
        metadata: repository as unknown as Record<string, unknown>,
      });

      await recordProviderArtifact({
        runId: run.id,
        sponsor: 'github',
        artifactType: 'repository_lookup',
        providerId: String(repository.id),
        artifactUrl: repository.htmlUrl,
        requestSummary: {
          owner: run.owner,
          repo: run.repo,
        },
        responseSummary: {
          fullName: repository.fullName,
          defaultBranch: repository.defaultBranch,
          private: repository.private,
        },
        raw: repository as unknown as Record<string, unknown>,
      });
    } catch (error) {
      warnings.push(`GitHub repository lookup failed: ${getErrorMessage(error)}`);
      await appendTimelineEvent({
        runId: run.id,
        status: 'queued',
        message: 'GitHub repository lookup failed.',
        metadata: {
          error: getErrorMessage(error),
        },
      });
    }

    let streamId: string | undefined;
    const redis = createFlowPrRedisClient();

    try {
      await connectFlowPrRedisClient(redis);
      await ensureFlowPrConsumerGroup(redis);
      streamId = await emitRunStarted(redis, run.id);

      await appendTimelineEvent({
        runId: run.id,
        status: 'queued',
        message: 'Redis run event emitted.',
        metadata: {
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
        },
        raw: {
          runId: run.id,
          eventType: 'run.started',
        },
      });
    } catch (error) {
      warnings.push(`Redis event emission failed: ${getErrorMessage(error)}`);
      await appendTimelineEvent({
        runId: run.id,
        status: 'queued',
        message: 'Redis event emission failed.',
        metadata: {
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
