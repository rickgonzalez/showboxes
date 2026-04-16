'use client';

/**
 * Smaller inline Lottie for step cards / section accents. Same fallback strategy
 * as HeroLottie: if the package isn't installed, an animated SVG plays so layout
 * doesn't collapse.
 */

import { useEffect, useState, CSSProperties } from 'react';

interface Props {
  src: string;
  style?: CSSProperties;
  fallbackColor?: string;
  label?: string;
}

export default function InlineLottie({ src, style, fallbackColor = '#ff5a1f', label }: Props) {
  const [Player, setPlayer] = useState<React.ComponentType<any> | null>(null);
  const [failed, setFailed] = useState(false);

  // Placeholder fillers — skip the player entirely so a malformed Lottie
  // can't crash the renderer. Remove this guard once real assets land.
  const isPlaceholder = src.startsWith('/animations/') && src.endsWith('.json');

  useEffect(() => {
    if (isPlaceholder) return;
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
  }, [isPlaceholder]);

  if (Player && !failed && !isPlaceholder) {
    return (
      <Player
        src={src}
        autoplay
        loop
        style={{ width: '100%', height: '100%', ...style }}
        aria-label={label}
      />
    );
  }

  // Fallback — pulsing orbit (generic enough to slot anywhere).
  return (
    <div role="img" aria-label={label} style={{ width: '100%', height: '100%', ...style }}>
      <style>{`
        @keyframes ilp { 0%,100% { transform: scale(1); opacity: 0.9; } 50% { transform: scale(1.15); opacity: 1; } }
        @keyframes ilo { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
      <svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
        <g style={{ transformOrigin: '50px 50px', animation: 'ilo 14s linear infinite' }}>
          <circle cx="50" cy="50" r="32" fill="none" stroke={fallbackColor} strokeOpacity="0.18" strokeWidth="1.5" />
          <circle cx="82" cy="50" r="6" fill={fallbackColor} style={{ animation: 'ilp 2.6s ease-in-out infinite' }} />
          <circle cx="26" cy="50" r="4" fill={fallbackColor} fillOpacity="0.7" style={{ animation: 'ilp 2.6s ease-in-out infinite', animationDelay: '-1.3s' }} />
        </g>
        <circle cx="50" cy="50" r="10" fill={fallbackColor} />
      </svg>
    </div>
  );
}
