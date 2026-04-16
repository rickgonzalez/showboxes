import { NextResponse } from 'next/server';
import { getBalance } from '@/lib/credits/ledger';

/**
 * GET /api/credits/balance?email=foo@bar.com
 *
 * Stubbed: pre-auth v1 identifies the account by email passed as a query
 * param. Swap this for a session lookup as soon as Clerk/OAuth lands.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');
  if (!email) {
    return NextResponse.json({ error: 'email query param required' }, { status: 400 });
  }
  const { balance, recentEntries } = await getBalance({ email });
  return NextResponse.json({ email, balance, recentEntries });
}
