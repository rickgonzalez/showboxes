import { NextResponse } from 'next/server';
import { getBalance } from '@/lib/credits/ledger';

/**
 * GET /api/credits/history?email=foo@bar.com
 *
 * Returns the last 20 ledger entries for account history UIs. Stubbed against
 * the in-memory ledger for now; paginates properly once the Prisma models land.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }
  const { balance, recentEntries } = await getBalance({ email });
  return NextResponse.json({ email, balance, entries: recentEntries });
}
