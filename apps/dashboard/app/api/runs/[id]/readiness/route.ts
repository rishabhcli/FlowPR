import { NextResponse } from 'next/server';
import { getRunDetail } from '@flowpr/tools/insforge';
import { summarizeRunReadiness } from '@flowpr/tools/readiness';
import { getOwnerKey } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ownerKey = await getOwnerKey();
    if (!ownerKey) return NextResponse.json({ error: 'Sign in to view run readiness.' }, { status: 401 });
    const { id } = await context.params;
    const detail = await getRunDetail(id, ownerKey);

    if (!detail) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const readiness = summarizeRunReadiness(detail);
    return NextResponse.json({ runId: id, ...readiness });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
