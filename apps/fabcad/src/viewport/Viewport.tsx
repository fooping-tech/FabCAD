import { planeToWorld, type Vec3 } from "@fabcad/geometry";
import { resolveSketchPlane } from "@fabcad/features";
import { profileRefOf, sketchBounds } from "@fabcad/sketch";
import { type ReactElement, useEffect, useRef, useState } from "react";
import {
  closeDialog,
  finishSketch,
  patchDialog,
  startSketchOnFace,
  startSketchOnOrigin,
} from "../app/actions";
import {
  type Dialog,
  type Selection,
  appState,
  select,
  selectionKey,
  toast,
} from "../app/appState";
import { documentStore, editSketchSolved, modelState, sketchView, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { SketchController } from "../sketch/SketchController";
import { editSketch } from "@fabcad/sketch";
import { Icon } from "../ui/Icon";
import { registerViewport } from "./api";
import { type Highlight, type Pick3D, type ViewName, ViewportScene } from "./scene";

const VIEWS: { id: ViewName; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "front", label: "Front" },
  { id: "right", label: "Right" },
  { id: "bottom", label: "Bottom" },
  { id: "back", label: "Back" },
  { id: "left", label: "Left" },
];

function pickToSelection(pick: Pick3D): Selection {
  switch (pick.kind) {
    case "face":
      return { ...pick };
    case "edge":
      return { ...pick };
    case "vertex":
      return { ...pick };
    case "origin-plane":
      return { kind: "origin-plane", plane: pick.plane };
  }
}

function selectionToHighlight(s: Selection): Highlight | null {
  switch (s.kind) {
    case "body":
      return { kind: "body", bodyId: s.bodyId };
    case "face":
      return { kind: "face", bodyId: s.bodyId, faceIndex: s.faceIndex };
    case "edge":
      return { kind: "edge", bodyId: s.bodyId, edgeIndex: s.edgeIndex };
    case "vertex":
      return { kind: "vertex", bodyId: s.bodyId, point: s.point };
    case "origin-plane":
      return { kind: "origin-plane", plane: s.plane };
    default:
      return null;
  }
}

const near = (a: Vec3, b: Vec3, tol = 1e-4): boolean =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol && Math.abs(a.z - b.z) < tol;

/** Highlights for the references held by an open feature dialog. */
function dialogHighlights(dialog: Dialog | null, scene: ViewportScene): Highlight[] {
  if (!dialog) return [];
  const out: Highlight[] = [];
  if ((dialog.type === "fillet" || dialog.type === "chamfer") && dialog.bodyId) {
    const g = scene.bodyGeometry(dialog.bodyId);
    for (const ref of dialog.edges) {
      const edge = g?.edges.find((e) => near(e.midpoint, ref.point));
      if (edge) out.push({ kind: "edge", bodyId: dialog.bodyId, edgeIndex: edge.edgeIndex });
    }
  } else if (dialog.type === "shell" && dialog.bodyId) {
    const g = scene.bodyGeometry(dialog.bodyId);
    for (const ref of dialog.faces) {
      const face = g?.faces.find((f) => near(f.center, ref.point));
      if (face) out.push({ kind: "face", bodyId: dialog.bodyId, faceIndex: face.faceIndex });
    }
  } else if (dialog.type === "combine") {
    if (dialog.targetBodyId) out.push({ kind: "body", bodyId: dialog.targetBodyId });
    for (const id of dialog.toolBodyIds) out.push({ kind: "body", bodyId: id });
  } else if ((dialog.type === "extrude" || dialog.type === "revolve") && dialog.operation !== "new") {
    // Targets are listed in the dialog; tinting every body would hide the profile.
  }
  return out;
}

