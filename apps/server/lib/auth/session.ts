import type { User } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { SESSION_COOKIE_NAME, parseCookieHeader } from './cookies';
import { SESSION_TTL_DAYS } from './tokens';

export class AuthError extends Error {
  constructor(public readonly kind: 'no_session' | 'expired' | 'not_found') {
    super(kind);
    this.name = 'AuthError';
  }
}

// The single gatekeeper used by every protected route. Returns the User
// or throws AuthError — routes map AuthError to HTTP 401.
export async function requireUser(req: Request): Promise<User> {
  const cookies = parseCookieHeader(req.headers.get('cookie'));
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) throw new AuthError('no_session');

  const session = await prisma.userSession.findUnique({
    where: { id: sessionId },
    include: { user: true },
  });
  if (!session) throw new AuthError('not_found');
  if (session.expiresAt.getTime() < Date.now()) throw new AuthError('expired');

  // Fire-and-forget heartbeat. Failures here shouldn't block the request.
  void prisma.userSession
    .update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return session.user;
}

// Best-effort variant — returns null instead of throwing. Useful for
// routes that render differently for signed-in users but don't require it.
export async function getOptionalUser(req: Request): Promise<User | null> {
  try {
    return await requireUser(req);
  } catch {
    return null;
  }
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function sessionMaxAgeSeconds(): number {
  return SESSION_TTL_DAYS * 24 * 60 * 60;
}
