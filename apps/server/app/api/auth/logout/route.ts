import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookie,
  isSecureRequest,
  parseCookieHeader,
} from '@/lib/auth/cookies';

// POST /api/auth/logout — deletes the server-side session and clears the
// cookie. Always returns 204; missing/invalid sessions are a no-op.
export async function POST(req: Request) {
  const cookies = parseCookieHeader(req.headers.get('cookie'));
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (sessionId) {
    await prisma.userSession
      .delete({ where: { id: sessionId } })
      .catch(() => {});
  }
  return new NextResponse(null, {
    status: 204,
    headers: { 'Set-Cookie': buildClearSessionCookie(isSecureRequest()) },
  });
}
