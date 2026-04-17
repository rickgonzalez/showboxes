import { NextResponse } from 'next/server';
import { reapExpiredReservations } from '@/lib/credits/ledger';

// Vercel Cron hits this route on schedule. The CRON_SECRET header guard
// prevents external callers from triggering it. Set CRON_SECRET in your
// Vercel project env vars — Vercel injects the matching header automatically.

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const released = await reapExpiredReservations();
  if (released > 0) {
    console.log(`[cron/reap-reservations] released ${released} expired reservation(s)`);
  }
  return NextResponse.json({ released });
}
