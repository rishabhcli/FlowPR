import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  listWorkerHeartbeats,
} from '@flowpr/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const redis = createFlowPrRedisClient();
  try {
    await connectFlowPrRedisClient(redis);
    const heartbeats = await listWorkerHeartbeats(redis);
    const now = Date.now();

    const enriched = heartbeats.map((beat) => {
      const lastBeatMs = new Date(beat.lastBeat).getTime();
      const ageMs = Number.isFinite(lastBeatMs) ? now - lastBeatMs : Number.POSITIVE_INFINITY;
      const alive = ageMs <= 30000;
      return { ...beat, ageMs, alive };
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
    if (redis.isOpen) {
      await redis.quit().catch(() => undefined);
    }
  }
}
