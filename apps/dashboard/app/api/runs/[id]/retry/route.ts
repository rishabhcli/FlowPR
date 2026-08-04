import { NextResponse } from 'next/server';
import { appendTimelineEvent, getRun, updateRunStatus } from '@flowpr/tools/insforge';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  emitRunStarted,
  ensureFlowPrConsumerGroups,
} from '@flowpr/tools/redis';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const ownerKey = await getOwnerKey();
  if (!ownerKey) return NextResponse.json({ error: 'Sign in to requeue a run.' }, { status: 401 });
  const { id } = await context.params;

  try {
    const run = await getRun(id, ownerKey);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (run.status !== 'failed' && run.status !== 'queued') {
      return NextResponse.json({ error: `Only failed or queued runs can be requeued (current state: ${run.status}).` }, { status: 409 });
    }

    const redis = createFlowPrRedisClient();
    try {
      await connectFlowPrRedisClient(redis);
      await ensureFlowPrConsumerGroups(redis);
      const updated = await updateRunStatus(id, 'queued', { clearCompletion: true });
      const streamId = await emitRunStarted(redis, {
        runId: id,
        repoUrl: run.repoUrl,
        previewUrl: run.previewUrl,
        flowGoal: run.flowGoal,
      });
      await appendTimelineEvent({
        runId: id,
        actor: 'user',
        phase: 'queue',
        status: 'started',
        title: 'Run requeued from the dashboard.',
        data: { streamId, previousStatus: run.status },
      });
      return NextResponse.json({ run: updated, streamId, queuedAt: new Date().toISOString() });
    } finally {
      if (redis.isOpen) await redis.quit().catch(() => undefined);
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
