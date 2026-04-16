/**
 * Stage owns the <canvas> element, the render loop, and the list of
 * renderable items. It is deliberately minimal — no scene graph, no
 * z-index management beyond insertion order. Items are drawn each frame
 * in the order they were added.
 *
 * Items are expected to manage their own offscreen caches (see TextBox),
 * so the per-frame work here is just clear → drawImage → drawImage → ...
 */

export interface Renderable {
  render(ctx: CanvasRenderingContext2D): void;
}

export class Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;

  /** Logical (CSS) width of the canvas. */
  width = 0;
  /** Logical (CSS) height of the canvas. */
  height = 0;

  private dpr = 1;
  private items: Renderable[] = [];
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('showboxes: 2D canvas context not available');
    this.ctx = ctx;
    this.dpr = window.devicePixelRatio || 1;

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);

    this.start();
  }

  add(item: Renderable): void {
    this.items.push(item);
  }

  remove(item: Renderable): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
  }

  clear(): void {
    this.items.length = 0;
  }

  destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
    this.items.length = 0;
  }

  private start(): void {
    const loop = () => {
      this.render();
      this.rafId = requestAnimationFrame(loop);
    };
    loop();
  }

  private stop(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private resize(): void {
    // Use clientWidth/Height — untransformed CSS size. getBoundingClientRect
    // returns post-transform pixels, which breaks when the player is mounted
    // inside a CSS `transform: scale(...)` wrapper. Templates and showTextBox
    // positioning are authored against the design surface, not rendered pixels.
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.max(1, Math.round(w * this.dpr));
    this.canvas.height = Math.max(1, Math.round(h * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    for (const item of this.items) item.render(this.ctx);
  }
}
