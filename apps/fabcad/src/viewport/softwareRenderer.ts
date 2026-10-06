import * as THREE from "three";

/**
 * What the viewports need from a renderer. `THREE.WebGLRenderer` is one; `SoftwareRenderer` is
 * the other, for browsers without WebGL (cloud browsers of AI agents, locked-down machines).
 */
export interface ViewRenderer {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(ratio: number): void;
  setClearColor(color: THREE.ColorRepresentation): void;
  dispose(): void;
}

/** `?renderer=software` forces the software renderer, to see what a browser without WebGL sees. */
const softwareForced = (): boolean => {
  try {
    return new URLSearchParams(window.location.search).get("renderer") === "software";
  } catch {
    return false;
  }
};

/** Once WebGL has failed, the other views do not try again. */
let webglFailed = false;

/**
 * A WebGL renderer on `canvas`, or the software renderer when WebGL cannot be had. A failed
 * WebGL attempt leaves the canvas without a context, so the 2D one can still be taken.
 */
export const createViewRenderer = (
  canvas: HTMLCanvasElement,
  options: { antialias?: boolean; alpha?: boolean } = {},
): { renderer: ViewRenderer; software: boolean } => {
  if (!webglFailed && !softwareForced()) {
    try {
      return { renderer: new THREE.WebGLRenderer({ canvas, ...options }), software: false };
    } catch (err) {
      webglFailed = true;
      console.warn("WebGL is not available; the 3D view falls back to the software renderer.", err);
    }
  }
  return { renderer: new SoftwareRenderer(canvas), software: true };
};

interface Drawable {
  object: THREE.Mesh | THREE.LineSegments | THREE.Line | THREE.Points;
  material: THREE.Material;
  transparent: boolean;
  order: number;
  /** Meshes before lines before points, so that lines sit on the faces they bound. */
  rank: number;
}

const tmpColor = new THREE.Color();
const tmpVertexColor = new THREE.Color();

/** sRGB 0–255 components of a (linear) colour. */
const rgb = (c: THREE.Color): [number, number, number] => {
  c.getRGB(tmpColor.set(0, 0, 0), THREE.SRGBColorSpace);
  return [
    Math.round(Math.min(1, Math.max(0, tmpColor.r)) * 255),
    Math.round(Math.min(1, Math.max(0, tmpColor.g)) * 255),
    Math.round(Math.min(1, Math.max(0, tmpColor.b)) * 255),
  ];
};

const materialColor = (m: THREE.Material): THREE.Color =>
  (m as THREE.MeshBasicMaterial).color ?? new THREE.Color(0xffffff);

/**
 * A small z-buffer rasteriser on a 2D canvas: flat-shaded triangles, depth-tested lines and
 * points, with the materials' colour, opacity, depth test and depth write. It draws only on
 * demand (the viewports render when something changed), at one pixel per CSS pixel. Lighting is
 * a fixed light from the viewer's upper left, not the scene's lights.
 */
export class SoftwareRenderer implements ViewRenderer {
  private context: CanvasRenderingContext2D | null;
  private width = 1;
  private height = 1;
  private clear: [number, number, number] = [255, 255, 255];
  private image: ImageData | null = null;
  private pixels = new Uint8ClampedArray(0);
  private depth = new Float32Array(0);

  constructor(private canvas: HTMLCanvasElement) {
    this.context = canvas.getContext("2d");
  }

  setPixelRatio(): void {
    // One pixel per CSS pixel: the cost grows with the pixel count.
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.image = null;
  }

  setClearColor(color: THREE.ColorRepresentation): void {
    this.clear = rgb(new THREE.Color(color));
  }

  dispose(): void {
    this.image = null;
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    const ctx = this.context;
    if (!ctx) return;
    const w = this.width;
    const h = this.height;
    if (!this.image || this.image.width !== w || this.image.height !== h) {
      this.image = ctx.createImageData(w, h);
      this.pixels = this.image.data;
      this.depth = new Float32Array(w * h);
    }
    const px = this.pixels;
    const [cr, cg, cb] = this.clear;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = cr;
      px[i + 1] = cg;
      px[i + 2] = cb;
      px[i + 3] = 255;
    }
    this.depth.fill(Infinity);

    scene.updateMatrixWorld();
    if (camera.parent === null) camera.updateMatrixWorld();
    const view = new Projector(camera, w, h);

