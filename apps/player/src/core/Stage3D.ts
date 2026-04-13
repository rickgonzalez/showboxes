import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

/**
 * Stage3D — Three.js-backed 3D rendering layer.
 *
 * Owns:
 *   - A WebGL scene + camera + renderer (renders into a sibling <canvas>).
 *   - A CSS2DRenderer layered on top for crisp text labels (nodes, edge labels).
 *
 * Mirrors Stage's surface: add/remove items, a render loop driven by rAF,
 * resize handling via ResizeObserver, and destroy() for cleanup.
 *
 * Templates (flow-diagram, etc.) treat this as a high-level scene:
 * they push Object3Ds into the scene and let the stage draw them.
 */

export interface Stage3DItem {
  object: THREE.Object3D;
  /** Optional per-frame update hook for animated items. */
  update?(dt: number, elapsed: number): void;
}

export class Stage3D {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly cssRenderer: CSS2DRenderer;
  readonly glCanvas: HTMLCanvasElement;
  readonly cssRoot: HTMLElement;

  width = 0;
  height = 0;

  private items: Stage3DItem[] = [];
  private rafId = 0;
  private lastTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  private host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;

    // WebGL canvas.
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.className = 'sb-canvas3d-layer';
    host.appendChild(this.glCanvas);

    // CSS overlay for crisp text.
    this.cssRoot = document.createElement('div');
    this.cssRoot.className = 'sb-css3d-layer';
    host.appendChild(this.cssRoot);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.glCanvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setClearColor(0x000000, 0);

    this.cssRenderer = new CSS2DRenderer({ element: this.cssRoot });

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.camera.position.set(0, 0, 12);

    // Ambient + key light — gentle setup, enough to give rounded-box nodes depth.
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.8);
    key.position.set(5, 8, 6);
    this.scene.add(key);

    this.syncSize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.syncSize());
      this.resizeObserver.observe(host);
    }

    this.start();
  }

  add(item: Stage3DItem): void {
    this.items.push(item);
    this.scene.add(item.object);
  }

  remove(item: Stage3DItem): void {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    detachCSS2DElements(item.object);
    this.scene.remove(item.object);
  }

  /** Remove all items added via add(). Preserves lights. */
  clear(): void {
    for (const item of this.items) {
      detachCSS2DElements(item.object);
      this.scene.remove(item.object);
      disposeObject(item.object);
    }
    this.items = [];
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.clear();
    this.renderer.dispose();
    this.glCanvas.remove();
    this.cssRoot.remove();
  }

  /** Create a CSS2D label object — crisp HTML text in 3D space. */
  makeLabel(text: string, className = 'sb-3d-label'): CSS2DObject {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    return new CSS2DObject(el);
  }

  private syncSize(): void {
    const rect = this.host.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    if (this.width <= 0 || this.height <= 0) return;

    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(this.width, this.height, false);
    this.cssRenderer.setSize(this.width, this.height);

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  private start(): void {
    const loop = (ts: number) => {
      const dt = this.lastTime ? (ts - this.lastTime) / 1000 : 0;
      this.lastTime = ts;
      for (const item of this.items) item.update?.(dt, ts / 1000);
      this.renderer.render(this.scene, this.camera);
      this.cssRenderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }
}

/**
 * CSS2DRenderer parents each CSS2DObject's DOM element to its own overlay
 * root on first render, and only removes elements for objects it still sees
 * in the scene tree. If we remove an object without cleanup, its element
 * gets orphaned and lingers on top of the stage. Walk the subtree and
 * detach any CSS2DObject elements ourselves before removal.
 */
function detachCSS2DElements(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const el = (obj as unknown as { element?: HTMLElement }).element;
    if (el && el.parentNode) el.parentNode.removeChild(el);
  });
}

/** Recursively dispose geometries + materials under a root object. */
function disposeObject(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose?.();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.());
    else mat?.dispose?.();
  });
}
