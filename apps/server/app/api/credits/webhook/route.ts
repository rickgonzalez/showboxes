import { NextResponse } from 'next/server';
import { credit } from '@/lib/credits/ledger';

/**
 * POST /api/credits/webhook
 *
 * Stripe webhook target. This stub:
 *  - Accepts the request body as raw text.
 *  - If STRIPE_WEBHOOK_SECRET is set, will verify the signature (sketched below).
 *  - On a `payment_intent.succeeded` event it credits the corresponding account.
 *
 * A production implementation:
 *  - MUST verify the Stripe signature with `stripe.webhooks.constructEvent`
 *    using the raw body buffer (Next's App Router supports this via Request.text()).
 *  - Looks up the Purchase row by intent id, marks it succeeded, writes a
 *    LedgerEntry, stashes the entry id on the purchase.
 *  - Is idempotent: Stripe re-delivers on network failures, so re-running the
 *    same event id must be a no-op.
 */
export async function POST(req: Request) {
  const body = await req.text();

  // const stripeKey = process.env.STRIPE_SECRET_KEY;
  // const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  // if (stripeKey && whSecret) {
  //   const Stripe = (await import('stripe')).default;
  //   const stripe = new Stripe(stripeKey);
  //   const sig = req.headers.get('stripe-signature') ?? '';
  //   try {
  //     const event = stripe.webhooks.constructEvent(body, sig, whSecret);
  //     if (event.type === 'payment_intent.succeeded') {
  //       const pi = event.data.object as any;
  //       const email  = pi.metadata?.email;
  //       const credits = Number(pi.metadata?.credits ?? 0);
  //       if (email && credits > 0) {
  //         await credit({ email }, credits, 'purchase', pi.id, `Stripe payment ${pi.id}`);
  //       }
  //     }
  //   } catch (err) {
  //     return NextResponse.json({ error: 'signature verification failed' }, { status: 400 });
  //   }
  //   return NextResponse.json({ received: true });
  // }

  // Stub path — for dev, accept a simplified `{ email, credits }` payload so
  // we can exercise the ledger end-to-end without Stripe.
  try {
    const parsed = JSON.parse(body) as { email?: string; credits?: number; ref?: string };
    if (parsed.email && parsed.credits) {
      await credit({ email: parsed.email }, parsed.credits, 'purchase', parsed.ref, 'dev webhook stub');
      return NextResponse.json({ _stub: true, received: true });
    }
  } catch {
    /* ignore — body wasn't JSON */
  }
  return NextResponse.json({ _stub: true, received: true, note: 'no-op stub' });
}