    const drawables: Drawable[] = [];
    const collect = (object: THREE.Object3D): void => {
      if (!object.visible) return;
      const o = object as THREE.Mesh;
      if ((o as unknown as THREE.Points).isPoints || (o as unknown as THREE.Line).isLine || o.isMesh) {
        const material = Array.isArray(o.material) ? o.material[0] : o.material;
        if (material && material.visible) {
          drawables.push({
            object: o,
            material,
            transparent: material.transparent && material.opacity < 1,
            order: object.renderOrder,
            rank: o.isMesh ? 0 : (o as unknown as THREE.Points).isPoints ? 2 : 1,
          });
        }
      }
      for (const child of object.children) collect(child);
    };
    collect(scene);
    drawables.sort(
      (a, b) =>
        Number(a.transparent) - Number(b.transparent) || a.order - b.order || a.rank - b.rank,
    );
    for (const d of drawables) {
      if ((d.object as THREE.Mesh).isMesh) this.drawMesh(d.object as THREE.Mesh, d.material, view);
      else if ((d.object as THREE.Points).isPoints) this.drawPoints(d.object as THREE.Points, d.material, view);
      else this.drawLines(d.object as THREE.Line, d.material, view);
    }
    ctx.putImageData(this.image, 0, 0);
  }

  // ------------------------------------------------------------------ meshes

  private drawMesh(mesh: THREE.Mesh, material: THREE.Material, view: Projector): void {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const index = geometry.getIndex();
    const vertexColors = (material as THREE.MeshStandardMaterial).vertexColors
      ? geometry.getAttribute("color")
      : undefined;
    const lit = !(material as THREE.MeshBasicMaterial).isMeshBasicMaterial;
    const base = materialColor(material);
    const opacity = material.transparent ? material.opacity : 1;
    // A negative polygon offset (highlights) draws on top of the coplanar face below.
    const onTop = material.polygonOffset && material.polygonOffsetFactor < 0;
    const test = material.depthTest;
    const write = material.depthWrite && opacity >= 1;

    const v = view.transform(position, mesh.matrixWorld);
    const count = index ? index.count : position.count;
    for (let t = 0; t + 2 < count; t += 3) {
      const a = index ? index.getX(t) : t;
      const b = index ? index.getX(t + 1) : t + 1;
      const c = index ? index.getX(t + 2) : t + 2;
      if (v.clipped[a] || v.clipped[b] || v.clipped[c]) continue;
      let shade = 1;
      if (lit) {
        // Flat shading from the view-space normal; double-sided.
        const e = v.eye;
        const ux = e[b * 3]! - e[a * 3]!, uy = e[b * 3 + 1]! - e[a * 3 + 1]!, uz = e[b * 3 + 2]! - e[a * 3 + 2]!;
        const wx = e[c * 3]! - e[a * 3]!, wy = e[c * 3 + 1]! - e[a * 3 + 1]!, wz = e[c * 3 + 2]! - e[a * 3 + 2]!;
        let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const len = Math.hypot(nx, ny, nz);
        if (len === 0) continue;
        nx /= len; ny /= len; nz /= len;
        if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
        // Light from the viewer's upper left, like the key light that follows the camera.
        shade = 0.5 + 0.5 * Math.max(0, -0.3 * nx + 0.45 * ny + 0.84 * nz);
      }
      tmpVertexColor.copy(base);
      if (vertexColors) {
        tmpVertexColor.multiply(
          new THREE.Color(
            (vertexColors.getX(a) + vertexColors.getX(b) + vertexColors.getX(c)) / 3,
            (vertexColors.getY(a) + vertexColors.getY(b) + vertexColors.getY(c)) / 3,
            (vertexColors.getZ(a) + vertexColors.getZ(b) + vertexColors.getZ(c)) / 3,
          ),
        );
      }
      tmpVertexColor.multiplyScalar(shade);
      const [r, g, bl] = rgb(tmpVertexColor);
      this.fillTriangle(v, a, b, c, r, g, bl, opacity, test, write, onTop ? view.bias : 0);
    }
  }

  private fillTriangle(
    v: Projected, a: number, b: number, c: number,
    r: number, g: number, bl: number, opacity: number,
    test: boolean, write: boolean, bias: number,
  ): void {
    const s = v.screen;
    const ax = s[a * 3]!, ay = s[a * 3 + 1]!, ad = s[a * 3 + 2]!;
    const bx = s[b * 3]!, by = s[b * 3 + 1]!, bd = s[b * 3 + 2]!;
    const cx = s[c * 3]!, cy = s[c * 3 + 1]!, cd = s[c * 3 + 2]!;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (area === 0) return;
    const w = this.width;
    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(ay, by, cy)));
    if (minX > maxX || minY > maxY) return;
    const inv = 1 / area;
    const px = this.pixels;
    const depth = this.depth;
    for (let y = minY; y <= maxY; y++) {
      const sy = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const sx = x + 0.5;
        const w0 = ((bx - sx) * (cy - sy) - (by - sy) * (cx - sx)) * inv;
        const w1 = ((cx - sx) * (ay - sy) - (cy - sy) * (ax - sx)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // `d` is affine in screen space (1/depth in perspective, depth in orthographic).
        const q = w0 * ad + w1 * bd + w2 * cd;
        const z = v.depthOf(q);
        const i = y * w + x;
        if (test && z > depth[i]! + bias) continue;
        if (write) depth[i] = z;
        this.blend(i, r, g, bl, opacity);
      }
    }
  }

  // ------------------------------------------------------------------- lines

  private drawLines(line: THREE.Line, material: THREE.Material, view: Projector): void {
    const position = line.geometry.getAttribute("position");
    if (!position) return;
    const index = line.geometry.getIndex();
    const [r, g, b] = rgb(materialColor(material));
    const opacity = material.transparent ? material.opacity : 1;
    const thick = ((material as THREE.LineBasicMaterial).linewidth ?? 1) > 1;
    const test = material.depthTest;
    const v = view.transform(position, line.matrixWorld);
    const count = index ? index.count : position.count;
    const segments = (line as THREE.LineSegments).isLineSegments;
    const step = segments ? 2 : 1;
    for (let k = 0; k + 1 < count; k += step) {
      const i0 = index ? index.getX(k) : k;
      const i1 = index ? index.getX(k + 1) : k + 1;
      const seg = view.segment(v, i0, i1);
      if (seg) this.strokeSegment(seg, r, g, b, opacity, test, view.bias, thick, view.depthOf);
    }
  }

  private strokeSegment(
    seg: [number, number, number, number, number, number],
    r: number, g: number, b: number, opacity: number,
    test: boolean, bias: number, thick: boolean, depthOf: (q: number) => number,
  ): void {
    const [x0, y0, z0, x1, y1, z1] = seg;
    const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    if (steps > 20000) return;
    const w = this.width;
    const h = this.height;
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      const x = Math.floor(x0 + (x1 - x0) * t);
      const y = Math.floor(y0 + (y1 - y0) * t);
      // The key is affine in screen space; the depth itself is not, in perspective.
      const z = depthOf(z0 + (z1 - z0) * t);
      for (let o = 0; o < (thick ? 4 : 1); o++) {
        const xx = x + (o & 1);
        const yy = y + (o >> 1);
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const i = yy * w + xx;
        if (test && z > this.depth[i]! + bias) continue;
        this.blend(i, r, g, b, opacity);
      }
    }
  }

  // ------------------------------------------------------------------ points

  private drawPoints(points: THREE.Points, material: THREE.Material, view: Projector): void {
    const position = points.geometry.getAttribute("position");
    if (!position) return;
    const [r, g, b] = rgb(materialColor(material));
    const opacity = material.transparent ? material.opacity : 1;
    const half = Math.max(1, Math.round(((material as THREE.PointsMaterial).size ?? 4) / 2));
    const test = material.depthTest;
    const v = view.transform(position, points.matrixWorld);
    for (let k = 0; k < position.count; k++) {
      if (v.clipped[k]) continue;
      const cx = Math.floor(v.screen[k * 3]!);
      const cy = Math.floor(v.screen[k * 3 + 1]!);
      const z = v.depthOf(v.screen[k * 3 + 2]!);
      for (let y = cy - half; y < cy + half; y++) {
        for (let x = cx - half; x < cx + half; x++) {
          if (x < 0 || y < 0 || x >= this.width || y >= this.height) continue;
          const i = y * this.width + x;
          if (test && z > this.depth[i]! + view.bias) continue;
          this.blend(i, r, g, b, opacity);
        }
      }
    }
  }

  private blend(i: number, r: number, g: number, b: number, opacity: number): void {
    const p = i * 4;
    const px = this.pixels;
    if (opacity >= 1) {
      px[p] = r;
      px[p + 1] = g;
      px[p + 2] = b;
      return;
    }
    px[p] = px[p]! + (r - px[p]!) * opacity;
    px[p + 1] = px[p + 1]! + (g - px[p + 1]!) * opacity;
    px[p + 2] = px[p + 2]! + (b - px[p + 2]!) * opacity;
  }
}

