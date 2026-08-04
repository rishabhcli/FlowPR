import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  readLiveStreams,
} from '@flowpr/tools/redis';
import { getRunDetail } from '@flowpr/tools/insforge';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerKey = await getOwnerKey();
    if (!ownerKey) return NextResponse.json({ error: 'Sign in to view run evidence.' }, { status: 401 });
    const { id } = await context.params;
    const detail = await getRunDetail(id, ownerKey);

    if (!detail) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    let liveStreams: Array<{ provider: string; providerRunId?: string; streamingUrl: string; createdAt: string }> = [];
    let runtimeWarning: string | undefined;
    let redis: ReturnType<typeof createFlowPrRedisClient> | undefined;
    try {
      redis = createFlowPrRedisClient();
      await connectFlowPrRedisClient(redis);
      liveStreams = await readLiveStreams(redis, id);
    } catch (error) {
      // Redis is optional enrichment; don't fail the detail fetch.
      runtimeWarning = error instanceof Error ? error.message : String(error);
    } finally {
      if (redis?.isOpen) {
        await redis.quit().catch(() => undefined);
      }
    }

    return NextResponse.json({ ...detail, liveStreams, runtimeWarning });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
