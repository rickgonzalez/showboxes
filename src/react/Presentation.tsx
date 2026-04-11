import { useEffect, useRef } from 'react';
import { Presenter } from '../service/presenter';
import '../templates'; // side-effect: register built-in templates

/**
 * Thin React wrapper around the vanilla Presenter. Mounts a layered
 * container (DOM root + absolutely positioned canvas), hands the
 * Presenter instance back via a ref-callback so the host page can drive
 * it imperatively.
 *
 * The core service layer has no React dependency — this wrapper is
 * optional sugar for hosting it inside a React app.
 */

export interface PresentationProps {
  /** Called once the Presenter is mounted. Receives the live instance. */
  onReady?: (presenter: Presenter) => void;
  className?: string;
}

export function Presentation({ onReady, className }: PresentationProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const domRootRef = useRef<HTMLDivElement | null>(null);
  const presenterRef = useRef<Presenter | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !domRootRef.current) return;
    const presenter = new Presenter(canvasRef.current, domRootRef.current);
    presenterRef.current = presenter;
    onReady?.(presenter);
    return () => {
      presenter.clear();
      presenter.stage.destroy();
      presenterRef.current = null;
    };
    // onReady is intentionally excluded — we only want to mount once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`sb-presentation ${className ?? ''}`}>
      <div className="sb-dom-layer" ref={domRootRef} />
      <canvas className="sb-canvas-layer" ref={canvasRef} />
    </div>
  );
}
