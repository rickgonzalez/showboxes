import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth/session';

// GET /api/auth/me — the client polls this after login to hydrate UI.
// Returns { email, balance, availableBalance, createdAt } or 401.
// availableBalance subtracts held reservations; see
// docs/codesplain/AUTH-AND-BILLING-PLAN.md §Step 3.
export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.kind }, { status: 401 });
    }
    throw e;
  }

  const held = await prisma.creditReservation.aggregate({
    where: { userId: user.id, status: 'held' },
    _sum: { amount: true },
  });
  const reservedTotal = held._sum.amount ?? 0;

  return NextResponse.json({
    email: user.email,
    balance: user.balance,
    availableBalance: user.balance - reservedTotal,
    createdAt: user.createdAt,
  });
}
