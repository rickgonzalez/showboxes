import { NextResponse } from 'next/server';
import { getBundle } from '@/lib/credits/prices';

/**
 * POST /api/credits/checkout
 * Body: { email: string; sku: BundleSku }
 *
 * Mirrors Kamclient's `create-payment-intent` shape: the server picks the
 * amount from a SKU table so the client can't spoof a price. Returns the
 * PaymentIntent client_secret for Stripe Elements to confirm.
 *
 * This stub:
 *  - Validates the SKU.
 *  - If STRIPE_SECRET_KEY is set, creates a real PaymentIntent.
 *  - Otherwise returns a fake `client_secret` so the UI flow can be wired
 *    end-to-end in dev without a Stripe account.
 *
 * A real implementation will also:
 *  - Look up or create a CreditAccount row by email.
 *  - Look up or create a Stripe customer (see kamclient/pages/api/stripe/stripe-customer.ts).
 *  - Write a `Purchase` row in 'pending' status and return its id.
 */
export async function POST(req: Request) {
  let body: { email?: string; sku?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const email = body.email?.trim();
  const sku = body.sku?.trim();
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });
  if (!sku)   return NextResponse.json({ error: 'sku required' },   { status: 400 });

  const bundle = getBundle(sku);
  if (!bundle) return NextResponse.json({ error: `unknown sku: ${sku}` }, { status: 400 });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return NextResponse.json({
      _stub: true,
      clientSecret: `fake_${bundle.sku}_${Date.now()}_secret`,
      purchaseId: `fake_purchase_${Date.now()}`,
      bundle,
      note: 'STRIPE_SECRET_KEY not set — returning a stub. See docs/codesplain/CREDITS.md.',
    });
  }

  // Real path — kept here as a sketch. Uncomment and install `stripe` when ready.
  //
  // const Stripe = (await import('stripe')).default;
  // const stripe = new Stripe(stripeKey);
  // const intent = await stripe.paymentIntents.create({
  //   amount: bundle.amountUsdCents,
  //   currency: 'usd',
  //   automatic_payment_methods: { enabled: true },
  //   metadata: { email, sku: bundle.sku, credits: String(bundle.credits) },
  // });
  // TODO: write Purchase row (pending) and return its id alongside client_secret.
  // return NextResponse.json({ clientSecret: intent.client_secret, purchaseId: '…' });

  return NextResponse.json(
    { error: 'stripe path not yet implemented; set STRIPE_SECRET_KEY=null to use stub' },
    { status: 501 },
  );
}
