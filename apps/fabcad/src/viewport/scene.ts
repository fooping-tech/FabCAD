import type { BodyGeometry } from "@fabcad/brep";
import {
  ORIGIN_PLANES,
  type OriginPlaneName,
  type Plane3,
  type Vec2,
  type Vec3,
} from "@fabcad/geometry";
import type { PlanePatch } from "@fabcad/features";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { COLORS } from "./theme";

/**
 * Imperative Three.js scene behind the 3D viewport. It knows nothing about documents or
 * React: bodies come in as tessellated geometry, picks go out as plain data.
 */

export type ViewName = "front" | "back" | "left" | "right" | "top" | "bottom" | "iso";

/**
 * `ghost`: picked on a ghost (another component, seen from the one being edited); points and
 * normals are where the ghost is drawn, indices those of the body.
 */
export type Pick3D =
  | { kind: "face"; bodyId: string; faceIndex: number; point: Vec3; normal: Vec3; planar: boolean; ghost?: string }
  | { kind: "edge"; bodyId: string; edgeIndex: number; point: Vec3; ghost?: string }
  | { kind: "vertex"; bodyId: string; vertexIndex: number; point: Vec3; ghost?: string }
  | { kind: "origin-plane"; plane: OriginPlaneName }
  | { kind: "plane"; featureId: string }
  /** An instance of a component, as a whole: its faces and edges are not picked. */
  | { kind: "instance"; instanceId: string };

export interface PickOptions {
  faces?: boolean;
  edges?: boolean;
  vertices?: boolean;
  /** Origin planes and construction planes. */
  originPlanes?: boolean;
  /** Component instances (on by default). They hide what lies behind them either way. */
  instances?: boolean;
  /** Ghosts (off by default): faces, edges and vertices of the other components. */
  ghosts?: boolean;
}

/** A placed component: the bodies of its definition, shown at `matrix`. */
export interface InstanceView {
  id: string;
  /** Row-major 4×4 placement. */
  matrix: number[];
  bodyIds: string[];
}

export type Highlight =
  | { kind: "body"; bodyId: string }
  | { kind: "face"; bodyId: string; faceIndex: number; ghost?: string }
  | { kind: "edge"; bodyId: string; edgeIndex: number; ghost?: string }
  | { kind: "vertex"; bodyId: string; point: Vec3 }
  | { kind: "origin-plane"; plane: OriginPlaneName }
  | { kind: "plane"; featureId: string }
  | { kind: "instance"; instanceId: string };

interface InstanceEntry {
  key: string;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  material: THREE.MeshStandardMaterial;
  edgeMaterial: THREE.LineBasicMaterial;
}

interface BodyEntry {
  id: string;
  hash: string;
  geometry: BodyGeometry;
  group: THREE.Group;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  material: THREE.MeshStandardMaterial;
}

const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 0, 1],
  bottom: [0, 0, -1],
  iso: [1, -1, 0.8],
};

const PLANE_COLORS: Record<OriginPlaneName, number> = {
  XY: COLORS.planeXY,
  XZ: COLORS.planeXZ,
  YZ: COLORS.planeYZ,
};

