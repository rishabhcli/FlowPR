import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  listDeadLetterEntries,
} from '@flowpr/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const count = Number.parseInt(url.searchParams.get('count') ?? '20', 10);

  const redis = createFlowPrRedisClient();
  try {
    await connectFlowPrRedisClient(redis);
    const raw = await listDeadLetterEntries(redis, Number.isFinite(count) ? count : 20);
    const entries = raw.map((entry) => ({
      id: entry.id,
      runId: entry.fields.runId,
      sourceStream: entry.fields.sourceStream,
      eventType: entry.fields.eventType,
      phase: entry.fields.phase,
      attempt: entry.fields.attempt ? Number(entry.fields.attempt) : undefined,
      dedupeKey: entry.fields.dedupeKey,
      error: entry.fields.error,
      createdAt: entry.fields.createdAt,
    }));

    return NextResponse.json({
      entries,
      count: entries.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        entries: [],
        count: 0,
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
