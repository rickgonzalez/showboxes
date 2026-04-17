import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/session';
import { getBalanceForUser } from '@/lib/credits/ledger';

export async function GET(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.kind }, { status: 401 });
    throw e;
  }

  const { balance, availableBalance, recentEntries } =
    await getBalanceForUser(user.id);

  return NextResponse.json({ balance, availableBalance, entries: recentEntries });
}
