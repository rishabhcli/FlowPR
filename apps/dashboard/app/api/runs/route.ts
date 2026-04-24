import { NextResponse } from 'next/server';
import { listRecentRuns } from '@flowpr/tools';

export const runtime = 'nodejs';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const runs = await listRecentRuns();

    return NextResponse.json({ runs });
  } catch (error) {
    return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
  }
}
