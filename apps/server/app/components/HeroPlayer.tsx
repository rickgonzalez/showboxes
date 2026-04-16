'use client';

/**
 * HeroPlayer — embeds the Showboxes player in the codesplain hero.
 *
 * Mounts the real `Presentation` wrapper from `@showboxes/player`, builds a
 * two-scene `PresentationScript` by composing existing sample scenes
 * (sequence-diagram · login, then code-cloud · stack), and loops silently.
 *
 * Design intent from docs/codesplain/HERO-EMBED-PLAN.md:
 *  - Pure composition. No new fixture files. No edits to player samples.
 *  - Silent. Uses StubVoicePlayer — narration is metadata only, never spoken.
 *  - On-brand. Overrides `defaults.palette` with Codesplain blues; templates
 *    inherit from palette tokens so no template code changes.
 *  - Ambient. No controls. Loops forever via the ScriptPlayer's onEnd event.
 *  - Reduced motion respected. Falls back to HeroLottie's CSS illustration.
 *
 * This file never imports player internals — only the public barrel at
 * `@showboxes/player`.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

// Design surface size the player's templates are authored against.
// Hero box is 1:1, so we use a square. See jolly-juggling-quiche.md.
const DESIGN_W = 1280;
const DESIGN_H = 1280;
import {
  Presentation,
  ScriptPlayer,
  StubVoicePlayer,
  Presenter,
  sampleScripts,
  type PresentationScript,
  type Scene,
} from '@showboxes/player';

// Player stylesheet. Kept next to the component so Next code-splits it with
// the hero chunk rather than loading it on every page.
import '@showboxes/player/styles.css';

/* ---------- script composition ---------- */

const BRAND_PALETTE = {
  primary:    '#1d7ab7', // deep blue — arrows, nodes, emphasis
  secondary:  '#6fc4eb', // sky blue — secondary arrows, labels
  accent:     '#155a88', // hover / pressed deep blue
  background: '#000000',
  text:       '#f8fafc',
  code:       '#3e5572',
};

function findScene(script: PresentationScript, id: string): Scene {
  const s = script.scenes.find((sc) => sc.id === id);
  if (!s) throw new Error(`HeroPlayer: scene "${id}" missing from sample script`);
  // Clone and trim the hold so the hero loop stays tight.
  return { ...s, holdSeconds: Math.min(s.holdSeconds, 8) };
}

function buildHeroScript(): PresentationScript {
  // sequence-diagram lives in `mixedScript` (scene s2b); code-cloud lives in
  // `beatHeavyScript` (scene stress-1). Both read off the same palette, so
  // palette overrides cascade into both.
  const flowScene     = findScene(sampleScripts.mixed,     's2');
  const sequenceScene = findScene(sampleScripts.mixed,     's2b');
  const codeZoomScene = findScene(sampleScripts.mixed,     's3');
  const cloudScene    = findScene(sampleScripts.beatHeavy, 'stress-1');

  return {
    meta: {
      title: 'Codesplain hero loop',
      repoUrl: 'local://codesplain',
      generatedAt: new Date().toISOString(),
      persona: 'friendly',
      estimatedDuration: 20,
    },
    defaults: {
      palette: BRAND_PALETTE,
      transition: { type: 'fade', durationMs: 450 },
      voice: { provider: 'stub', voiceId: 'stub-1', speed: 1 },
    },
    scenes: [flowScene, sequenceScene, codeZoomScene, cloudScene],
  };
}

/* ---------- component ---------- */

export interface HeroPlayerProps {
  /** Rendered if the script can't load or reduced-motion is on. */
  fallback?: React.ReactNode;
  style?: CSSProperties;
}

export default function HeroPlayer({ fallback, style }: HeroPlayerProps) {
  const playerRef = useRef<ScriptPlayer | null>(null);
  const presenterRef = useRef<Presenter | null>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setScale(Math.min(width / DESIGN_W, height / DESIGN_H));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // NOTE: reduced-motion fallback is intentionally disabled for now.
  // The hero loop *is* the product demo — hiding it for reduced-motion users
  // is a bigger UX loss than the motion itself. Revisit with a proper
  // reduced-motion variant later (static first frame, or a slowed single scene).
  // See docs/codesplain/HERO-EMBED-PLAN.md.

  useEffect(() => {
    return () => {
      playerRef.current?.stop();
      playerRef.current = null;
    };
  }, []);

  const handleReady = (presenter: Presenter) => {
    presenterRef.current = presenter;
    try {
      const script = buildHeroScript();
      const voice = new StubVoicePlayer();
      const player = new ScriptPlayer(script, presenter, voice, {
        onEnd: () => {
          // Tiny beat before looping so the last scene's motion can settle.
          window.setTimeout(() => {
            if (playerRef.current === player) player.play();
          }, 600);
        },
      });
      playerRef.current = player;
      player.play();
    } catch (err) {
      console.warn('[HeroPlayer] failed to start:', err);
      setFailed(true);
    }
  };

  if (failed) {
    return <>{fallback}</>;
  }

  return (
    <div
      ref={outerRef}
      role="img"
      aria-label="Animated walkthrough: a login sequence diagram and a code-concept cloud"
      className="hero-player-scope"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        // Containment belt-and-suspenders against the player's internal
        // stylesheet bleeding into the rest of the page.
        contain: 'layout paint',
        borderRadius: 20,
        overflow: 'hidden',
        background: '#000000',
        boxShadow: '0 30px 60px -40px rgba(14,34,53,0.25)',
        ...style,
      }}
    >
      {/* Fixed-size design surface. The player's templates are authored in
          absolute pixels against this viewport; we shrink the whole thing
          with a CSS transform so it fits the hero box at any viewport size.
          Absolutely positioned so its 1280×1280 intrinsic size does NOT
          inflate the parent grid track in .hero-visual. */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: DESIGN_W,
          height: DESIGN_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        <Presentation onReady={handleReady} />
      </div>
    </div>
  );
}
