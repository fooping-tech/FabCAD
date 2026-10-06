import type { PrintJob } from "@fabcad/fabrication-print";
import { type ReactElement, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useStore } from "../app/tinyStore";
import { printUiState, selectPrintPart } from "./uiState";
import { sourceBodyId } from "./bodies";
import { createViewRenderer, type ViewRenderer } from "../viewport/softwareRenderer";

const COLORS = {
  background: 0xeef1f4,
  bed: 0xdfe5ea,
  grid: 0xb9c4ce,
  gridMajor: 0x8e9caa,
  volume: 0x8e9caa,
  part: 0xefa562,
  selected: 0x4b8bb9,
  overhang: 0xd0453a,
  unplaced: 0x9aa5af,
};

/** The print bed with the parts as they will be printed; overhangs are shown in red. */
class BedScene {
  readonly renderer: ViewRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 1, 20000);
  private controls: OrbitControls;
  private bedRoot = new THREE.Group();
  private partRoot = new THREE.Group();
  private frame = 0;
  private dirty = true;
  private disposed = false;
  private bedKey = "";
  private rig = new THREE.Group();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = createViewRenderer(canvas, { antialias: true }).renderer;
    this.renderer.setClearColor(COLORS.background);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener("change", () => this.invalidate());
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1, -1.4, 2);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(-1.5, 1, 0.6);
    this.rig.add(key, fill);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d99a6, 1.15), this.rig);
    this.scene.add(this.bedRoot, this.partRoot);
    this.loop();
  }

  invalidate(): void {
    this.dirty = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    if (!this.dirty) return;
    this.dirty = false;
    this.rig.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);
  };

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  private clear(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
  }

  setBed(bed: { width: number; depth: number; height: number }): void {
    const key = `${bed.width}x${bed.depth}x${bed.height}`;
    if (key === this.bedKey) return;
    const first = this.bedKey === "";
    this.bedKey = key;
    this.clear(this.bedRoot);
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(bed.width, bed.depth),
      new THREE.MeshBasicMaterial({ color: COLORS.bed, side: THREE.DoubleSide }),
    );
    plate.position.set(bed.width / 2, bed.depth / 2, -0.05);
    this.bedRoot.add(plate);

    // Grid every 10 mm, heavier every 50 mm.
    const minor: number[] = [];
    const major: number[] = [];
    for (let x = 0; x <= bed.width + 1e-6; x += 10) {
      (Math.round(x) % 50 === 0 ? major : minor).push(x, 0, 0, x, bed.depth, 0);
    }
    for (let y = 0; y <= bed.depth + 1e-6; y += 10) {
      (Math.round(y) % 50 === 0 ? major : minor).push(0, y, 0, bed.width, y, 0);
    }
    const lines = (points: number[], color: number, opacity: number): THREE.LineSegments => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
      return new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
      );
    };
    this.bedRoot.add(lines(minor, COLORS.grid, 0.7), lines(major, COLORS.gridMajor, 0.8));

    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bed.width, bed.depth, bed.height)),
      new THREE.LineBasicMaterial({ color: COLORS.volume, transparent: true, opacity: 0.45 }),
    );
    box.position.set(bed.width / 2, bed.depth / 2, bed.height / 2);
    this.bedRoot.add(box);

    // Axes at the front left corner.
    const axis = (to: [number, number, number], color: number): THREE.Line =>
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...to)]),
        new THREE.LineBasicMaterial({ color }),
      );
    this.bedRoot.add(axis([30, 0, 0], 0xd0453a), axis([0, 30, 0], 0x3d9a4a), axis([0, 0, 30], 0x3a6fd0));
    if (first) this.fit(bed);
    this.invalidate();
  }

  fit(bed: { width: number; depth: number; height: number }): void {
    const target = new THREE.Vector3(bed.width / 2, bed.depth / 2, Math.min(bed.height, 60) / 2);
    const radius = Math.hypot(bed.width, bed.depth) / 2;
    const fov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const aspect = Math.min(1, this.camera.aspect);
    const distance = (radius / Math.sin(fov) / aspect) * 1.05;
    const dir = new THREE.Vector3(0.55, -1, 0.7).normalize();
    this.camera.position.copy(target).addScaledVector(dir, distance);
    this.controls.target.copy(target);
    this.controls.update();
    this.invalidate();
  }

  setJob(job: PrintJob | null, selected: string | null, showOverhangs: boolean): void {
    this.clear(this.partRoot);
    if (job) {
      for (const part of job.parts) {
        // Per-triangle colours need unshared vertices.
        const ix = part.mesh.indices;
        const src = part.mesh.positions;
        const positions = new Float32Array(ix.length * 3);
        const colors = new Float32Array(ix.length * 3);
        const base = new THREE.Color(
          !part.placed ? COLORS.unplaced : sourceBodyId(part.bodyId) === selected ? COLORS.selected : COLORS.part,
        );
        const red = new THREE.Color(COLORS.overhang);
        for (let i = 0; i < ix.length; i++) {
          const v = ix[i]! * 3;
          positions[i * 3] = src[v]!;
          positions[i * 3 + 1] = src[v + 1]!;
          positions[i * 3 + 2] = src[v + 2]!;
          const c = showOverhangs && part.overhang[Math.floor(i / 3)] ? red : base;
          colors[i * 3] = c.r;
          colors[i * 3 + 1] = c.g;
          colors[i * 3 + 2] = c.b;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        g.computeVertexNormals();
        const mesh = new THREE.Mesh(
          g,
          new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.7,
            metalness: 0.02,
            flatShading: true,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
            transparent: !part.placed,
            opacity: part.placed ? 1 : 0.45,
          }),
        );
        mesh.userData.bodyId = part.bodyId;
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(g, 25),
          new THREE.LineBasicMaterial({ color: 0x2b3d4e, transparent: true, opacity: 0.55 }),
        );
        const group = new THREE.Group();
        group.add(mesh, edges);
        if (!part.placed) group.position.set(-part.size.x - 20, 0, 0);
        this.partRoot.add(group);
      }
    }
    this.invalidate();
  }

  pick(x: number, y: number, width: number, height: number): string | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), this.camera);
    const meshes: THREE.Object3D[] = [];
    this.partRoot.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes.push(o);
    });
    const hit = ray.intersectObjects(meshes, false)[0];
    // A copy (an instance of a component) selects the body it is printed from.
    return hit ? sourceBodyId(hit.object.userData.bodyId as string) : null;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.clear(this.bedRoot);
    this.clear(this.partRoot);
    this.renderer.dispose();
  }
}