export function Viewport(): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const webglRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ViewportScene | null>(null);
  const controllerRef = useRef<SketchController | null>(null);
  const [ready, setReady] = useState(false);

  const doc = useDocument();
  const app = useStore(appState);
  const model = useStore(modelState);

  // ------------------------------------------------------------------ set-up
  useEffect(() => {
    const host = hostRef.current;
    const webgl = webglRef.current;
    const overlay = overlayRef.current;
    if (!host || !webgl || !overlay) return;
    const scene = new ViewportScene(webgl);
    const controller = new SketchController(overlay, scene);
    sceneRef.current = scene;
    controllerRef.current = controller;
    const off = scene.onChange(() => controller.requestDraw());

    const resize = (): void => {
      const r = host.getBoundingClientRect();
      scene.resize(r.width, r.height);
      controller.resize(r.width, r.height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    setReady(true);

    const info = (e: PointerEvent | MouseEvent) => {
      const r = webgl.getBoundingClientRect();
      return {
        x: e.clientX - r.left,
        y: e.clientY - r.top,
        shift: e.shiftKey,
        meta: e.metaKey || e.ctrlKey,
      };
    };

    let down: { x: number; y: number; button: number } | null = null;

    const hover3d = (x: number, y: number): void => {
      const state = appState.get();
      const dialog = state.dialog;
      if (dialog && (dialog.type === "extrude" || dialog.type === "revolve")) {
        const wantsAxis = dialog.type === "revolve" && dialog.picking === "axis";
        if (wantsAxis && dialog.sketchId) {
          const line = controller.lineAt(x, y, dialog.sketchId);
          controller.setHoverProfile(null);
          const hover: Selection | null = line
            ? { kind: "entity", sketchId: dialog.sketchId, entityId: line }
            : null;
          if ((state.hover ? selectionKey(state.hover) : "") !== (hover ? selectionKey(hover) : "")) {
            appState.set({ hover });
          }
          return;
        }
        controller.setHoverProfile(controller.profileAt(x, y));
        if (state.hover) appState.set({ hover: null });
        return;
      }
      controller.setHoverProfile(null);
      const filter = state.selectionFilter;
      let hover: Selection | null = null;
      if (filter === "body") {
        const id = scene.pickBody(x, y);
        if (id) hover = { kind: "body", bodyId: id };
      } else {
        const pick = scene.pick(x, y, {
          faces: filter === "auto" || filter === "face",
          edges: filter === "auto" || filter === "edge",
          vertices: filter === "auto" || filter === "vertex",
          originPlanes: dialog?.type === "pick-sketch-plane" || filter === "auto",
        });
        if (pick) hover = pickToSelection(pick);
      }
      if (!hover && !dialog) {
        const profile = controller.profileAt(x, y);
        controller.setHoverProfile(profile);
      }
      if ((state.hover ? selectionKey(state.hover) : "") !== (hover ? selectionKey(hover) : "")) {
        appState.set({ hover });
      }
    };

    const click3d = (x: number, y: number, additive: boolean): void => {
      const state = appState.get();
      const dialog = state.dialog;
      hover3d(x, y);
      const hover = appState.get().hover;
      const profile = controller.hoveredProfile;

      if (dialog?.type === "pick-sketch-plane") {
        if (hover?.kind === "origin-plane") startSketchOnOrigin(hover.plane);
        else if (hover?.kind === "face" && hover.planar) {
          startSketchOnFace(hover.bodyId, hover.point, hover.normal);
        } else if (hover?.kind === "face") {
          toast("Sketches need a planar face.", "warning");
        }
        return;
      }
      if (dialog && (dialog.type === "extrude" || dialog.type === "revolve")) {
        if (dialog.type === "revolve" && dialog.picking === "axis") {
          if (hover?.kind === "entity") {
            patchDialog({ axis: { type: "sketch-line", entityId: hover.entityId } });
          }
          return;
        }
        if (!profile) return;
        const ref = profileRefOf(profile.region);
        if (dialog.sketchId !== profile.sketchId) {
          patchDialog({ sketchId: profile.sketchId, profiles: [ref], ...(dialog.type === "revolve" ? { axis: null } : {}) });
          return;
        }
        const same = (r: typeof ref): boolean =>
          r.entityIds.length === ref.entityIds.length &&
          r.entityIds.every((e) => ref.entityIds.includes(e)) &&
          Math.hypot(r.point.x - ref.point.x, r.point.y - ref.point.y) < 1e-6;
        const exists = dialog.profiles.some(same);
        patchDialog({
          profiles: exists ? dialog.profiles.filter((r) => !same(r)) : [...dialog.profiles, ref],
        });
        return;
      }
      if (dialog && (dialog.type === "fillet" || dialog.type === "chamfer")) {
        if (hover?.kind !== "edge") return;
        if (dialog.bodyId && dialog.bodyId !== hover.bodyId) {
          patchDialog({ bodyId: hover.bodyId, edges: [{ point: hover.point }] });
          return;
        }
        const exists = dialog.edges.some((e) => near(e.point, hover.point));
        patchDialog({
          bodyId: hover.bodyId,
          edges: exists
            ? dialog.edges.filter((e) => !near(e.point, hover.point))
            : [...dialog.edges, { point: hover.point }],
        });
        return;
      }
      if (dialog?.type === "shell") {
        if (hover?.kind !== "face") return;
        if (dialog.bodyId && dialog.bodyId !== hover.bodyId) {
          patchDialog({ bodyId: hover.bodyId, faces: [{ point: hover.point, normal: hover.normal }] });
          return;
        }
        const exists = dialog.faces.some((f) => near(f.point, hover.point));
        patchDialog({
          bodyId: hover.bodyId,
          faces: exists
            ? dialog.faces.filter((f) => !near(f.point, hover.point))
            : [...dialog.faces, { point: hover.point, normal: hover.normal }],
        });
        return;
      }
      if (dialog?.type === "combine") {
        const id = hover && "bodyId" in hover ? hover.bodyId : scene.pickBody(x, y);
        if (!id) return;
        if (dialog.picking === "target" || !dialog.targetBodyId) {
          patchDialog({
            targetBodyId: id,
            toolBodyIds: dialog.toolBodyIds.filter((t) => t !== id),
            picking: "tools",
          });
        } else if (id !== dialog.targetBodyId) {
          patchDialog({
            toolBodyIds: dialog.toolBodyIds.includes(id)
              ? dialog.toolBodyIds.filter((t) => t !== id)
              : [...dialog.toolBodyIds, id],
          });
        }
        return;
      }

      if (hover) {
        select(hover, additive);
      } else if (profile) {
        select(
          {
            kind: "profile",
            sketchId: profile.sketchId,
            regionId: profile.region.id,
            ref: profileRefOf(profile.region),
          },
          additive,
        );
      } else {
        select(null, additive);
      }
    };

    const onPointerDown = (e: PointerEvent): void => {
      down = { x: e.clientX, y: e.clientY, button: e.button };
      if (e.button !== 0) return;
      if (appState.get().activeSketchId) controller.pointerDown(info(e));
    };
    const onPointerMove = (e: PointerEvent): void => {
      const p = info(e);
      if (appState.get().activeSketchId) {
        if (e.buttons === 0 || e.buttons === 1) controller.pointerMove(p);
        return;
      }
      if (e.buttons !== 0) return;
      if (appState.get().workspace !== "design") return;
      hover3d(p.x, p.y);
    };
    const onPointerUp = (e: PointerEvent): void => {
      const start = down;
      down = null;
      if (e.button !== 0) return;
      const p = info(e);
      if (appState.get().activeSketchId) {
        controller.pointerUp(p);
        return;
      }
      if (!start || start.button !== 0) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
      if (appState.get().workspace !== "design") return;
      click3d(p.x, p.y, p.shift || p.meta);
    };
    const onDoubleClick = (e: MouseEvent): void => {
      if (appState.get().activeSketchId) controller.doubleClick(info(e));
    };
    const onLeave = (): void => {
      controller.setHoverProfile(null);
      if (appState.get().hover) appState.set({ hover: null });
      appState.set({ cursor: null });
    };
    const onContextMenu = (e: MouseEvent): void => e.preventDefault();

    webgl.addEventListener("pointerdown", onPointerDown);
    webgl.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    webgl.addEventListener("dblclick", onDoubleClick);
    webgl.addEventListener("pointerleave", onLeave);
    webgl.addEventListener("contextmenu", onContextMenu);

    if (import.meta.env.DEV) {
      // Hooks for automated browser tests.
      (window as unknown as Record<string, unknown>).__fabcad = {
        documentStore,
        appState,
        modelState,
        sketchToScreen: (x: number, y: number) => {
          const id = appState.get().activeSketchId;
          const f = id ? documentStore.document.features[id] : undefined;
          if (f?.type !== "sketch") return null;
          const r = webgl.getBoundingClientRect();
          const s = scene.project(planeToWorld(resolveSketchPlane(f.sketch.plane), { x, y }));
          return { x: s.x + r.left, y: s.y + r.top };
        },
        worldToScreen: (x: number, y: number, z: number) => {
          const r = webgl.getBoundingClientRect();
          const s = scene.project({ x, y, z });
          return { x: s.x + r.left, y: s.y + r.top };
        },
      };
    }

    registerViewport({
      cancel: () => controller.cancel(),
      confirm: () => controller.confirm(),
      fit: () => scene.fitAll(sketchExtents()),
      setView: (view) => scene.setView(view),
    });

    return () => {
      off();
      observer.disconnect();
      webgl.removeEventListener("pointerdown", onPointerDown);
      webgl.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      webgl.removeEventListener("dblclick", onDoubleClick);
      webgl.removeEventListener("pointerleave", onLeave);
      webgl.removeEventListener("contextmenu", onContextMenu);
      registerViewport(null);
      controller.dispose();
      scene.dispose();
      sceneRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  // ------------------------------------------------------- bodies and origin
  const firstBodies = useRef(true);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const ids = new Set(Object.keys(model.bodies));
    scene.retainBodies(ids);
    const hadBodies = scene.hasBodies();
    for (const b of Object.values(model.bodies)) scene.setBody(b.id, b.hash, b.geometry);
    for (const b of Object.values(doc.bodies)) scene.setBodyVisible(b.id, b.visible);
    scene.setOriginVisibility(doc.origin.visible, doc.origin.hidden);
    // Frame the model when the first body appears, and whenever it leaves the view.
    if (scene.hasBodies() && !appState.get().activeSketchId) {
      if (!hadBodies && firstBodies.current) scene.fitAll();
      else setTimeout(() => sceneRef.current?.ensureVisible(), 320);
      firstBodies.current = false;
    }
    if (!scene.hasBodies()) firstBodies.current = true;
    scene.setBodiesTransparent(appState.get().activeSketchId !== null);
    scene.invalidate();
  }, [model.bodies, doc.bodies, doc.origin, ready]);

  // ------------------------------------------------------------- highlights
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const items: { highlight: Highlight; mode: "hover" | "selected" }[] = [];
    for (const h of dialogHighlights(app.dialog, scene)) items.push({ highlight: h, mode: "selected" });
    for (const s of app.selection) {
      const h = selectionToHighlight(s);
      if (h) items.push({ highlight: h, mode: "selected" });
      if (s.kind === "feature") {
        for (const b of Object.values(doc.bodies)) {
          if (b.createdBy === s.featureId) {
            items.push({ highlight: { kind: "body", bodyId: b.id }, mode: "selected" });
          }
        }
      }
    }
    if (app.hover) {
      const h = selectionToHighlight(app.hover);
      if (h) items.push({ highlight: h, mode: "hover" });
    }
    scene.setHighlights(items);
    controllerRef.current?.requestDraw();
  }, [app.selection, app.hover, app.dialog, model.bodies, doc.bodies, ready]);

  // -------------------------------------------------------- sketch redraws
  useEffect(() => {
    controllerRef.current?.requestDraw();
  }, [doc, app.showConstraints, app.showDimensions, app.workspace, app.toolOptions]);

  // Keep the sketch in view: a dimension can push geometry far outside the window.
  useEffect(() => {
    const scene = sceneRef.current;
    const id = appState.get().activeSketchId;
    if (!scene || !id || documentStore.inTransaction) return;
    const f = doc.features[id];
    if (f?.type !== "sketch") return;
    const b = sketchBounds(f.sketch);
    if (!b) return;
    const plane = resolveSketchPlane(f.sketch.plane);
    const { width, height } = scene.size;
    const corners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
    ].map((p) => scene.project(planeToWorld(plane, p)));
    const outside = corners.some((c) => c.x < 0 || c.y < 0 || c.x > width || c.y > height);
    if (!outside) return;
    scene.lookAtPlane(plane, {
      center: planeToWorld(plane, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }),
      radius: Math.max(70, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 0.78),
    });
  }, [doc]);

  useEffect(() => {
    controllerRef.current?.toolChanged();
  }, [app.tool]);

  useEffect(() => {
    sceneRef.current?.setProjection(app.projection);
  }, [app.projection, ready]);

  // Entering and leaving the sketch environment.
  const previousProjection = useRef(app.projection);
  const previousView = useRef<ReturnType<ViewportScene["saveView"]> | null>(null);
  useEffect(() => {
    const scene = sceneRef.current;
    const controller = controllerRef.current;
    if (!scene || !controller) return;
    const id = app.activeSketchId;
    scene.setLeftButtonOrbit(id === null);
    scene.setBodiesTransparent(id !== null);
    scene.suppressOriginPlanes(id !== null);
    controller.cancel();
    if (id) {
      const f = documentStore.document.features[id];
      if (f?.type === "sketch") {
        previousProjection.current = appState.get().projection;
        previousView.current = scene.saveView();
        appState.set({ projection: "orthographic" });
        scene.setProjection("orthographic");
        const plane = resolveSketchPlane(f.sketch.plane);
        const b = sketchBounds(f.sketch);
        const fit = b
          ? {
              center: planeToWorld(plane, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }),
              radius: Math.max(70, Math.hypot(b.maxX - b.minX, b.maxY - b.minY) * 0.78),
            }
          : { center: plane.origin, radius: 90 };
        scene.lookAtPlane(plane, fit);
      }
      controller.refreshHint();
    } else {
      appState.set({ projection: previousProjection.current });
      scene.setProjection(previousProjection.current);
      if (previousView.current) {
        // Back to the view from before the sketch, framed on what exists now.
        const saved = previousView.current;
        previousView.current = null;
        scene.restoreView(saved);
        setTimeout(() => {
          if (scene.hasBodies()) scene.ensureVisible();
          else scene.fitAll(sketchExtents());
        }, 320);
      }
    }
    controller.requestDraw();
  }, [app.activeSketchId, ready]);

  function sketchExtents(): Vec3[] {
    const out: Vec3[] = [];
    for (const f of Object.values(documentStore.document.features)) {
      if (f.type !== "sketch" || !f.visible) continue;
      const b = sketchBounds(f.sketch);
      if (!b) continue;
      const plane = resolveSketchPlane(f.sketch.plane);
      out.push(planeToWorld(plane, { x: b.minX, y: b.minY }), planeToWorld(plane, { x: b.maxX, y: b.maxY }));
    }
    return out;
  }

  const activeSketch = app.activeSketchId ? doc.features[app.activeSketchId] : undefined;
  const view = activeSketch?.type === "sketch" ? sketchView(activeSketch.sketch, doc) : null;
  const tooling = app.activeSketchId !== null && app.tool !== "select";

  return (
    <div className={`viewport${tooling ? " tooling" : ""}`} ref={hostRef}>
      <canvas className="webgl" ref={webglRef} />
      <canvas className="overlay" ref={overlayRef} />

      {activeSketch?.type === "sketch" && view && (
        <div className="sketch-banner">
          <Icon name="sketch" size={14} />
          <strong>{activeSketch.name}</strong>
          <span
            className={`badge ${
              view.status === "fully-constrained"
                ? "ok"
                : view.status === "over-constrained"
                  ? "danger"
                  : "info"
            }`}
          >
            {view.status === "fully-constrained"
              ? "Fully constrained"
              : view.status === "over-constrained"
                ? "Over-constrained"
                : `Under-constrained · ${view.degreesOfFreedom} DOF`}
          </span>
          <button className="btn small accent" onClick={finishSketch}>
            Finish Sketch
          </button>
        </div>
      )}

      {app.dialog?.type === "pick-sketch-plane" && (
        <div className="sketch-banner">
          <Icon name="plane" size={14} />
          <span>Select a plane or a planar face</span>
          <button className="btn small" onClick={closeDialog}>
            Cancel
          </button>
        </div>
      )}

      {app.dimensionEdit && <DimensionEditor />}

      <div className="view-tools">
        <div className="view-card">
          <div className="view-grid">
            {VIEWS.map((v) => (
              <button key={v.id} onClick={() => sceneRef.current?.setView(v.id)} title={`${v.label} view`}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="view-row" style={{ marginTop: 1 }}>
            <button style={{ flex: 1 }} onClick={() => sceneRef.current?.setView("iso")} title="Isometric view">
              Iso
            </button>
            <button
              style={{ flex: 1 }}
              onClick={() => sceneRef.current?.fitAll(sketchExtents())}
              title="Fit all (F)"
            >
              Fit
            </button>
          </div>
        </div>
        <div className="view-card">
          <div className="view-row">
            <button
              className={app.projection === "perspective" ? "on" : ""}
              onClick={() => appState.set({ projection: "perspective" })}
              title="Perspective projection"
            >
              Persp
            </button>
            <button
              className={app.projection === "orthographic" ? "on" : ""}
              onClick={() => appState.set({ projection: "orthographic" })}
              title="Orthographic projection"
            >
              Ortho
            </button>
          </div>
        </div>
      </div>

      {model.kernel !== "ready" && (
        <div className="overlay-note">
          <div className="overlay-card">
            {model.kernel === "loading" ? (
              <>
                <div className="spinner" />
                <h3>Loading the geometry kernel</h3>
                <p>OpenCASCADE is starting. You can already sketch.</p>
              </>
            ) : (
              <>
                <h3>The geometry kernel failed to start</h3>
                <p>{model.kernelError || "WebAssembly could not be loaded."}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Inline expression editor shown on top of a dimension label. */
function DimensionEditor(): ReactElement | null {
  const edit = useStore(appState, (s) => s.dimensionEdit);
  const [value, setValue] = useState(edit?.value ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    done.current = false;
    setValue(edit?.value ?? "");
    const t = setTimeout(() => inputRef.current?.select(), 0);
    return () => clearTimeout(t);
  }, [edit?.dimensionId, edit?.value]);

  if (!edit) return null;

  const close = (): void => {
    done.current = true;
    appState.set({ dimensionEdit: null });
  };

  const apply = (): void => {
    if (done.current) return;
    const expression = value.trim();
    if (expression === "" || expression === edit.value) {
      close();
      return;
    }
    const ok = editSketchSolved(
      edit.sketchId,
      "Edit dimension",
      (sketch) => {
        const d = sketch.dimensions[edit.dimensionId];
        if (!d) return sketch;
        return { ...sketch, dimensions: { ...sketch.dimensions, [d.id]: { ...d, expression } } };
      },
      { rejectOverConstrained: true },
    );
    if (ok) close();
    else inputRef.current?.select();
  };

  const cancel = (): void => {
    if (edit.fresh) {
      // A dimension that was never confirmed is taken back, leaving no trace in the history.
      const d = documentStore.document.features[edit.sketchId];
      if (d?.type === "sketch" && d.sketch.dimensions[edit.dimensionId]) {
        if (documentStore.undoLabel === "Dimension") documentStore.undo();
        else {
          editSketchSolved(edit.sketchId, "Remove dimension", (sketch) =>
            editSketch(sketch, (b) => b.removeDimension(edit.dimensionId)),
          );
        }
      }
    }
    close();
  };

  return (
    <div className="inline-editor" style={{ left: edit.x, top: edit.y }}>
      <input
        ref={inputRef}
        value={value}
        aria-label="Dimension value or expression"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") apply();
          else if (e.key === "Escape") cancel();
        }}
        onBlur={apply}
      />
    </div>
  );
}
