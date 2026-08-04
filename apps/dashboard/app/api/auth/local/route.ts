import { NextResponse } from 'next/server';
import { FLOWPR_SESSION_COOKIE, isLocalSessionEnabled, LOCAL_OWNER_KEY } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  if (!isLocalSessionEnabled()) {
    return NextResponse.json(
      { error: 'Local sessions are disabled. Use GitHub OAuth in a configured environment.' },
      { status: 404 },
    );
  }

  const requestUrl = new URL(request.url);
  const requestedNext = requestUrl.searchParams.get('next') ?? '/';
  const next = requestedNext.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/';
  const response = NextResponse.redirect(new URL(next, request.url));
  response.cookies.set(FLOWPR_SESSION_COOKIE, LOCAL_OWNER_KEY, {
    httpOnly: true,
    maxAge: 60 * 60 * 24,
    path: '/',
    sameSite: 'lax',
    secure: requestUrl.protocol === 'https:',
  });
  return response;
}
