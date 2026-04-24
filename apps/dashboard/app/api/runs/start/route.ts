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
  validateRunStartInput,
  type ValidationIssue,
} from '@flowpr/tools';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inputErrorResponse(error: unknown) {
  const message = getErrorMessage(error);
  const fieldMatch = /^(repoUrl|previewUrl|flowGoal|baseBranch|riskLevel)/.exec(message);
  const field = (fieldMatch?.[1] ?? 'input') as ValidationIssue['field'] | 'input';
  const fallbackCode = 'repoUrl.invalid' as ValidationIssue['code'];
  const issue: ValidationIssue = {
    code: fallbackCode,
    field: field === 'input' ? 'repoUrl' : field,
    message,
    suggestion: 'Review the form fields and try again. All four fields — repository, preview URL, base branch, and flow goal — are required.',
    severity: 'error',
  };

  return NextResponse.json({ error: message, issues: [issue] }, { status: 400 });
}

export async function POST(request: Request) {
  let input;

  try {
    input = parseRunStartInput(await request.json());
  } catch (error) {
    return inputErrorResponse(error);
  }

  const validation = await validateRunStartInput({
    repoUrl: input.repoUrl,
    previewUrl: input.previewUrl,
    flowGoal: input.flowGoal,
    baseBranch: input.baseBranch,
  });

  if (!validation.ok) {
    return NextResponse.json(
      {
        error: 'FlowPR needs a few fixes before starting this run.',
        issues: validation.issues,
      },
      { status: 400 },
    );
  }

  try {
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
        warnings: validation.issues.filter((issue) => issue.severity === 'warning').map((issue) => issue.message),
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

    const warnings = validation.issues
      .filter((issue) => issue.severity === 'warning')
      .map((issue) => issue.message);
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
        issues: validation.issues,
      },
      { status: warnings.length > 0 ? 202 : 201 },
    );
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
