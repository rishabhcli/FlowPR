import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getGitHubConnectionForUser } from '@flowpr/tools/github-connections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function GET() {
  const cookieStore = await cookies();
  const session = cookieStore.get('flowpr_session')?.value;

  // Legacy sessions stored the literal string "connected" before we wired the
  // cookie to the InsForge user id. Treat those as anonymous so the header
  // falls back to the GitHub icon until the user signs in again.
  if (!session || session === 'connected') {
    return NextResponse.json({ signedIn: false });
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
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 500 },
    );
  }
}
