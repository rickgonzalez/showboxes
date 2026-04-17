import { NextResponse } from 'next/server';
import { getStripe } from '@/lib/stripe';
import { creditUser } from '@/lib/credits/ledger';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const rawBody = await req.text();
  const stripe = getStripe();
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // --- Real Stripe path ---
  if (stripe && whSecret) {
    const sig = req.headers.get('stripe-signature') ?? '';
    let event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, whSecret);
    } catch (err) {
      console.error('[webhook] signature verification failed:', err);
      return NextResponse.json(
        { error: 'signature verification failed' },
        { status: 400 },
      );
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const paymentIntentId = pi.id;

      const purchase = await prisma.purchase.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      if (!purchase) {
        console.warn(`[webhook] no Purchase for PI ${paymentIntentId}`);
        return NextResponse.json({ received: true });
      }

      // Idempotency: already processed
      if (purchase.status === 'succeeded') {
        return NextResponse.json({ received: true });
      }

      // Credit the user (deduplicates on refType + refId)
      await creditUser({
        userId: purchase.userId,
        amount: purchase.credits,
        refType: 'purchase',
        refId: paymentIntentId,
        memo: `Purchase ${purchase.sku} (${purchase.credits} credits)`,
      });

      const ledgerEntry = await prisma.ledgerEntry.findFirst({
        where: {
          userId: purchase.userId,
          refType: 'purchase',
          refId: paymentIntentId,
        },
        select: { id: true },
      });

      await prisma.purchase.update({
        where: { id: purchase.id },
        data: {
          status: 'succeeded',
          creditLedgerEntryId: ledgerEntry?.id ?? null,
        },
      });
    }

    return NextResponse.json({ received: true });
  }

  // --- Dev stub path (no STRIPE_WEBHOOK_SECRET) ---
  console.warn(
    '[webhook] STRIPE_WEBHOOK_SECRET not set — using dev stub. '
    + 'Do NOT run like this in production.',
  );
  try {
    const parsed = JSON.parse(rawBody) as {
      email?: string;
      credits?: number;
      ref?: string;
    };
    if (parsed.email && parsed.credits) {
      const { credit } = await import('@/lib/credits/ledger');
      await credit(
        { email: parsed.email },
        parsed.credits,
        'purchase',
        parsed.ref,
        'dev webhook stub',
      );
      return NextResponse.json({ _stub: true, received: true });
    }
  } catch {
    /* body wasn't JSON */
  }
  return NextResponse.json({ _stub: true, received: true, note: 'no-op stub' });
}
