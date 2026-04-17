import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { generateMagicLinkToken, MAGIC_LINK_TTL_MINUTES } from '@/lib/auth/tokens';
import { sendMagicLinkEmail } from '@/lib/auth/email';
import { FREE_TIER_CREDITS } from '@/lib/credits/prices';

const bodySchema = z.object({
  email: z.string().email(),
});

// POST /api/auth/request — body: { email }
// Always responds { sent: true } regardless of whether the email existed
// or the send succeeded. This prevents email enumeration and keeps the
// UX the same whether it's a new or returning user.
export async function POST(req: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { error: 'invalid body', detail: (e as Error).message },
      { status: 400 },
    );
  }

  const email = parsed.email.trim().toLowerCase();

  try {
    // Upsert the user. First-sight users get a free-tier grant; we guard
    // against double-granting via an existing `grant:free_tier` ledger entry.
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    const hasGrant = await prisma.ledgerEntry.findFirst({
      where: { userId: user.id, refType: 'grant', refId: 'free_tier' },
      select: { id: true },
    });
    if (!hasGrant) {
      await prisma.$transaction([
        prisma.ledgerEntry.create({
          data: {
            userId: user.id,
            amount: FREE_TIER_CREDITS,
            kind: 'grant',
            refType: 'grant',
            refId: 'free_tier',
            memo: 'New account free-tier grant',
          },
        }),
        prisma.user.update({
          where: { id: user.id },
          data: { balance: { increment: FREE_TIER_CREDITS } },
        }),
      ]);
    }

    const { raw, hash } = generateMagicLinkToken();
    await prisma.magicLink.create({
      data: {
        userId: user.id,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MINUTES * 60 * 1000),
      },
    });

    const appUrl = (process.env.APP_URL ?? 'http://localhost:3001').replace(/\/$/, '');
    const url = `${appUrl}/api/auth/verify?token=${encodeURIComponent(raw)}`;

    await sendMagicLinkEmail({ to: email, url });
  } catch (e) {
    // Log and still pretend success — don't leak provider outages to the
    // UI as a hint that the email is or isn't valid.
    console.error('[auth/request] failed:', (e as Error).message);
  }

  return NextResponse.json({ sent: true });
}
