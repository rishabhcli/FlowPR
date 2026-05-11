import { NextResponse } from 'next/server';
import { checkSponsorStatuses } from '@flowpr/tools/sponsors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const statuses = await checkSponsorStatuses();

    return NextResponse.json({ statuses });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
