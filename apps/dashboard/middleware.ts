import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'flowpr_session';

// Only the dashboard root is gated. /demo, /runs/:id, /health, and all /api routes stay open
// so deep links and webhooks keep working without an authed cookie.
const GATED_PATHS = new Set(['/']);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!GATED_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (request.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/'],
};
