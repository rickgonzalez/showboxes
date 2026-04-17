import Stripe from 'stripe';

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!globalForStripe.stripe) {
    globalForStripe.stripe = new Stripe(key);
  }
  return globalForStripe.stripe;
}
