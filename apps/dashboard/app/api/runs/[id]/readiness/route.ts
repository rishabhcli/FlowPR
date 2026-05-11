import { NextResponse } from 'next/server';
import { getRunDetail } from '@flowpr/tools/insforge';
import { summarizeRunReadiness } from '@flowpr/tools/readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const detail = await getRunDetail(id);

    if (!detail) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const readiness = summarizeRunReadiness(detail);
    return NextResponse.json({ runId: id, ...readiness });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
