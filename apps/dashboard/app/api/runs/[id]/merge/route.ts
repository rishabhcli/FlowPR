import { NextResponse } from 'next/server';
import {
  appendTimelineEvent,
  getRun,
  hasGitHubCredentials,
  listPullRequests,
  mergeGitHubPullRequest,
  recordProviderArtifact,
  updatePullRequest,
} from '@flowpr/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface MergeRequestBody {
  mergeMethod?: 'merge' | 'squash' | 'rebase';
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const run = await getRun(id);

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (!hasGitHubCredentials()) {
      return NextResponse.json(
        { error: 'No GitHub credentials are configured. Set GITHUB_TOKEN or install the FlowPR GitHub App.' },
        { status: 400 },
      );
    }

    const pullRequests = await listPullRequests(run.id);
    const latest = pullRequests[pullRequests.length - 1];

    if (!latest || !latest.number) {
      return NextResponse.json(
        { error: 'No pull request is available yet. Wait for FlowPR to open the PR before merging.' },
        { status: 409 },
      );
    }

    if (latest.status === 'merged') {
      return NextResponse.json({
        runId: run.id,
        pullRequestId: latest.id,
        merged: true,
        alreadyMerged: true,
        url: latest.url,
        number: latest.number,
      });
    }

    let body: MergeRequestBody = {};
    try {
      body = (await request.json()) as MergeRequestBody;
    } catch {
      body = {};
    }

    const mergeResult = await mergeGitHubPullRequest({
      owner: run.owner,
      repo: run.repo,
      pullNumber: latest.number,
      mergeMethod: body.mergeMethod ?? 'squash',
      commitTitle: latest.title || `FlowPR fix on ${run.flowGoal}`,
      commitMessage: `Merged from FlowPR run ${run.id}`,
    });

    const updated = await updatePullRequest(latest.id, {
      status: mergeResult.merged ? 'merged' : latest.status,
      raw: {
        ...(latest.raw ?? {}),
        merge: {
          merged: mergeResult.merged,
          sha: mergeResult.sha,
          message: mergeResult.message,
          method: body.mergeMethod ?? 'squash',
          mergedAt: new Date().toISOString(),
        },
      },
    });

    if (mergeResult.merged) {
      await appendTimelineEvent({
        runId: run.id,
        actor: 'github',
        phase: 'creating_pr',
        status: 'completed',
        title: `Merged pull request #${latest.number} via dashboard.`,
        detail: mergeResult.message,
        data: {
          pullRequestId: latest.id,
          number: latest.number,
          mergeSha: mergeResult.sha,
          mergeMethod: body.mergeMethod ?? 'squash',
        },
      });

      await recordProviderArtifact({
        runId: run.id,
        sponsor: 'github',
        artifactType: 'pull_request_merged',
        providerId: mergeResult.sha ?? `pr-${latest.number}`,
        artifactUrl: latest.url,
        requestSummary: {
          pullNumber: latest.number,
          method: body.mergeMethod ?? 'squash',
          owner: run.owner,
          repo: run.repo,
        },
        responseSummary: {
          merged: mergeResult.merged,
          sha: mergeResult.sha,
          message: mergeResult.message,
        },
        raw: { merge: mergeResult },
      });
    }

    return NextResponse.json({
      runId: run.id,
      pullRequestId: updated.id,
      merged: mergeResult.merged,
      sha: mergeResult.sha,
      message: mergeResult.message,
      url: updated.url,
      number: updated.number,
      status: updated.status,
    });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
