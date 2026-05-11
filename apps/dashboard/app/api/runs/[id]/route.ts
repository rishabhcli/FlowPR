import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  readLiveStreams,
} from '@flowpr/tools/redis';
import { getRunDetail } from '@flowpr/tools/insforge';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await getRunDetail(id);

    if (!detail) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    let liveStreams: Array<{ provider: string; providerRunId?: string; streamingUrl: string; createdAt: string }> = [];
    const redis = createFlowPrRedisClient();
    try {
      await connectFlowPrRedisClient(redis);
      liveStreams = await readLiveStreams(redis, id);
    } catch {
      // Redis is optional enrichment; don't fail the detail fetch.
    } finally {
      if (redis.isOpen) {
        await redis.quit().catch(() => undefined);
      }
    }

    return NextResponse.json({ ...detail, liveStreams });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
