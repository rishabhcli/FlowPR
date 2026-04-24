import {
  ackRunEvent,
  appendTimelineEvent,
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  createSensoClient,
  ensureFlowPrConsumerGroup,
  getGitHubRepository,
  getMissingRecommendedEnv,
  getMissingRequiredEnv,
  getRun,
  loadLocalEnv,
  moveToDeadLetter,
  readRunEvents,
  recordBrowserObservation,
  recordProviderArtifact,
  updateRunStatus,
  type RunStreamEvent,
} from '@flowpr/tools';
import { createTinyFishClient, queueBrowserQa } from './providers/tinyfish';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadGitHubMetadata(runId: string, owner: string, repo: string) {
  const repository = await getGitHubRepository(owner, repo);

  await appendTimelineEvent({
    runId,
    status: 'loading_repo',
    message: 'Worker verified GitHub repository metadata.',
    metadata: repository as unknown as Record<string, unknown>,
  });

  await recordProviderArtifact({
    runId,
    sponsor: 'github',
    artifactType: 'worker_repository_lookup',
    providerId: String(repository.id),
    artifactUrl: repository.htmlUrl,
    requestSummary: { owner, repo },
    responseSummary: {
      fullName: repository.fullName,
      defaultBranch: repository.defaultBranch,
      private: repository.private,
    },
    raw: repository as unknown as Record<string, unknown>,
  });
}

async function querySensoPolicy(runId: string, flowGoal: string) {
  if (!process.env.SENSO_API_KEY) {
    await appendTimelineEvent({
      runId,
      status: 'retrieving_policy',
      message: 'Senso policy lookup skipped because SENSO_API_KEY is not configured.',
      metadata: {},
    });
    return;
  }

  const query = [
    'FlowPR frontend QA policy for this user flow:',
    flowGoal,
    'Focus on primary actions, mobile checkout, accessibility, and pull request evidence.',
  ].join('\n');
  const result = await createSensoClient().search({ query, maxResults: 3 });

  await appendTimelineEvent({
    runId,
    status: 'retrieving_policy',
    message: 'Senso policy context retrieved.',
    metadata: {
      query,
      resultType: Array.isArray(result) ? 'array' : typeof result,
    },
  });

  await recordProviderArtifact({
    runId,
    sponsor: 'senso',
    artifactType: 'policy_search',
    requestSummary: {
      query,
      maxResults: 3,
    },
    responseSummary: {
      resultType: Array.isArray(result) ? 'array' : typeof result,
    },
    raw: {
      result,
    },
  });
}

async function queueTinyFishRun(run: NonNullable<Awaited<ReturnType<typeof getRun>>>) {
  const client = createTinyFishClient();
  const response = await queueBrowserQa(client, {
    runId: run.id,
    previewUrl: run.previewUrl,
    flowGoal: run.flowGoal,
  });

  if (response.error) {
    await recordProviderArtifact({
      runId: run.id,
      sponsor: 'tinyfish',
      artifactType: 'agent_queue_error',
      requestSummary: {
        previewUrl: run.previewUrl,
        flowGoal: run.flowGoal,
      },
      responseSummary: {
        error: response.error.message,
        category: response.error.category,
      },
      raw: {
        response,
      },
    });

    await recordBrowserObservation({
      runId: run.id,
      provider: 'tinyfish',
      status: 'errored',
      severity: run.riskLevel,
      observedBehavior: response.error.message,
      raw: {
        response,
      },
    });

    throw new Error(`TinyFish queue failed: ${response.error.message}`);
  }

  await appendTimelineEvent({
    runId: run.id,
    status: 'running_browser_qa',
    message: 'TinyFish browser QA run queued.',
    metadata: {
      tinyfishRunId: response.run_id,
    },
  });

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'tinyfish',
    artifactType: 'agent_run_queued',
    providerId: response.run_id,
    requestSummary: {
      previewUrl: run.previewUrl,
      flowGoal: run.flowGoal,
    },
    responseSummary: {
      tinyfishRunId: response.run_id,
      error: null,
    },
    raw: {
      response,
    },
  });

  await recordBrowserObservation({
    runId: run.id,
    provider: 'tinyfish',
    providerId: response.run_id,
    status: 'queued',
    severity: run.riskLevel,
    expectedBehavior: run.flowGoal,
    observedBehavior: 'TinyFish accepted the live browser run and returned a provider run ID.',
    raw: {
      response,
    },
  });

  const finalRun = await waitForTinyFishRun(client, response.run_id);

  if (!finalRun) {
    await appendTimelineEvent({
      runId: run.id,
      status: 'running_browser_qa',
      message: 'TinyFish run is still in progress.',
      metadata: {
        tinyfishRunId: response.run_id,
      },
    });
    return;
  }

  await recordProviderArtifact({
    runId: run.id,
    sponsor: 'tinyfish',
    artifactType: 'agent_run_result',
    providerId: response.run_id,
    requestSummary: {
      tinyfishRunId: response.run_id,
    },
    responseSummary: {
      status: finalRun.status,
      numOfSteps: finalRun.num_of_steps,
      hasResult: Boolean(finalRun.result),
      hasError: Boolean(finalRun.error),
    },
    raw: {
      finalRun,
    },
  });

  if (finalRun.status === 'COMPLETED') {
    await updateRunStatus(run.id, 'done');
    await appendTimelineEvent({
      runId: run.id,
      status: 'done',
      message: 'TinyFish browser QA completed.',
      metadata: {
        tinyfishRunId: response.run_id,
        steps: finalRun.num_of_steps,
      },
    });
    await recordBrowserObservation({
      runId: run.id,
      provider: 'tinyfish',
      providerId: response.run_id,
      status: 'passed',
      severity: run.riskLevel,
      expectedBehavior: run.flowGoal,
      observedBehavior: 'TinyFish completed the requested browser flow.',
      raw: {
        result: finalRun.result,
      },
    });
    return;
  }

  await updateRunStatus(run.id, 'failed');
  await appendTimelineEvent({
    runId: run.id,
    status: 'failed',
    message: 'TinyFish browser QA did not complete successfully.',
    metadata: {
      tinyfishRunId: response.run_id,
      tinyfishStatus: finalRun.status,
      error: finalRun.error?.message,
    },
  });
  await recordBrowserObservation({
    runId: run.id,
    provider: 'tinyfish',
    providerId: response.run_id,
    status: finalRun.status === 'FAILED' ? 'failed' : 'errored',
    severity: run.riskLevel,
    expectedBehavior: run.flowGoal,
    observedBehavior: finalRun.error?.message ?? `TinyFish ended with status ${finalRun.status}.`,
    raw: {
      result: finalRun.result,
      error: finalRun.error,
    },
  });
}

