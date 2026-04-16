'use client';

/**
 * Hero-stage Lottie player.
 *
 * Uses `@lottiefiles/dotlottie-react` when available at runtime. If the
 * package isn't installed (first checkout before `npm i`), renders a
 * graceful animated SVG fallback so the page still looks good.
 *
 * Install:
 *   npm i @lottiefiles/dotlottie-react
 *
 * Then set `src` to a .lottie URL or a local /public/animations/*.lottie path.
 * Pick an illustration that matches the "bright & editorial" direction —
 * abstract geometric motion is safer than literal robot/code illustrations.
 */

import { useEffect, useState } from 'react';

interface HeroLottieProps {
  /** Path or URL to a .lottie or .json file. */
  src?: string;
  /** Fallback art label, shown if the player can't load. */
  label?: string;
}

export default function HeroLottie({
  src,
  label = 'An animated explanation, generated from your repo',
}: HeroLottieProps) {
  const [Player, setPlayer] = useState<React.ComponentType<any> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) return; // No src = skip loading Lottie entirely, use CSS fallback
    let alive = true;
    (async () => {
      try {
        const mod = await import('@lottiefiles/dotlottie-react');
        if (alive) setPlayer(() => mod.DotLottieReact);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [src]);

  if (src && Player && !failed) {
    return (
      <Player
        src={src}
        autoplay
        loop
        style={{ width: '100%', height: '100%' }}
        aria-label={label}
      />
    );
  }

  // Fallback: CSS-only kinetic illustration — three stacked "cards" rotating,
  // echoing the stacked-scene metaphor of showboxes.
  return <FallbackStack aria-label={label} />;
}

function FallbackStack({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <style>{`
        .hc-card {
          position: absolute; width: 58%; aspect-ratio: 4/3;
          border-radius: 20px; border: 1px solid rgba(14,34,53,0.08);
          background: #fff; box-shadow: 0 30px 60px -40px rgba(14,34,53,0.3);
          display: flex; align-items: center; justify-content: center;
          font-family: "Inter", system-ui, sans-serif;
          font-size: 22px; font-weight: 600; letter-spacing: -0.02em;
        }
      `}</style>
      <div className="hc-card" style={{ transform: 'translate(-14%, 4%) rotate(-6deg)', background: '#d9ecf8', color: '#155a88' }}>Triage</div>
      <div className="hc-card" style={{ transform: 'translate(0, 0) rotate(0deg)' }}>
        <span style={{ color: '#1d7ab7' }}>Analysis</span>
      </div>
      <div className="hc-card" style={{ transform: 'translate(14%, 4%) rotate(6deg)', background: '#6fc4eb', color: '#ffffff' }}>Script</div>
    </div>
  );
}
