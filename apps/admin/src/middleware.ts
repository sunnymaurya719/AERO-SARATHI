import { NextResponse, type NextRequest } from 'next/server';

const SID_COOKIE = '__Host-admin_sid';
const PUBLIC_PATHS = ['/login', '/accept-invite'];

/**
 * Edge guard: presence-check the session cookie to avoid rendering protected
 * shells for signed-out users. The API remains the real security boundary —
 * this only redirects; it never trusts the cookie's contents.
 */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SID_COOKIE);
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!hasSession && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (hasSession && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
