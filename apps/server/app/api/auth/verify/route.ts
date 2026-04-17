import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashToken } from '@/lib/auth/tokens';
import {
  buildSessionCookie,
  isSecureRequest,
} from '@/lib/auth/cookies';
import { sessionExpiry, sessionMaxAgeSeconds } from '@/lib/auth/session';

// GET /api/auth/verify?token=... — the landing URL from the magic-link email.
// On success: marks the link used, creates a session, sets the cookie, and
// 302s to the app root. On failure: redirects to /login?error=... so the
// user sees a friendly message instead of raw JSON.
export async function GET(req: Request) {
  const appUrl = (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, '');
  const url = new URL(req.url);
  const raw = url.searchParams.get('token');
  if (!raw) return redirect(`${appUrl}/login?error=invalid`);

  const link = await prisma.magicLink.findUnique({
    where: { tokenHash: hashToken(raw) },
  });
  if (!link) return redirect(`${appUrl}/login?error=invalid`);
  if (link.usedAt) return redirect(`${appUrl}/login?error=used`);
  if (link.expiresAt.getTime() < Date.now()) {
    return redirect(`${appUrl}/login?error=expired`);
  }

  // Consume the link, verify the email, and spin up a session in one
  // transaction so a crash can't leave us with a half-authed user.
  const session = await prisma.$transaction(async (tx) => {
    await tx.magicLink.update({
      where: { id: link.id },
      data: { usedAt: new Date() },
    });
    await tx.user.update({
      where: { id: link.userId },
      data: { emailVerified: new Date() },
    });
    return tx.userSession.create({
      data: {
        userId: link.userId,
        expiresAt: sessionExpiry(),
      },
    });
  });

  const cookie = buildSessionCookie(session.id, {
    maxAgeSeconds: sessionMaxAgeSeconds(),
    secure: isSecureRequest(),
  });

  return new NextResponse(null, {
    status: 302,
    headers: {
      Location: `${appUrl}/`,
      'Set-Cookie': cookie,
    },
  });
}

function redirect(location: string): NextResponse {
  return new NextResponse(null, { status: 302, headers: { Location: location } });
}