interface Projected {
  /** View-space positions. */
  eye: Float64Array;
  /** Pixel x, y and the affine depth key per vertex. */
  screen: Float64Array;
  /** Behind the near plane (perspective). */
  clipped: Uint8Array;
  depthOf(q: number): number;
}

/** Camera maths shared by the drawables of one frame. */
class Projector {
  readonly perspective: boolean;
  readonly near: number;
  /** Depth tolerance of lines and points against the faces they lie on. */
  readonly bias: number;
  private viewMatrix: THREE.Matrix4;
  private projection: THREE.Matrix4;

  constructor(camera: THREE.Camera, private width: number, private height: number) {
    this.perspective = (camera as THREE.PerspectiveCamera).isPerspectiveCamera === true;
    this.near = this.perspective ? (camera as THREE.PerspectiveCamera).near : -Infinity;
    this.viewMatrix = camera.matrixWorldInverse;
    this.projection = camera.projectionMatrix;
    // A thousandth of the distance to the origin of the scene, at least a hundredth of a unit.
    const distance = camera.getWorldPosition(new THREE.Vector3()).length();
    this.bias = Math.max(0.01, distance * 2e-3);
  }

  depthOf = (q: number): number => (this.perspective ? 1 / q : q);

  transform(position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, world: THREE.Matrix4): Projected {
    const n = position.count;
    const eye = new Float64Array(n * 3);
    const screen = new Float64Array(n * 3);
    const clipped = new Uint8Array(n);
    const m = new THREE.Matrix4().multiplyMatrices(this.viewMatrix, world).elements;
    const p = this.projection.elements;
    for (let i = 0; i < n; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const ex = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
      const ey = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
      const ez = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
      eye[i * 3] = ex;
      eye[i * 3 + 1] = ey;
      eye[i * 3 + 2] = ez;
      const d = -ez;
      if (this.perspective && d < this.near) {
        clipped[i] = 1;
        continue;
      }
      const [sx, sy] = this.toScreen(ex, ey, ez, p);
      screen[i * 3] = sx;
      screen[i * 3 + 1] = sy;
      screen[i * 3 + 2] = this.perspective ? 1 / d : d;
    }
    return { eye, screen, clipped, depthOf: this.depthOf };
  }

