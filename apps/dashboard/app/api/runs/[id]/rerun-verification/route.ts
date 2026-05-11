import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  ensureFlowPrConsumerGroups,
  emitAgentStep,
} from '@flowpr/tools/redis';
import {
  getRun,
} from '@flowpr/tools/insforge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;

  try {
    const run = await getRun(id);

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    if (!process.env.TINYFISH_API_KEY) {
      return NextResponse.json(
        {
          error: 'TINYFISH_API_KEY is not configured on the worker. Configure TinyFish before rerunning verification.',
        },
        { status: 400 },
      );
    }

    const redis = createFlowPrRedisClient();

    try {
      await connectFlowPrRedisClient(redis);
      await ensureFlowPrConsumerGroups(redis);
      const dedupeKey = `agent.step:${run.id}:running_live_verification:rerun:${Date.now()}`;
      const streamId = await emitAgentStep(redis, {
        runId: run.id,
        phase: 'running_live_verification',
        mode: 'rerun',
        reason: 'Operator rerun from the dashboard.',
        dedupeKey,
      });

      return NextResponse.json({
        runId: run.id,
        streamId,
        dedupeKey,
        mode: 'rerun',
        queuedAt: new Date().toISOString(),
      });
    } finally {
      if (redis.isOpen) {
        await redis.quit();
      }
    }
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
