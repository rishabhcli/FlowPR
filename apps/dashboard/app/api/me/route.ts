import { NextResponse } from 'next/server';
import { getGitHubConnectionForUser } from '@flowpr/tools/github-connections';
import { getOwnerKey, LOCAL_OWNER_KEY } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  const session = await getOwnerKey();
  if (!session) {
    return NextResponse.json({ signedIn: false });
  }

  if (session === LOCAL_OWNER_KEY) {
    return NextResponse.json({
      signedIn: true,
      localMode: true,
      userId: LOCAL_OWNER_KEY,
      githubLogin: 'local workspace',
    });
  }

  try {
    const connection = await getGitHubConnectionForUser(session);
    if (!connection) {
      return NextResponse.json({ signedIn: false });
    }
    return NextResponse.json({
      signedIn: true,
      userId: connection.userId,
      githubLogin: connection.githubLogin,
      githubAvatarUrl: connection.githubAvatarUrl,
    });
  } catch (error) {
    return NextResponse.json({
      signedIn: true,
      userId: session,
      authWarning: getErrorMessage(error),
    });
  }
}