  private toScreen(ex: number, ey: number, ez: number, p: ArrayLike<number>): [number, number] {
    const cx = p[0]! * ex + p[4]! * ey + p[8]! * ez + p[12]!;
    const cy = p[1]! * ex + p[5]! * ey + p[9]! * ez + p[13]!;
    const cw = p[3]! * ex + p[7]! * ey + p[11]! * ez + p[15]!;
    return [((cx / cw) * 0.5 + 0.5) * this.width, (-(cy / cw) * 0.5 + 0.5) * this.height];
  }

  /** A segment in pixels with the affine depth key at both ends, cut at the near plane. */
  segment(v: Projected, i0: number, i1: number): [number, number, number, number, number, number] | null {
    if (!v.clipped[i0] && !v.clipped[i1]) {
      const s = v.screen;
      return [s[i0 * 3]!, s[i0 * 3 + 1]!, s[i0 * 3 + 2]!, s[i1 * 3]!, s[i1 * 3 + 1]!, s[i1 * 3 + 2]!];
    }
    if (v.clipped[i0] && v.clipped[i1]) return null;
    const [inside, outside] = v.clipped[i0] ? [i1, i0] : [i0, i1];
    const e = v.eye;
    const dIn = -e[inside * 3 + 2]!;
    const dOut = -e[outside * 3 + 2]!;
    const t = (dIn - this.near) / (dIn - dOut);
    const cut = [0, 1, 2].map((k) => e[inside * 3 + k]! + (e[outside * 3 + k]! - e[inside * 3 + k]!) * t);
    const [cx, cy] = this.toScreen(cut[0]!, cut[1]!, cut[2]!, this.projection.elements);
    const s = v.screen;
    return [s[inside * 3]!, s[inside * 3 + 1]!, s[inside * 3 + 2]!, cx, cy, 1 / this.near];
  }
}
