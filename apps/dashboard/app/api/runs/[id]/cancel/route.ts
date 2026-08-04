import { NextResponse } from 'next/server';
import { FLOWPR_OPERATOR_CANCELLATION_SUMMARY } from '@flowpr/schemas';
import { appendTimelineEvent, getRun, updateRunStatus } from '@flowpr/tools/insforge';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const terminal = new Set(['done', 'failed', 'learned']);

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const ownerKey = await getOwnerKey();
  if (!ownerKey) return NextResponse.json({ error: 'Sign in to cancel a run.' }, { status: 401 });
  const { id } = await context.params;

  try {
    const run = await getRun(id, ownerKey);
    if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    if (terminal.has(run.status)) {
      return NextResponse.json({ error: `Run is already ${run.status}.` }, { status: 409 });
    }

    const reason = FLOWPR_OPERATOR_CANCELLATION_SUMMARY;
    const updated = await updateRunStatus(id, 'failed', { failureSummary: reason });
    await appendTimelineEvent({
      runId: id,
      actor: 'user',
      phase: run.status,
      status: 'failed',
      title: 'Run cancelled by operator.',
      detail: reason,
      data: { previousStatus: run.status },
    });
    return NextResponse.json({ run: updated, cancelledAt: updated.completedAt });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
