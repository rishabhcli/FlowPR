import { NextResponse } from 'next/server';
import { startGitHubOAuth } from '@flowpr/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectToHealth(request: Request, status: string, message?: string) {
  const url = new URL('/health', request.url);
  url.searchParams.set('github', status);
  if (message) url.searchParams.set('message', message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const requestedNext = requestUrl.searchParams.get('next') ?? '/health';
  const next =
    requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/health';
  const callbackUrl = new URL('/api/connections/github/callback', request.url);
  callbackUrl.searchParams.set('next', next);

  try {
    const oauth = await startGitHubOAuth(callbackUrl.toString());
    const response = NextResponse.redirect(oauth.url);
    response.cookies.set('flowpr_github_oauth_verifier', oauth.codeVerifier, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/',
      sameSite: 'lax',
      secure: requestUrl.protocol === 'https:',
    });
    response.cookies.set('flowpr_github_oauth_next', next, {
      httpOnly: true,
      maxAge: 10 * 60,
      path: '/',
      sameSite: 'lax',
      secure: requestUrl.protocol === 'https:',
    });

    return response;
  } catch (error) {
    return redirectToHealth(
      request,
      'error',
      error instanceof Error ? error.message : String(error),
    );
  }
}
