import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js Middleware — Route Protection
 * Redirects unauthenticated users away from protected routes.
 */

const PUBLIC_PATHS = ['/', '/login', '/register', '/_next', '/favicon.ico', '/api'];
const PROTECTED_PATHS = ['/dashboard', '/booking'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  const isPublic = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(path + '/')
  );
  if (isPublic && !PROTECTED_PATHS.includes(pathname)) {
    return NextResponse.next();
  }

  // Check if path requires authentication
  const requiresAuth = PROTECTED_PATHS.some((path) => pathname.startsWith(path));
  if (!requiresAuth) {
    return NextResponse.next();
  }

  // Check for auth token in cookies
  const token = request.cookies.get('ssd_studio_token')?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
