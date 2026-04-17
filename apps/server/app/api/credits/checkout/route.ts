import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth/session';
import { getBundle } from '@/lib/credits/prices';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  let user;
  try {
    user = await requireUser(req);
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: e.kind }, { status: 401 });
    throw e;
  }

  let body: { sku?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const sku = body.sku?.trim();
  if (!sku) return NextResponse.json({ error: 'sku required' }, { status: 400 });

  const bundle = getBundle(sku);
  if (!bundle)
    return NextResponse.json({ error: `unknown sku: ${sku}` }, { status: 400 });

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({
      _stub: true,
      clientSecret: `fake_${bundle.sku}_${Date.now()}_secret`,
      purchaseId: `fake_purchase_${Date.now()}`,
      bundle,
      note: 'STRIPE_SECRET_KEY not set — returning a stub.',
    });
  }

  // Ensure Stripe customer exists
  let stripeCustomerId = user.stripeCustomerId;
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: user.id },
    });
    stripeCustomerId = customer.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId },
    });
  }

  const intent = await stripe.paymentIntents.create({
    amount: bundle.amountUsdCents,
    currency: 'usd',
    customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true },
    metadata: {
      userId: user.id,
      sku: bundle.sku,
      credits: String(bundle.credits),
    },
  });

  const purchase = await prisma.purchase.create({
    data: {
      userId: user.id,
      sku: bundle.sku,
      credits: bundle.credits,
      amountUsdCents: bundle.amountUsdCents,
      stripePaymentIntentId: intent.id,
      status: 'pending',
    },
  });

  return NextResponse.json({
    clientSecret: intent.client_secret,
    purchaseId: purchase.id,
  });
}
