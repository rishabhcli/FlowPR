import { NextResponse } from 'next/server';
import { completeGitHubOAuth } from '@flowpr/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getRedirectUrl(request: Request, status: string, message?: string) {
  const requestUrl = new URL(request.url);
  const requestedNext =
    requestUrl.searchParams.get('next') ??
    request.headers.get('cookie')?.match(/(?:^|;\s*)flowpr_github_oauth_next=([^;]+)/)?.[1] ??
    '/health';
  const next =
    requestedNext.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/health';
  const redirectUrl = new URL(next, request.url);
  redirectUrl.searchParams.set('github', status);
  if (message) redirectUrl.searchParams.set('message', message);
  return redirectUrl;
}

function clearOAuthCookies(response: NextResponse) {
  response.cookies.set('flowpr_github_oauth_verifier', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
  });
  response.cookies.set('flowpr_github_oauth_next', '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('insforge_code');
  const oauthError = requestUrl.searchParams.get('error');
  const verifier = request.headers
    .get('cookie')
    ?.match(/(?:^|;\s*)flowpr_github_oauth_verifier=([^;]+)/)?.[1];

  if (oauthError) {
    const response = NextResponse.redirect(
      getRedirectUrl(request, 'error', oauthError),
    );
    clearOAuthCookies(response);
    return response;
  }

  if (!code || !verifier) {
    const response = NextResponse.redirect(
      getRedirectUrl(request, 'error', 'GitHub sign-in could not be completed.'),
    );
    clearOAuthCookies(response);
    return response;
  }

  try {
    const connection = await completeGitHubOAuth({
      code,
      codeVerifier: decodeURIComponent(verifier),
    });
    const response = NextResponse.redirect(getRedirectUrl(request, 'connected'));
    clearOAuthCookies(response);
    response.cookies.set('flowpr_session', connection.userId, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
      sameSite: 'lax',
      secure: requestUrl.protocol === 'https:',
    });
    return response;
  } catch (error) {
    const response = NextResponse.redirect(
      getRedirectUrl(
        request,
        'error',
        error instanceof Error ? error.message : String(error),
      ),
    );
    clearOAuthCookies(response);
    return response;
  }
}