export function PrintView({ job, stale }: { job: PrintJob | null; stale: boolean }): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BedScene | null>(null);
  const ui = useStore(printUiState);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const scene = new BedScene(canvas);
    sceneRef.current = scene;
    const resize = (): void => {
      const r = host.getBoundingClientRect();
      scene.resize(r.width, r.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent): void => {
      down = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent): void => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = canvas.getBoundingClientRect();
      selectPrintPart(scene.pick(e.clientX - r.left, e.clientY - r.top, r.width, r.height));
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    const onMenu = (e: MouseEvent): void => e.preventDefault();
    canvas.addEventListener("contextmenu", onMenu);
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("contextmenu", onMenu);
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (job) scene.setBed(job.printer.bed);
    scene.setJob(job, ui.selectedBodyId, ui.showOverhangs);
  }, [job, ui.selectedBodyId, ui.showOverhangs]);

  const overhang = job?.parts.some((p) => p.overhangArea > 1) ?? false;
  return (
    <div className="print-view" ref={hostRef}>
      <canvas ref={canvasRef} />
      <div className="print-legend">
        <span className="legend">
          <span>
            <i style={{ borderColor: "#efa562" }} />
            Part
          </span>
          <label style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={ui.showOverhangs}
              onChange={(e) => printUiState.set({ showOverhangs: e.target.checked })}
            />
            <i style={{ borderColor: "#d0453a", marginRight: 0 }} />
            Needs support
          </label>
        </span>
        {job && (
          <span className="print-bed-size">
            Bed {job.printer.bed.width} × {job.printer.bed.depth} × {job.printer.bed.height} mm
            {stale ? " · updating…" : ""}
          </span>
        )}
      </div>
      <div className="view-tools">
        <div className="view-card">
          <div className="view-row">
            <button onClick={() => job && sceneRef.current?.fit(job.printer.bed)} title="Show the whole bed">
              Fit
            </button>
          </div>
        </div>
      </div>
      {!job && (
        <div className="overlay-note">
          <div className="overlay-card">
            <h3>Nothing to print yet</h3>
            <p>Design a body in the DESIGN workspace, or tick a body on the left.</p>
          </div>
        </div>
      )}
      {job && !overhang && job.parts.length > 0 && (
        <div className="print-ok badge ok">No supports needed</div>
      )}
    </div>
  );
}
