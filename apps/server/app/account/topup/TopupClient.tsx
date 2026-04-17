'use client';

import { useEffect, useState } from 'react';

interface Bundle {
  sku: string;
  name: string;
  credits: number;
  amountUsdCents: number;
  featured?: boolean;
}

interface PricingResponse {
  unit: string;
  creditValueCents: number;
  freeTierCredits: number;
  bundles: Bundle[];
}

type CheckoutState =
  | { kind: 'idle' }
  | { kind: 'starting'; sku: string }
  | { kind: 'started'; sku: string; clientSecret: string; purchaseId: string; stub: boolean }
  | { kind: 'error'; message: string };

export default function TopupClient() {
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [checkout, setCheckout] = useState<CheckoutState>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pricingRes, meRes] = await Promise.all([
          fetch('/api/credits/pricing'),
          fetch('/api/auth/me'),
        ]);
        if (cancelled) return;
        if (!pricingRes.ok) throw new Error(`pricing ${pricingRes.status}`);
        setPricing((await pricingRes.json()) as PricingResponse);
        setSignedIn(meRes.ok);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buy = async (sku: string) => {
    setCheckout({ kind: 'starting', sku });
    try {
      const res = await fetch('/api/credits/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sku }),
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error ?? `checkout ${res.status}`);
      }
      setCheckout({
        kind: 'started',
        sku,
        clientSecret: body.clientSecret,
        purchaseId: body.purchaseId,
        stub: Boolean(body._stub),
      });
    } catch (e) {
      setCheckout({ kind: 'error', message: (e as Error).message });
    }
  };

  if (loadError) {
    return <div className="auth-card"><p className="auth-error">{loadError}</p></div>;
  }
  if (!pricing) {
    return <div className="auth-card"><p>Loading bundles…</p></div>;
  }
  if (signedIn === false) {
    return (
      <div className="auth-card">
        <h1>Sign in to buy credits</h1>
        <p className="auth-lede">You need an account to purchase credits.</p>
        <a href="/login" className="btn-primary auth-submit">Sign in</a>
      </div>
    );
  }

  return (
    <div className="topup">
      <header className="topup-header">
        <h1>Top up credits</h1>
        <p className="auth-lede">
          1 credit = ${(pricing.creditValueCents / 100).toFixed(2)} at list
          price. Bigger bundles discount that rate.
        </p>
      </header>

      <div className="topup-grid">
        {pricing.bundles.map((b) => {
          const rate = b.amountUsdCents / b.credits;
          const ratePct = Math.round((1 - rate / pricing.creditValueCents) * 100);
          const starting = checkout.kind === 'starting' && checkout.sku === b.sku;
          return (
            <div key={b.sku} className={`price-card ${b.featured ? 'price-card-featured' : ''}`}>
              {b.featured && <span className="badge">Most popular</span>}
              <h2 className="topup-card-name">{b.name}</h2>
              <div className="amount">
                ${(b.amountUsdCents / 100).toFixed(0)}
                <small> / {b.credits.toLocaleString()} credits</small>
              </div>
              {ratePct > 0 && (
                <p className="topup-card-save">Save {ratePct}% vs list rate</p>
              )}
              <button
                type="button"
                className="btn-primary topup-buy"
                disabled={starting}
                onClick={() => void buy(b.sku)}
              >
                {starting ? 'Starting…' : 'Buy'}
              </button>
            </div>
          );
        })}
      </div>

      {checkout.kind === 'error' && (
        <div className="auth-error topup-result">{checkout.message}</div>
      )}
      {checkout.kind === 'started' && (
        <div className="topup-result">
          <p>
            <strong>Checkout started</strong> for {checkout.sku}
            {checkout.stub ? ' (stub — STRIPE_SECRET_KEY not set)' : ''}.
          </p>
          <p className="topup-result-note">
            Purchase id: <code>{checkout.purchaseId}</code>
          </p>
          <p className="topup-result-note">
            Client secret: <code>{checkout.clientSecret}</code>
          </p>
          <p className="topup-result-note">
            (The Stripe Payment Element will wire to this client secret when we
            land the checkout UI.)
          </p>
        </div>
      )}
    </div>
  );
}