const toV3 = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);
const fromV3 = (v: THREE.Vector3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export class ViewportScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly perspective: THREE.PerspectiveCamera;
  readonly orthographic: THREE.OrthographicCamera;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly controls: OrbitControls;

  private bodies = new Map<string, BodyEntry>();
  private bodyRoot = new THREE.Group();
  private instanceRoot = new THREE.Group();
  private instances = new Map<string, InstanceEntry>();
  private ghostRoot = new THREE.Group();
  private ghosts = new Map<string, InstanceEntry & { matrix: THREE.Matrix4; bodyIds: string[] }>();
  private transparent = false;
  private originRoot = new THREE.Group();
  private highlightRoot = new THREE.Group();
  private originPlanes = new Map<OriginPlaneName, THREE.Mesh>();
  private originAxes = new Map<string, THREE.Object3D>();
  private planeRoot = new THREE.Group();
  private planes = new Map<string, { key: string; mesh: THREE.Mesh }>();
  private planePreview: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private width = 1;
  private height = 1;
  private needsRender = true;
  private frame = 0;
  private disposed = false;
  private animation: { start: number; duration: number; fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromUp: THREE.Vector3; toUp: THREE.Vector3 } | null = null;
  private listeners = new Set<() => void>();
  private originSize = 60;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(COLORS.background);

    this.perspective = new THREE.PerspectiveCamera(35, 1, 0.1, 100000);
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, -100000, 100000);
    for (const cam of [this.perspective, this.orthographic]) {
      cam.up.set(0, 0, 1);
      cam.position.set(260, -320, 240);
    }
    this.camera = this.perspective;

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.zoomToCursor = true;
    this.controls.zoomSpeed = 1.4;
    this.controls.rotateSpeed = 0.9;
    this.controls.screenSpacePanning = true;
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.target.set(0, 0, 0);
    this.controls.addEventListener("change", () => {
      this.syncOrthographic();
      this.invalidate();
      this.emit();
    });
    this.controls.update();

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d99a6, 1.15);
    hemi.position.set(0, 0, 1);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1, -1.4, 2);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(-1.5, 1, 0.6);
    // Lights follow the camera so that faces never go black while orbiting.
    const rig = new THREE.Group();
    rig.add(key, fill);
    this.scene.add(hemi, rig);
    this.lightRig = rig;

    this.scene.add(this.originRoot, this.planeRoot, this.bodyRoot, this.instanceRoot, this.ghostRoot, this.highlightRoot);
    this.buildOrigin();
    this.loop();
  }

  private lightRig: THREE.Group;

  // ---------------------------------------------------------------- lifecycle

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  invalidate(): void {
    this.needsRender = true;
  }

  private loop = (): void => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    if (this.animation) this.stepAnimation();
    if (!this.needsRender) return;
    this.needsRender = false;
    this.lightRig.quaternion.copy(this.camera.quaternion);
    this.renderer.render(this.scene, this.camera);
  };

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(width, height, false);
    this.perspective.aspect = width / height;
    this.perspective.updateProjectionMatrix();
    this.syncOrthographic();
    this.invalidate();
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    this.setInstances([]);
    this.setGhosts([]);
    for (const id of [...this.bodies.keys()]) this.removeBody(id);
    this.renderer.dispose();
    this.listeners.clear();
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  // ------------------------------------------------------------------ cameras

  /** Keep the orthographic frustum equivalent to the perspective view at the target distance. */
  private syncOrthographic(): void {
    const distance = this.camera.position.distanceTo(this.controls.target);
    const aspect = this.width / this.height;
    if (this.camera === this.perspective) {
      const halfH = distance * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      this.orthographic.top = halfH;
      this.orthographic.bottom = -halfH;
      this.orthographic.left = -halfH * aspect;
      this.orthographic.right = halfH * aspect;
      this.orthographic.zoom = 1;
    } else {
      const halfH = this.orthographic.top;
      this.orthographic.left = -halfH * aspect;
      this.orthographic.right = halfH * aspect;
    }
    this.orthographic.updateProjectionMatrix();
  }

  setProjection(mode: "perspective" | "orthographic"): void {
    const next = mode === "perspective" ? this.perspective : this.orthographic;
    if (next === this.camera) return;
    const target = this.controls.target;
    const dir = this.camera.position.clone().sub(target);
    let distance = dir.length();
    dir.normalize();
    if (next === this.perspective) {
      // Match the visible height of the orthographic view.
      const halfH = this.orthographic.top / this.orthographic.zoom;
      distance = halfH / Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    } else {
      const halfH = distance * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      this.orthographic.top = halfH;
      this.orthographic.bottom = -halfH;
      this.orthographic.zoom = 1;
    }
    next.position.copy(target).addScaledVector(dir, distance);
    next.up.copy(this.camera.up);
    next.lookAt(target);
    this.camera = next;
    this.controls.object = next;
    this.syncOrthographic();
    this.controls.update();
    this.invalidate();
    this.emit();
  }

  /**
   * Left mouse button and one-finger touch: orbit in the solid environment, reserved for tools
   * while sketching. Two fingers always pan and zoom.
   */
  setLeftButtonOrbit(enabled: boolean): void {
    this.controls.mouseButtons.LEFT = enabled ? THREE.MOUSE.ROTATE : (-1 as THREE.MOUSE);
    this.controls.touches.ONE = enabled ? THREE.TOUCH.ROTATE : (-1 as THREE.TOUCH);
  }

  /** What a one-finger drag does for the gesture that is about to start. */
  setOneFingerGesture(mode: "rotate" | "pan" | "none"): void {
    this.controls.touches.ONE =
      mode === "rotate" ? THREE.TOUCH.ROTATE : mode === "pan" ? THREE.TOUCH.PAN : (-1 as THREE.TOUCH);
  }

  /** Pinch zoom follows the fingers one to one; the mouse wheel is a little faster. */
  setTouchInput(touch: boolean): void {
    this.controls.zoomSpeed = touch ? 1 : 1.4;
  }

  /**
   * Move the view by a number of pixels, as a two-finger swipe on a trackpad does: what is
   * shown follows the fingers (positive `dx`: the model moves left, positive `dy`: up).
   */
  panByPixels(dx: number, dy: number): void {
    const size = this.pixelSize(fromV3(this.controls.target));
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    const offset = right.multiplyScalar(dx * size).add(up.multiplyScalar(-dy * size));
    this.camera.position.add(offset);
    this.controls.target.add(offset);
    this.controls.update();
    this.syncOrthographic();
    this.invalidate();
    this.emit();
  }

  /** Suspend camera control while something else owns the pointer (e.g. a manipulator). */
  setControlsEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /**
   * Parameter t of the point on the axis `origin + t · direction` that is closest to the view
   * ray through a pixel. Null when the axis points straight at the camera.
   */
  axisParameter(x: number, y: number, origin: Vec3, direction: Vec3): number | null {
    const ray = this.setRay(x, y);
    const d = toV3(direction).normalize();
    const w = toV3(origin).sub(ray.origin);
    const b = d.dot(ray.direction);
    const den = 1 - b * b;
    if (den < 1e-4) return null;
    // Closest approach of two lines.
    return (b * w.dot(ray.direction) - w.dot(d)) / den;
  }

  // ------------------------------------------------------------------ preview

  private previewRoot = new THREE.Group();

  /** Translucent preview of a feature that has not been committed yet. */
  setExtrudePreview(
    preview: {
      plane: Plane3;
      regions: { outer: Vec2[]; holes: Vec2[][] }[];
      from: number;
      to: number;
      removing: boolean;
    } | null,
  ): void {
    if (!this.previewRoot.parent) this.scene.add(this.previewRoot);
    for (const child of [...this.previewRoot.children]) {
      this.previewRoot.remove(child);
      const obj = child as THREE.Mesh | THREE.LineSegments;
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
    this.invalidate();
    if (!preview) return;
    const depth = preview.to - preview.from;
    if (Math.abs(depth) < 1e-6) return;
    const lo = Math.min(preview.from, preview.to);
    const basis = new THREE.Matrix4().makeBasis(
      toV3(preview.plane.xDir),
      toV3(preview.plane.yDir),
      toV3(preview.plane.normal),
    );
    basis.setPosition(toV3(preview.plane.origin).addScaledVector(toV3(preview.plane.normal), lo));
    const color = preview.removing ? 0xd0453a : COLORS.selected;
    for (const region of preview.regions) {
      if (region.outer.length < 3) continue;
      const shape = new THREE.Shape(region.outer.map((p) => new THREE.Vector2(p.x, p.y)));
      for (const hole of region.holes) {
        shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
      }
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: Math.abs(depth),
        bevelEnabled: false,
        curveSegments: 1,
      });
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.applyMatrix4(basis);
      mesh.renderOrder = 3;
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 30),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }),
      );
      edges.applyMatrix4(basis);
      edges.renderOrder = 4;
      this.previewRoot.add(mesh, edges);
    }
  }

  private moveRoot = new THREE.Group();

  /**
   * Translucent copies of bodies where a Move puts them. `matrix` (column-major) is applied to
   * each body as it is shown now. The meshes of the bodies are shared, not copied.
   */
  setMovePreview(preview: { bodyIds: string[]; matrix: number[] } | null): void {
    if (!this.moveRoot.parent) this.scene.add(this.moveRoot);
    for (const child of [...this.moveRoot.children]) {
      this.moveRoot.remove(child);
      ((child as THREE.Mesh | THREE.LineSegments).material as THREE.Material).dispose();
    }
    this.invalidate();
    if (!preview) return;
    const matrix = new THREE.Matrix4().fromArray(preview.matrix);
    for (const id of preview.bodyIds) {
      const body = this.bodies.get(id);
      if (!body) continue;
      const mesh = new THREE.Mesh(
        body.mesh.geometry,
        new THREE.MeshBasicMaterial({
          color: COLORS.selected,
          transparent: true,
          opacity: 0.3,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      const edges = new THREE.LineSegments(
        body.edges.geometry,
        new THREE.LineBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.9 }),
      );
      for (const obj of [mesh, edges]) {
        obj.matrixAutoUpdate = false;
        obj.matrix.copy(matrix);
        obj.renderOrder = 3;
        // Picking goes to the bodies, not to their preview.
        obj.raycast = () => {};
      }
      edges.renderOrder = 4;
      this.moveRoot.add(mesh, edges);
    }
  }

  private currentDistance(): number {
    if (this.camera === this.orthographic) {
      const halfH = this.orthographic.top / this.orthographic.zoom;
      return halfH / Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
    }
    return this.camera.position.distanceTo(this.controls.target);
  }

  private animateTo(position: THREE.Vector3, target: THREE.Vector3, up: THREE.Vector3): void {
    if (this.camera === this.orthographic) {
      // Fold the orthographic zoom into the frustum so that distance alone defines the scale.
      const d = position.distanceTo(target);
      const halfH = d * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      this.orthographic.top = halfH;
      this.orthographic.bottom = -halfH;
      this.orthographic.zoom = 1;
      this.syncOrthographic();
    }
    this.animation = {
      start: performance.now(),
      duration: 260,
      fromPos: this.camera.position.clone(),
      toPos: position,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      fromUp: this.camera.up.clone(),
      toUp: up,
    };
  }

  private stepAnimation(): void {
    const a = this.animation;
    if (!a) return;
    const raw = Math.min(1, (performance.now() - a.start) / a.duration);
    const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
    // Interpolate the view direction on a sphere so that the model stays in view.
    const fromDir = a.fromPos.clone().sub(a.fromTarget);
    const toDir = a.toPos.clone().sub(a.toTarget);
    const fromLen = fromDir.length();
    const toLen = toDir.length();
    const q0 = new THREE.Quaternion();
    const q1 = new THREE.Quaternion().setFromUnitVectors(
      fromDir.clone().normalize(),
      toDir.clone().normalize(),
    );
    const q = q0.slerp(q1, t);
    const dir = fromDir.clone().normalize().applyQuaternion(q);
    const target = a.fromTarget.clone().lerp(a.toTarget, t);
    const len = fromLen + (toLen - fromLen) * t;
    this.camera.position.copy(target).addScaledVector(dir, len);
    this.camera.up.copy(a.fromUp).lerp(a.toUp, t).normalize();
    this.controls.target.copy(target);
    if (raw >= 1) {
      this.camera.position.copy(a.toPos);
      this.camera.up.copy(a.toUp);
      this.animation = null;
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
    this.syncOrthographic();
    this.invalidate();
    this.emit();
  }

  /** Snapshot of the camera, to return to after a temporary view such as a sketch. */
  saveView(): { position: Vec3; target: Vec3; up: Vec3 } {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    return {
      position: fromV3(this.controls.target.clone().addScaledVector(dir, this.currentDistance())),
      target: fromV3(this.controls.target),
      up: fromV3(this.camera.up),
    };
  }

  restoreView(view: { position: Vec3; target: Vec3; up: Vec3 }): void {
    this.animateTo(toV3(view.position), toV3(view.target), toV3(view.up));
  }

  setView(view: ViewName): void {
    const d = new THREE.Vector3(...VIEW_DIRECTIONS[view]).normalize();
    const up =
      view === "top"
        ? new THREE.Vector3(0, 1, 0)
        : view === "bottom"
          ? new THREE.Vector3(0, -1, 0)
          : new THREE.Vector3(0, 0, 1);
    const target = this.controls.target.clone();
    this.animateTo(target.clone().addScaledVector(d, this.currentDistance()), target, up);
  }

  /** Look straight at a plane (used when entering a sketch). */
  lookAtPlane(plane: Plane3, fit?: { center: Vec3; radius: number }): void {
    const normal = toV3(plane.normal);
    const target = fit ? toV3(fit.center) : toV3(plane.origin);
    const distance = fit ? this.fitDistance(fit.radius) : this.currentDistance();
    this.animateTo(target.clone().addScaledVector(normal, distance), target, toV3(plane.yDir));
  }

  private fitDistance(radius: number): number {
    const fov = THREE.MathUtils.degToRad(this.perspective.fov / 2);
    const aspect = Math.min(1, this.width / this.height);
    return (Math.max(radius, 1) / Math.sin(fov)) * (1 / aspect) * 1.35;
  }

  sceneBounds(extra: Vec3[] = []): { center: Vec3; radius: number } | null {
    const box = new THREE.Box3();
    for (const b of this.bodies.values()) {
      if (!b.group.visible) continue;
      box.expandByPoint(toV3(b.geometry.bounds.min));
      box.expandByPoint(toV3(b.geometry.bounds.max));
    }
    for (const entry of this.instances.values()) box.expandByObject(entry.group);
    // Construction planes too: a plane above the model is something to sketch on.
    for (const { mesh } of this.planes.values()) if (mesh.visible) box.expandByObject(mesh);
    for (const p of extra) box.expandByPoint(toV3(p));
    if (box.isEmpty()) return null;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    return { center: fromV3(sphere.center), radius: sphere.radius };
  }

  /** Fit the view when the model has drifted out of it or has become tiny on screen. */
  ensureVisible(extra: Vec3[] = []): void {
    if (this.animation) return;
    const bounds = this.sceneBounds(extra);
    if (!bounds) return;
    const c = this.project(bounds.center);
    const r = bounds.radius / Math.max(this.pixelSize(bounds.center), 1e-9);
    const limit = Math.min(this.width, this.height);
    const outside =
      c.x < this.width * 0.1 ||
      c.x > this.width * 0.9 ||
      c.y < this.height * 0.1 ||
      c.y > this.height * 0.9;
    if (outside || r > limit * 0.7 || r < 24) this.fitAll(extra);
  }

  fitAll(extra: Vec3[] = []): void {
    const bounds = this.sceneBounds(extra) ?? { center: { x: 0, y: 0, z: 0 }, radius: 80 };
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const target = toV3(bounds.center);
    this.animateTo(
      target.clone().addScaledVector(dir, this.fitDistance(bounds.radius)),
      target,
      this.camera.up.clone(),
    );
    this.setOriginSize(Math.max(40, bounds.radius * 0.6));
  }

  // ------------------------------------------------------------------- origin

  private buildOrigin(): void {
    for (const child of [...this.originRoot.children]) this.originRoot.remove(child);
    this.originPlanes.clear();
    this.originAxes.clear();
    const s = this.originSize;
    (Object.keys(ORIGIN_PLANES) as OriginPlaneName[]).forEach((name) => {
      const plane = ORIGIN_PLANES[name];
      const geometry = new THREE.PlaneGeometry(s, s);
      const material = new THREE.MeshBasicMaterial({
        color: PLANE_COLORS[name],
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const basis = new THREE.Matrix4().makeBasis(
        toV3(plane.xDir),
        toV3(plane.yDir),
        toV3(plane.normal),
      );
      mesh.quaternion.setFromRotationMatrix(basis);
      mesh.position.copy(toV3(plane.xDir).multiplyScalar(s / 2).add(toV3(plane.yDir).multiplyScalar(s / 2)));
      mesh.userData.plane = name;
      mesh.renderOrder = 1;
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: PLANE_COLORS[name], transparent: true, opacity: 0.55 }),
      );
      mesh.add(outline);
      this.originRoot.add(mesh);
      this.originPlanes.set(name, mesh);
    });
    const axes: [string, Vec3, number][] = [
      ["X", { x: 1, y: 0, z: 0 }, COLORS.axisX],
      ["Y", { x: 0, y: 1, z: 0 }, COLORS.axisY],
      ["Z", { x: 0, y: 0, z: 1 }, COLORS.axisZ],
    ];
    for (const [name, dir, color] of axes) {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        toV3(dir).multiplyScalar(s * 1.25),
      ]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color }));
      this.originRoot.add(line);
      this.originAxes.set(name, line);
    }
  }

  private originVisibility: { visible: boolean; hidden: string[] } = { visible: true, hidden: [] };
  private originPlanesSuppressed = false;

  /** Hide the origin planes (not the axes), e.g. while sketching. */
  suppressOriginPlanes(suppressed: boolean): void {
    this.originPlanesSuppressed = suppressed;
    this.setOriginVisibility(this.originVisibility.visible, this.originVisibility.hidden);
  }

  setOriginSize(size: number): void {
    if (Math.abs(size - this.originSize) / this.originSize < 0.25) return;
    this.originSize = size;
    this.buildOrigin();
    this.setOriginVisibility(this.originVisibility.visible, this.originVisibility.hidden);
  }

  setOriginVisibility(visible: boolean, hidden: string[]): void {
    this.originVisibility = { visible, hidden };
    for (const [name, mesh] of this.originPlanes) {
      mesh.visible = visible && !hidden.includes(name) && !this.originPlanesSuppressed;
    }
    for (const [name, line] of this.originAxes) line.visible = visible && !hidden.includes(name);
    this.invalidate();
  }

  // ------------------------------------------------------ construction planes

  private planeMesh(patch: PlanePatch, color: number, opacity: number): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(patch.size, patch.size);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const basis = new THREE.Matrix4().makeBasis(
      toV3(patch.plane.xDir),
      toV3(patch.plane.yDir),
      toV3(patch.plane.normal),
    );
    mesh.quaternion.setFromRotationMatrix(basis);
    mesh.position.copy(toV3(patch.center));
    mesh.renderOrder = 1;
    mesh.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 }),
      ),
    );
    return mesh;
  }

  private disposePlaneMesh(mesh: THREE.Mesh): void {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    for (const child of mesh.children) {
      const line = child as THREE.LineSegments;
      line.geometry.dispose();
      (line.material as THREE.Material).dispose();
    }
  }

  /** Show exactly these construction planes. */
  setPlanes(
    planes: {
      id: string;
      patch: PlanePatch;
      visible: boolean;
      /** Feature a pick returns, when `id` is one of several copies (instances) of it. */
      featureId?: string;
    }[],
  ): void {
    const wanted = new Set(planes.map((p) => p.id));
    for (const [id, entry] of this.planes) {
      if (wanted.has(id)) continue;
      this.disposePlaneMesh(entry.mesh);
      this.planes.delete(id);
    }
    for (const p of planes) {
      const key = JSON.stringify(p.patch);
      let entry = this.planes.get(p.id);
      if (!entry || entry.key !== key) {
        if (entry) this.disposePlaneMesh(entry.mesh);
        const mesh = this.planeMesh(p.patch, COLORS.constructionPlane, 0.12);
        mesh.userData.planeFeature = p.featureId ?? p.id;
        this.planeRoot.add(mesh);
        entry = { key, mesh };
        this.planes.set(p.id, entry);
      }
      entry.mesh.visible = p.visible;
    }
    this.invalidate();
  }

  /** The plane a command is about to create, or null to remove the preview. */
  setPlanePreview(patch: PlanePatch | null): void {
    if (this.planePreview) this.disposePlaneMesh(this.planePreview);
    this.planePreview = null;
    if (patch) {
      this.planePreview = this.planeMesh(patch, COLORS.selected, 0.28);
      this.planePreview.renderOrder = 3;
      this.scene.add(this.planePreview);
    }
    this.invalidate();
  }

  // ------------------------------------------------------------------- bodies

  setBody(id: string, hash: string, geometry: BodyGeometry): void {
    const existing = this.bodies.get(id);
    if (existing && existing.hash === hash) return;
    const visible = existing ? existing.group.visible : true;
    if (existing) this.removeBody(id);

    const meshGeometry = new THREE.BufferGeometry();
    meshGeometry.setAttribute("position", new THREE.BufferAttribute(geometry.positions, 3));
    meshGeometry.setAttribute("normal", new THREE.BufferAttribute(geometry.normals, 3));
    meshGeometry.setIndex(new THREE.BufferAttribute(geometry.indices, 1));
    meshGeometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: COLORS.body,
      metalness: 0.05,
      roughness: 0.62,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(meshGeometry, material);
    mesh.userData.bodyId = id;

    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(geometry.edgePositions, 3));
    const edges = new THREE.LineSegments(
      edgeGeometry,
      new THREE.LineBasicMaterial({ color: COLORS.edge }),
    );

    const group = new THREE.Group();
    group.add(mesh, edges);
    group.visible = visible;
    this.bodyRoot.add(group);
    this.bodies.set(id, { id, hash, geometry, group, mesh, edges, material });
    this.invalidate();
  }

  removeBody(id: string): void {
    const b = this.bodies.get(id);
    if (!b) return;
    this.bodyRoot.remove(b.group);
    b.mesh.geometry.dispose();
    b.edges.geometry.dispose();
    b.material.dispose();
    (b.edges.material as THREE.Material).dispose();
    this.bodies.delete(id);
    this.invalidate();
  }

  /** Remove every body that is not in `ids`. */
  retainBodies(ids: Set<string>): void {
    for (const id of [...this.bodies.keys()]) if (!ids.has(id)) this.removeBody(id);
  }

  setBodyVisible(id: string, visible: boolean): void {
    const b = this.bodies.get(id);
    if (!b || b.group.visible === visible) return;
    b.group.visible = visible;
    this.invalidate();
  }

  setBodiesTransparent(transparent: boolean): void {
    this.transparent = transparent;
    for (const i of this.instances.values()) this.applyTransparency(i.material);
    for (const b of this.bodies.values()) {
      b.material.transparent = transparent;
      b.material.opacity = transparent ? 0.45 : 1;
      b.material.depthWrite = !transparent;
      b.material.needsUpdate = true;
    }
    this.invalidate();
  }

  hasBodies(): boolean {
    return this.bodies.size > 0;
  }

  private applyTransparency(material: THREE.MeshStandardMaterial): void {
    material.transparent = this.transparent;
    material.opacity = this.transparent ? 0.45 : 1;
    material.depthWrite = !this.transparent;
    material.needsUpdate = true;
  }

  // ---------------------------------------------------------------- instances

  /**
   * Show exactly these instances. Each shows the meshes of its definition's bodies (shared,
   * not copied) under its own matrix; a body that is not loaded (yet) is left out.
   */
  setInstances(views: InstanceView[]): void {
    const wanted = new Map(views.map((v) => [v.id, v]));
    for (const [id, entry] of this.instances) {
      const view = wanted.get(id);
      if (view && this.instanceKey(view) === entry.key) continue;
      this.instanceRoot.remove(entry.group);
      entry.material.dispose();
      entry.edgeMaterial.dispose();
      this.instances.delete(id);
    }
    for (const view of views) {
      if (this.instances.has(view.id)) continue;
      const material = new THREE.MeshStandardMaterial({
        color: COLORS.body,
        metalness: 0.05,
        roughness: 0.62,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      this.applyTransparency(material);
      const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.edge });
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      group.matrix.set(...(view.matrix as Parameters<THREE.Matrix4["set"]>));
      const meshes: THREE.Mesh[] = [];
      for (const bodyId of view.bodyIds) {
        const body = this.bodies.get(bodyId);
        if (!body) continue;
        const mesh = new THREE.Mesh(body.mesh.geometry, material);
        mesh.userData.instanceId = view.id;
        const edges = new THREE.LineSegments(body.edges.geometry, edgeMaterial);
        edges.raycast = () => {};
        group.add(mesh, edges);
        meshes.push(mesh);
      }
      this.instanceRoot.add(group);
      this.instances.set(view.id, { key: this.instanceKey(view), group, meshes, material, edgeMaterial });
    }
    this.instanceRoot.updateMatrixWorld(true);
    this.invalidate();
  }

  private instanceKey(view: InstanceView): string {
    const bodies = view.bodyIds.map((id) => `${id}@${this.bodies.get(id)?.hash ?? "-"}`);
    return `${view.matrix.join(",")}|${bodies.join(",")}`;
  }

  /**
   * Show exactly these ghosts: what is not being edited, seen from the component that is
   * (the root bodies and the instances of other components), faded. They hide nothing and are
   * picked only when a pick asks for them (`PickOptions.ghosts`).
   */
  setGhosts(views: InstanceView[]): void {
    const wanted = new Map(views.map((v) => [v.id, v]));
    for (const [id, entry] of this.ghosts) {
      const view = wanted.get(id);
      if (view && this.instanceKey(view) === entry.key) continue;
      this.ghostRoot.remove(entry.group);
      entry.material.dispose();
      entry.edgeMaterial.dispose();
      this.ghosts.delete(id);
    }
    for (const view of views) {
      if (this.ghosts.has(view.id)) continue;
      const material = new THREE.MeshStandardMaterial({
        color: COLORS.body,
        metalness: 0,
        roughness: 0.8,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const edgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.edge, transparent: true, opacity: 0.35 });
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      const matrix = new THREE.Matrix4().set(...(view.matrix as Parameters<THREE.Matrix4["set"]>));
      group.matrix.copy(matrix);
      const meshes: THREE.Mesh[] = [];
      for (const bodyId of view.bodyIds) {
        const body = this.bodies.get(bodyId);
        if (!body) continue;
        const mesh = new THREE.Mesh(body.mesh.geometry, material);
        mesh.userData.bodyId = bodyId;
        mesh.userData.ghostId = view.id;
        mesh.renderOrder = 2;
        const edges = new THREE.LineSegments(body.edges.geometry, edgeMaterial);
        edges.raycast = () => {};
        group.add(mesh, edges);
        meshes.push(mesh);
      }
      this.ghostRoot.add(group);
      this.ghosts.set(view.id, {
        key: this.instanceKey(view),
        group,
        meshes,
        material,
        edgeMaterial,
        matrix,
        bodyIds: view.bodyIds,
      });
    }
    this.ghostRoot.updateMatrixWorld(true);
    this.invalidate();
  }

  /** Row-major placement of a ghost, for turning what was picked on it into its geometry. */
  ghostMatrix(id: string): number[] | undefined {
    const m = this.ghosts.get(id)?.matrix;
    // `elements` is column-major.
    return m ? new THREE.Matrix4().copy(m).transpose().toArray() : undefined;
  }

  /** Bodies to pick from: the visible ones, and the ghosts when asked for. */
  private pickSources(ghosts: boolean): { id: string; geometry: BodyGeometry; matrix?: THREE.Matrix4; ghost?: string }[] {
    const out: { id: string; geometry: BodyGeometry; matrix?: THREE.Matrix4; ghost?: string }[] = [];
    for (const b of this.bodies.values()) if (b.group.visible) out.push({ id: b.id, geometry: b.geometry });
    if (ghosts) {
      for (const [ghostId, g] of this.ghosts) {
        for (const bodyId of g.bodyIds) {
          const body = this.bodies.get(bodyId);
          if (body) out.push({ id: bodyId, geometry: body.geometry, matrix: g.matrix, ghost: ghostId });
        }
      }
    }
    return out;
  }

  /** Meshes that hide what lies behind them: visible bodies and instances. */
  private occluders(): THREE.Mesh[] {
    return [
      ...[...this.bodies.values()].filter((b) => b.group.visible).map((b) => b.mesh),
      ...[...this.instances.values()].flatMap((i) => i.meshes),
    ];
  }

  // --------------------------------------------------------------- highlights

  setHighlights(items: { highlight: Highlight; mode: "hover" | "selected" }[]): void {
    for (const child of [...this.highlightRoot.children]) {
      this.highlightRoot.remove(child);
      const obj = child as THREE.Mesh | THREE.LineSegments | THREE.Points;
      obj.geometry?.dispose();
      const m = obj.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    }
    for (const [name, mesh] of this.originPlanes) {
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.1;
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(PLANE_COLORS[name]);
    }
    for (const { mesh } of this.planes.values()) {
      (mesh.material as THREE.MeshBasicMaterial).opacity = 0.12;
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(COLORS.constructionPlane);
    }
    for (const b of this.bodies.values()) b.material.color.setHex(COLORS.body);
    for (const i of this.instances.values()) {
      i.material.color.setHex(COLORS.body);
      i.edgeMaterial.color.setHex(COLORS.edge);
    }

    for (const { highlight: h, mode } of items) {
      const color = mode === "selected" ? COLORS.selected : COLORS.highlight;
      if (h.kind === "instance") {
        const entry = this.instances.get(h.instanceId);
        if (entry) {
          entry.material.color.setHex(mode === "selected" ? 0x9cc3e0 : COLORS.bodyHover);
          if (mode === "selected") entry.edgeMaterial.color.setHex(COLORS.selected);
        }
        continue;
      }
      if (h.kind === "plane") {
        for (const { mesh } of this.planes.values()) {
          if (mesh.userData.planeFeature !== h.featureId) continue;
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0.35;
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
        }
        continue;
      }
      if (h.kind === "origin-plane") {
        const mesh = this.originPlanes.get(h.plane);
        if (mesh) {
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0.35;
          (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
        }
        continue;
      }
      const body = this.bodies.get(h.bodyId);
      // A ghost shows the body where the body itself is hidden.
      const onGhost = (h.kind === "face" || h.kind === "edge") && h.ghost !== undefined;
      if (!body || (!body.group.visible && !onGhost)) continue;
      if (h.kind === "body") {
        body.material.color.setHex(mode === "selected" ? 0x9cc3e0 : COLORS.bodyHover);
      } else if (h.kind === "face") {
        const face = body.geometry.faces[h.faceIndex];
        if (!face) continue;
        const ghostMatrix = h.ghost ? this.ghosts.get(h.ghost)?.matrix : undefined;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", body.mesh.geometry.getAttribute("position"));
        g.setIndex(
          new THREE.BufferAttribute(
            body.geometry.indices.subarray(face.start, face.start + face.count),
            1,
          ),
        );
        const m = new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: mode === "selected" ? 0.55 : 0.4,
          side: THREE.DoubleSide,
          depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const highlight = new THREE.Mesh(g, m);
        if (ghostMatrix) highlight.applyMatrix4(ghostMatrix);
        this.highlightRoot.add(highlight);
      } else if (h.kind === "edge") {
        const edge = body.geometry.edges[h.edgeIndex];
        if (!edge) continue;
        const positions = body.geometry.edgePositions.subarray(
          edge.start * 3,
          (edge.start + edge.count) * 3,
        );
        const lines = this.thickLines(positions, color);
        const ghostMatrix = h.ghost ? this.ghosts.get(h.ghost)?.matrix : undefined;
        if (ghostMatrix) lines.applyMatrix4(ghostMatrix);
        this.highlightRoot.add(lines);
      } else {
        const g = new THREE.BufferGeometry().setFromPoints([toV3(h.point)]);
        const m = new THREE.PointsMaterial({
          color,
          size: 10,
          sizeAttenuation: false,
          depthTest: false,
        });
        this.highlightRoot.add(new THREE.Points(g, m));
      }
    }
    this.invalidate();
  }

  /** Lines drawn several times with small screen offsets: a cheap way to get thick lines. */
  private thickLines(positions: Float32Array, color: number): THREE.Object3D {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions.slice(), 3));
    const m = new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 3 });
    const group = new THREE.Group();
    const lines = new THREE.LineSegments(g, m);
    lines.renderOrder = 5;
    group.add(lines);
    // Tube-like emphasis: small spheres are overkill; points at the segment ends fill the gaps.
    const pm = new THREE.PointsMaterial({ color, size: 3.5, sizeAttenuation: false, depthTest: false });
    const pts = new THREE.Points(g, pm);
    pts.renderOrder = 5;
    group.add(pts);
    return group;
  }

  // ------------------------------------------------------------------ picking

  /** Project a world point to viewport pixels. `visible` is false behind the camera. */
  project(p: Vec3): { x: number; y: number; visible: boolean } {
    const v = toV3(p).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height,
      visible: v.z > -1 && v.z < 1,
    };
  }

  private setRay(x: number, y: number): THREE.Ray {
    const ndc = new THREE.Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  /** Intersect the view ray through a pixel with a plane; returns plane coordinates. */
  pointOnPlane(x: number, y: number, plane: Plane3): Vec2 | null {
    const ray = this.setRay(x, y);
    const n = toV3(plane.normal);
    const denom = ray.direction.dot(n);
    if (Math.abs(denom) < 1e-9) return null;
    const t = toV3(plane.origin).sub(ray.origin).dot(n) / denom;
    const hit = ray.origin.clone().addScaledVector(ray.direction, t);
    const d = hit.sub(toV3(plane.origin));
    return { x: d.dot(toV3(plane.xDir)), y: d.dot(toV3(plane.yDir)) };
  }

  /** World units per pixel at a world position. */
  pixelSize(at: Vec3): number {
    if (this.camera === this.orthographic) {
      return (this.orthographic.top - this.orthographic.bottom) / this.orthographic.zoom / this.height;
    }
    const d = this.camera.position.distanceTo(toV3(at));
    return (2 * d * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2))) / this.height;
  }

  pick(x: number, y: number, options: PickOptions = {}): Pick3D | null {
    const wantFaces = options.faces ?? true;
    const wantEdges = options.edges ?? true;
    const wantVertices = options.vertices ?? true;
    this.setRay(x, y);
    const ghostMeshes = options.ghosts ? [...this.ghosts.values()].flatMap((g) => g.meshes) : [];
    const hit = this.raycaster.intersectObjects([...this.occluders(), ...ghostMeshes], false)[0];
    const hitDistance = hit ? hit.distance : Infinity;
    const sources = this.pickSources(options.ghosts === true);
    const placed = (p: THREE.Vector3, m?: THREE.Matrix4): THREE.Vector3 => (m ? p.applyMatrix4(m) : p);
    // Anything more than this far behind the first surface hit is considered hidden.
    const slack = hit ? Math.max(0.05, hitDistance * 0.004) : Infinity;
    const cameraPos = this.camera.position;
    const depthOf = (p: THREE.Vector3): number =>
      this.camera === this.orthographic
        ? p.clone().sub(this.raycaster.ray.origin).dot(this.raycaster.ray.direction)
        : p.distanceTo(cameraPos);
    const isVisible = (p: THREE.Vector3): boolean => depthOf(p) <= hitDistance + slack;

    if (wantVertices) {
      let best: Pick3D | null = null;
      let bestD = 9;
      for (const b of sources) {
        const v = b.geometry.vertices;
        for (let i = 0; i < v.length; i += 3) {
          const p = placed(new THREE.Vector3(v[i], v[i + 1], v[i + 2]), b.matrix);
          const s = this.project(fromV3(p));
          if (!s.visible) continue;
          const d = Math.hypot(s.x - x, s.y - y);
          if (d < bestD && isVisible(p)) {
            bestD = d;
            best = { kind: "vertex", bodyId: b.id, vertexIndex: i / 3, point: fromV3(p), ...(b.ghost ? { ghost: b.ghost } : {}) };
          }
        }
      }
      if (best) return best;
    }

    if (wantEdges) {
      let best: Pick3D | null = null;
      let bestD = 7;
      const a = new THREE.Vector3();
      const c = new THREE.Vector3();
      for (const b of sources) {
        const pos = b.geometry.edgePositions;
        for (const edge of b.geometry.edges) {
          for (let k = edge.start; k + 1 < edge.start + edge.count; k += 2) {
            placed(a.set(pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!), b.matrix);
            placed(c.set(pos[k * 3 + 3]!, pos[k * 3 + 4]!, pos[k * 3 + 5]!), b.matrix);
            const sa = this.project(fromV3(a));
            const sc = this.project(fromV3(c));
            if (!sa.visible || !sc.visible) continue;
            const dx = sc.x - sa.x;
            const dy = sc.y - sa.y;
            const l2 = dx * dx + dy * dy;
            const t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((x - sa.x) * dx + (y - sa.y) * dy) / l2));
            const d = Math.hypot(sa.x + dx * t - x, sa.y + dy * t - y);
            if (d >= bestD) continue;
            // The point of the edge under the pointer. Not `lerp(a, c, t)`: `t` is measured
            // on the screen, and with perspective that is another point of the edge, whose
            // depth would be compared with what lies under the pointer.
            const p = new THREE.Vector3();
            this.raycaster.ray.distanceSqToSegment(a, c, undefined, p);
            if (!isVisible(p)) continue;
            bestD = d;
            best = {
              kind: "edge",
              bodyId: b.id,
              edgeIndex: edge.edgeIndex,
              point: fromV3(placed(toV3(edge.midpoint), b.matrix)),
              ...(b.ghost ? { ghost: b.ghost } : {}),
            };
          }
        }
      }
      if (best) return best;
    }

    const instanceId = hit?.object.userData.instanceId as string | undefined;
    if (instanceId !== undefined) {
      return options.instances === false ? null : { kind: "instance", instanceId };
    }

    if (wantFaces && hit && hit.faceIndex !== undefined && hit.faceIndex !== null) {
      const bodyId = hit.object.userData.bodyId as string;
      const ghost = hit.object.userData.ghostId as string | undefined;
      const body = this.bodies.get(bodyId);
      if (body) {
        const offset = hit.faceIndex * 3;
        const face = body.geometry.faces.find((f) => offset >= f.start && offset < f.start + f.count);
        if (face) {
          const m = ghost ? this.ghosts.get(ghost)?.matrix : undefined;
          return {
            kind: "face",
            bodyId,
            faceIndex: face.faceIndex,
            point: m ? fromV3(toV3(face.center).applyMatrix4(m)) : face.center,
            normal: m ? fromV3(toV3(face.normal).transformDirection(m)) : face.normal,
            planar: face.surface === "plane",
            ...(ghost ? { ghost } : {}),
          };
        }
      }
    }

    if (options.originPlanes) {
      const planes = [
        ...this.originPlanes.values(),
        ...[...this.planes.values()].map((p) => p.mesh),
      ].filter((m) => m.visible);
      const planeHit = this.raycaster.intersectObjects(planes, false)[0];
      // An origin plane only wins when it is clearly in front: a face lying in the plane
      // (e.g. the bottom of a body on XY) is what the user is pointing at.
      const margin = hit ? Math.max(0.05, hit.distance * 0.004) : 0;
      if (planeHit && (!hit || planeHit.distance < hit.distance - margin)) {
        const featureId = planeHit.object.userData.planeFeature as string | undefined;
        if (featureId !== undefined) return { kind: "plane", featureId };
        return { kind: "origin-plane", plane: planeHit.object.userData.plane as OriginPlaneName };
      }
    }
    return null;
  }

  /**
   * True when nothing lies in front of a world point as seen through a pixel. Points on a
   * surface (e.g. a sketch drawn on a face) count as visible.
   */
  isPointVisible(x: number, y: number, point: Vec3): boolean {
    const ray = this.setRay(x, y);
    const hit = this.raycaster.intersectObjects(this.occluders(), false)[0];
    if (!hit) return true;
    const depth = toV3(point).sub(ray.origin).dot(ray.direction);
    const hitDepth = hit.point.clone().sub(ray.origin).dot(ray.direction);
    return depth <= hitDepth + Math.max(0.05, Math.abs(hitDepth) * 0.004);
  }

  /** Body under the pixel, ignoring edges and vertices. Null when an instance is in front. */
  pickBody(x: number, y: number): string | null {
    this.setRay(x, y);
    const hit = this.raycaster.intersectObjects(this.occluders(), false)[0];
    return (hit?.object.userData.bodyId as string | undefined) ?? null;
  }

  /** Instance under the pixel, when nothing else is in front of it. */
  pickInstance(x: number, y: number): string | null {
    this.setRay(x, y);
    const hit = this.raycaster.intersectObjects(this.occluders(), false)[0];
    return (hit?.object.userData.instanceId as string | undefined) ?? null;
  }

  bodyGeometry(id: string): BodyGeometry | undefined {
    return this.bodies.get(id)?.geometry;
  }
}
