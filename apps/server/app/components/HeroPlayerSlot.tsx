'use client';

/**
 * Client-side shim for the hero visual.
 *
 * Next 15's App Router disallows `ssr: false` on `next/dynamic` inside
 * server components, so the dynamic import has to live in a client
 * component. This file is that shim — it owns the dynamic load and
 * the fallback passed through to HeroPlayer for error recovery.
 *
 * Design choices:
 *  - `loading:` is an invisible placeholder — we don't want a Lottie
 *    animation sitting behind (or flashing ahead of) the real player.
 *  - `fallback` (used when HeroPlayer's own try/catch flips `failed=true`)
 *    is the Lottie stack illustration, which is a genuine recovery path.
 */

import dynamic from 'next/dynamic';
import HeroLottie from './HeroLottie';

const HeroPlaceholder = () => (
  <div
    aria-hidden
    style={{
      width: '100%',
      height: '100%',
      borderRadius: 20,
      background: '#ffffff',
      boxShadow: '0 30px 60px -40px rgba(14,34,53,0.25)',
    }}
  />
);

const HeroPlayer = dynamic(() => import('./HeroPlayer'), {
  ssr: false,
  loading: () => <HeroPlaceholder />,
});

export default function HeroPlayerSlot() {
  return (
    <HeroPlayer
      fallback={
        <HeroLottie
          src={undefined}
          label="Three stacked panels — triage, analysis, script — gently drifting"
        />
      }
    />
  );
}
