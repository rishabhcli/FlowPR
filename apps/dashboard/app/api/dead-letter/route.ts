import { NextResponse } from 'next/server';
import {
  connectFlowPrRedisClient,
  createFlowPrRedisClient,
  listDeadLetterEntries,
} from '@flowpr/tools/redis';
import {
  listRecentRuns,
} from '@flowpr/tools/insforge';
import { buildDeadLetterNextAction } from '@flowpr/tools/recovery';
import type { FlowPrRun } from '@flowpr/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isResolved(entry: { createdAt?: string; runId?: string }, run: FlowPrRun | undefined): boolean {
  if (!run) return true;
  if (run.status !== 'done' && run.status !== 'learned') return false;

  const deadLetterTs = new Date(entry.createdAt ?? '').getTime();
  const resolutionTs = new Date(run.completedAt ?? run.updatedAt ?? '').getTime();

  if (!Number.isFinite(deadLetterTs) || !Number.isFinite(resolutionTs)) {
    return true;
  }

  return resolutionTs >= deadLetterTs;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const count = Number.parseInt(url.searchParams.get('count') ?? '20', 10);

  const redis = createFlowPrRedisClient();
  try {
    await connectFlowPrRedisClient(redis);
    const raw = await listDeadLetterEntries(redis, Number.isFinite(count) ? count : 20);
    const runs = await listRecentRuns(100).catch(() => []);
    const runsById = new Map(runs.map((run) => [run.id, run]));
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
    })).map((entry) => {
      const run = entry.runId ? runsById.get(entry.runId) : undefined;
      const resolved = isResolved(entry, run);
      const orphaned = !run;
      const nextAction = buildDeadLetterNextAction({
        id: entry.id,
        runId: entry.runId,
        runStatus: run?.status,
        phase: entry.phase,
        eventType: entry.eventType,
        error: entry.error,
        orphaned,
        resolved,
      });
      return {
        ...entry,
        runStatus: run?.status,
        orphaned,
        resolved,
        nextAction,
        resolutionReason: resolved
          ? run
            ? `Run is ${run.status}; keeping this as historical evidence.`
            : 'No matching run record exists in the current store; keeping this as orphaned historical evidence.'
          : undefined,
      };
    });
    const unresolved = entries.filter((entry) => !entry.resolved).length;
    const orphaned = entries.filter((entry) => entry.orphaned).length;

    return NextResponse.json({
      entries,
      count: unresolved,
      total: entries.length,
      resolved: entries.length - unresolved,
      orphaned,
      nextAction: entries.find((entry) => !entry.resolved)?.nextAction,
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
