import { NextResponse } from 'next/server';
import { getGitHubConnectionStatus } from '@flowpr/tools/github-connections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    return NextResponse.json(await getGitHubConnectionStatus());
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
