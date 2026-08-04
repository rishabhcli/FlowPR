import { NextResponse } from 'next/server';
import { getGitHubConnectionStatus } from '@flowpr/tools/github-connections';
import { getOwnerKey, LOCAL_OWNER_KEY } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  try {
    const ownerKey = await getOwnerKey();
    return NextResponse.json(await getGitHubConnectionStatus({
      userId: ownerKey && ownerKey !== LOCAL_OWNER_KEY ? ownerKey : undefined,
    }));
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
