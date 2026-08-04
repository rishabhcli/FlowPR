import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  listWorkerHeartbeats,
} from '@flowpr/tools/redis';
import { listRecentRuns } from '@flowpr/tools/insforge';
import { isRecoverableActiveRunStatus } from '@flowpr/tools/recovery';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ownerKey = await getOwnerKey();
  if (!ownerKey) return NextResponse.json({ error: 'Sign in to view worker status.' }, { status: 401 });

  let redis: ReturnType<typeof createFlowPrRedisClient> | undefined;
  try {
    redis = createFlowPrRedisClient();
    await connectFlowPrRedisClient(redis);
    const [heartbeats, runs] = await Promise.all([
      listWorkerHeartbeats(redis),
      listRecentRuns(100, ownerKey).catch(() => []),
    ]);
    const runsById = new Map(runs.map((run) => [run.id, run]));
    const now = Date.now();

    const enriched = heartbeats.map((beat) => {
      const lastBeatMs = new Date(beat.lastBeat).getTime();
      const ageMs = Number.isFinite(lastBeatMs) ? now - lastBeatMs : Number.POSITIVE_INFINITY;
      const alive = ageMs <= 30000;
      const currentRunStatus = beat.currentRunId
        ? runsById.get(beat.currentRunId)?.status
        : undefined;
      return {
        ...beat,
        ageMs,
        alive,
        currentRunStatus,
        currentRunActive: isRecoverableActiveRunStatus(currentRunStatus),
      };
    });

    return NextResponse.json({
      workers: enriched,
      aliveCount: enriched.filter((w) => w.alive).length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        workers: [],
        aliveCount: 0,
        generatedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 200 },
    );
  } finally {
    if (redis?.isOpen) {
      await redis.quit().catch(() => undefined);
    }
  }
}