async function waitForTinyFishRun(
  client: ReturnType<typeof createTinyFishClient>,
  tinyfishRunId: string,
) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const run = await client.runs.get(tinyfishRunId);

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status)) {
      return run;
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  return null;
}

async function processRunStarted(event: RunStreamEvent) {
  const run = await getRun(event.runId);

  if (!run) {
    throw new Error(`Run ${event.runId} was not found in InsForge`);
  }

  await appendTimelineEvent({
    runId: run.id,
    status: run.status,
    message: 'Worker claimed Redis run event.',
    metadata: {
      stream: event.stream,
      streamId: event.id,
      dedupeKey: event.dedupeKey,
      attempt: event.attempt,
    },
  });

  await updateRunStatus(run.id, 'loading_repo');
  await loadGitHubMetadata(run.id, run.owner, run.repo);

  await updateRunStatus(run.id, 'retrieving_policy');
  await querySensoPolicy(run.id, run.flowGoal);

  await updateRunStatus(run.id, 'running_browser_qa');
  await queueTinyFishRun(run);
}

async function handleEvent(event: RunStreamEvent) {
  if (event.eventType === 'run.started') {
    await processRunStarted(event);
    return;
  }

  throw new Error(`Unsupported event type: ${event.eventType}`);
}

async function main() {
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

  try {
    await connectFlowPrRedisClient(redis);
    await ensureFlowPrConsumerGroup(redis);
    console.log(`FlowPR worker listening as ${consumerName}`);

    do {
      const events = await readRunEvents(redis, consumerName, {
        count: 1,
        blockMs: once ? 1000 : 5000,
      });

      if (events.length === 0 && once) {
        console.log('No run events available.');
        break;
      }

      for (const event of events) {
        try {
          await handleEvent(event);
          await ackRunEvent(redis, event.id);
          console.log(`Processed ${event.eventType} for ${event.runId}`);
        } catch (error) {
          await moveToDeadLetter(redis, event, error);
          await ackRunEvent(redis, event.id);

          try {
            await updateRunStatus(event.runId, 'failed');
            await appendTimelineEvent({
              runId: event.runId,
              status: 'failed',
              message: 'Worker moved run event to dead letter.',
              metadata: {
                error: getErrorMessage(error),
                streamId: event.id,
              },
            });
          } catch {
            // The original error is already preserved in Redis dead letter.
          }

          console.error(`Failed ${event.eventType} for ${event.runId}: ${getErrorMessage(error)}`);
        }
      }
    } while (!once);
  } finally {
    if (redis.isOpen) {
      await redis.quit();
    }
  }
}

main().catch((error: unknown) => {
  console.error(getErrorMessage(error));
  process.exitCode = 1;
});
