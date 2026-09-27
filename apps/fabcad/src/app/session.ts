import type { BodyGeometry } from "@fabcad/brep";
import {
  type CadDocument,
  type Command,
  DocumentStore,
  type ParameterEvaluation,
  PROJECT_FILE_EXTENSION,
  type Scope,
  command,
  createDocument,
  deserializeDocument,
  evaluateParameters,
  parameterScope,
  serializeDocument,
  updateSketch,
} from "@fabcad/cad-document";
import {
  type FeatureStatus,
  type SketchSolveInfo,
  type SketchStatus,
  resolveDocumentSketches,
  solveSketchWithParameters,
} from "@fabcad/features";
import { type Sketch, type SketchRegion, detectProfiles } from "@fabcad/sketch";
import { type DragTarget, createDefaultSolver } from "@fabcad/sketch-solver";
import { useSyncExternalStore } from "react";
import { EngineClient } from "../worker/engineClient";
import { appState, toast } from "./appState";
import { loadAutosave, storeAutosave } from "./persistence";
import { TinyStore } from "./tinyStore";

/**
 * Session: wires the document store, the sketch solver and the CAD worker together.
 * UI components talk to the document only through the functions exported here.
 */

export const documentStore = new DocumentStore(createDocument("Untitled"));
export const solver = createDefaultSolver();

export interface BodyModel {
  id: string;
  hash: string;
  geometry: BodyGeometry;
}

export interface ModelState {
  kernel: "loading" | "ready" | "error";
  kernelError: string;
  busy: boolean;
  bodies: Record<string, BodyModel>;
  features: Record<string, FeatureStatus>;
  sketches: Record<string, SketchStatus>;
  lastDurationMs: number;
}

export const modelState = new TinyStore<ModelState>({
  kernel: "loading",
  kernelError: "",
  busy: false,
  bodies: {},
  features: {},
  sketches: {},
  lastDurationMs: 0,
});

export function useDocument(): CadDocument {
  return useSyncExternalStore(documentStore.subscribe, documentStore.getSnapshot);
}

/** Re-render on undo / redo / save state changes. */
export function useHistoryState(): {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  dirty: boolean;
} {
  useDocument();
  return {
    canUndo: documentStore.canUndo,
    canRedo: documentStore.canRedo,
    undoLabel: documentStore.undoLabel,
    redoLabel: documentStore.redoLabel,
    dirty: documentStore.dirty,
  };
}

// ------------------------------------------------------------ derived values

let lastParameters: CadDocument["parameters"] | null = null;
let lastEvaluation: ParameterEvaluation = evaluateParameters([]);

export function parameterEvaluation(doc: CadDocument = documentStore.document): ParameterEvaluation {
  if (doc.parameters !== lastParameters) {
    lastParameters = doc.parameters;
    lastEvaluation = evaluateParameters(doc.parameters);
  }
  return lastEvaluation;
}

export function currentScope(doc: CadDocument = documentStore.document): Scope {
  return parameterScope(parameterEvaluation(doc));
}

export interface SketchView extends SketchSolveInfo {
  regions: SketchRegion[];
}

const sketchViews = new WeakMap<Sketch, { evaluation: ParameterEvaluation; view: SketchView }>();

/** Solve state and profiles of a sketch, cached per sketch value. */
export function sketchView(sketch: Sketch, doc: CadDocument = documentStore.document): SketchView {
  const evaluation = parameterEvaluation(doc);
  const cached = sketchViews.get(sketch);
  if (cached && cached.evaluation === evaluation) return cached.view;
  const info = solveSketchWithParameters(sketch, solver, parameterScope(evaluation));
  let regions: SketchRegion[] = [];
  try {
    regions = detectProfiles(sketch);
  } catch (err) {
    console.error("Profile detection failed", err);
  }
  // The document stores solved geometry, so the view keeps the stored sketch as is.
  const view: SketchView = { ...info, sketch, regions };
  sketchViews.set(sketch, { evaluation, view });
  return view;
}

// ------------------------------------------------------------------ commands

/** Execute a command. Parameter changes re-solve the sketches as part of the same undo step. */
export function run(cmd: Command): boolean {
  return documentStore.execute(
    command(cmd.label, (doc) => {
      const next = cmd.apply(doc);
      if (next === doc) return doc;
      return next.parameters !== doc.parameters ? resolveDocumentSketches(next, solver) : next;
    }),
  );
}

export interface SketchEditOptions {
  /** Refuse the edit when it over-constrains the sketch. */
  rejectOverConstrained?: boolean;
}

/** Edit a sketch and solve it. Returns false when the edit was refused or changed nothing. */
export function editSketchSolved(
  sketchId: string,
  label: string,
  edit: (sketch: Sketch) => Sketch,
  options: SketchEditOptions = {},
): boolean {
  const doc = documentStore.document;
  const feature = doc.features[sketchId];
  if (!feature || feature.type !== "sketch") return false;
  let edited: Sketch;
  try {
    edited = edit(feature.sketch);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
    return false;
  }
  if (edited === feature.sketch) return false;
  const info = solveSketchWithParameters(edited, solver, currentScope(doc));
  const dimensionError = Object.values(info.dimensionErrors)[0];
  if (dimensionError && options.rejectOverConstrained) {
    toast(`Dimension: ${dimensionError}`, "error");
    return false;
  }
  if (info.status === "over-constrained" && options.rejectOverConstrained) {
    toast("This would over-constrain the sketch.", "warning");
    return false;
  }
  const result = info.converged ? info.sketch : edited;
  return documentStore.execute(updateSketch(sketchId, label, () => result));
}

/** Solve a sketch while dragging points; constraints keep holding during the drag. */
export function solveDrag(sketch: Sketch, drag: DragTarget[]): Sketch | null {
  const info = solveSketchWithParameters(sketch, solver, currentScope(), drag);
  return info.converged ? info.sketch : null;
}

export function undo(): void {
  if (documentStore.undo()) afterHistoryJump();
}

export function redo(): void {
  if (documentStore.redo()) afterHistoryJump();
}

function afterHistoryJump(): void {
  const s = appState.get();
  const doc = documentStore.document;
  // Drop UI state that refers to objects that no longer exist.
  const patch: Partial<ReturnType<typeof appState.get>> = { selection: [], hover: null, dimensionEdit: null };
  if (s.activeSketchId && !doc.features[s.activeSketchId]) {
    patch.activeSketchId = null;
    patch.tool = "select";
  }
  appState.set(patch);
}

// ---------------------------------------------------------------- recompute

let client: EngineClient | null = null;
let recomputeRunning = false;
let recomputeQueued = false;
let lastComputed: CadDocument | null = null;

function engine(): EngineClient {
  if (!client) client = new EngineClient();
  return client;
}

/** Only these parts of a document influence geometry. */
const geometryChanged = (a: CadDocument | null, b: CadDocument): boolean =>
  !a ||
  a.features !== b.features ||
  a.timeline !== b.timeline ||
  a.timelineCursor !== b.timelineCursor ||
  a.parameters !== b.parameters ||
  Object.keys(a.bodies).length !== Object.keys(b.bodies).length;

async function recomputeLoop(): Promise<void> {
  if (recomputeRunning) {
    recomputeQueued = true;
    return;
  }
  recomputeRunning = true;
  try {
    do {
      recomputeQueued = false;
      const doc = documentStore.document;
      if (!geometryChanged(lastComputed, doc)) continue;
      modelState.set({ busy: true });
      const known: Record<string, string> = {};
      for (const b of Object.values(modelState.get().bodies)) known[b.id] = b.hash;
      const result = await engine().request({ type: "recompute", document: doc, known });
      lastComputed = doc;
      const previous = modelState.get().bodies;
      const bodies: Record<string, BodyModel> = {};
      for (const b of result.bodies) {
        const geometry = b.geometry ?? previous[b.id]?.geometry;
        if (geometry) bodies[b.id] = { id: b.id, hash: b.hash, geometry };
      }
      modelState.set({
        bodies,
        features: result.features,
        sketches: result.sketches,
        lastDurationMs: result.durationMs,
      });
    } while (recomputeQueued);
  } catch (err) {
    console.error(err);
    toast(`Recompute failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  } finally {
    recomputeRunning = false;
    modelState.set({ busy: false });
  }
}

export function requestRecompute(): void {
  if (modelState.get().kernel !== "ready") return;
  void recomputeLoop();
}

export async function bodyTopology(bodyId: string) {
  return engine().request({ type: "topology", bodyId });
}

// ------------------------------------------------------------ files and export

export function downloadBlob(data: BlobPart, fileName: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFileName = (name: string): string =>
  name.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "fabcad";

export function saveProject(): void {
  const doc = documentStore.document;
  downloadBlob(
    serializeDocument(doc),
    `${safeFileName(doc.name)}${PROJECT_FILE_EXTENSION}`,
    "application/json",
  );
  documentStore.markSaved();
  toast("Project saved.");
}

function resetUi(): void {
  appState.set({
    activeSketchId: null,
    tool: "select",
    selection: [],
    hover: null,
    dialog: null,
    dimensionEdit: null,
  });
}

export function loadDocument(doc: CadDocument): void {
  resetUi();
  lastComputed = null;
  modelState.set({ bodies: {}, features: {}, sketches: {} });
  documentStore.load(doc);
  requestRecompute();
}

export async function openProjectFile(file: File): Promise<void> {
  try {
    loadDocument(deserializeDocument(await file.text()));
    toast(`Opened ${file.name}.`);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error", 7000);
  }
}

export function newProject(): void {
  loadDocument(createDocument("Untitled"));
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function visibleBodies(doc: CadDocument): { id: string; name: string }[] {
  const computed = modelState.get().bodies;
  const selected = appState
    .get()
    .selection.flatMap((s) => ("bodyId" in s ? [s.bodyId] : []));
  const all = Object.values(doc.bodies).filter((b) => computed[b.id]);
  const chosen = selected.length > 0 ? all.filter((b) => selected.includes(b.id)) : all.filter((b) => b.visible);
  return chosen.map((b) => ({ id: b.id, name: b.name }));
}

export async function exportModel(format: "step" | "stl"): Promise<void> {
  const doc = documentStore.document;
  const bodies = visibleBodies(doc);
  if (bodies.length === 0) {
    toast("There is no body to export.", "warning");
    return;
  }
  try {
    const name = safeFileName(doc.name);
    if (format === "step") {
      const data = await engine().request({ type: "export-step", bodies });
      downloadBlob(data as unknown as BlobPart, `${name}.step`, "model/step");
    } else {
      const data = await engine().request({
        type: "export-stl",
        bodyIds: bodies.map((b) => b.id),
        binary: true,
      });
      downloadBlob(data as unknown as BlobPart, `${name}.stl`, "model/stl");
    }
    toast(`Exported ${bodies.length} ${bodies.length === 1 ? "body" : "bodies"} as ${format.toUpperCase()}.`);
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
  }
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// -------------------------------------------------------------------- start-up

let started = false;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export function startSession(): void {
  if (started) return;
  started = true;

  documentStore.subscribe((doc) => {
    // While dragging, the 3D model is left alone; it catches up when the drag is committed.
    if (!documentStore.inTransaction) requestRecompute();
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void storeAutosave(serializeDocument(doc, false));
    }, 1200);
  });

  void loadAutosave().then((json) => {
    if (!json || documentStore.canUndo) return;
    try {
      const doc = deserializeDocument(json);
      if (doc.timeline.length > 0 || doc.parameters.length > 0) {
        loadDocument(doc);
        toast("Restored the automatically saved project.");
      }
    } catch {
      // A broken autosave is ignored.
    }
  });

  engine()
    .request({ type: "init" })
    .then(() => {
      modelState.set({ kernel: "ready" });
      requestRecompute();
    })
    .catch((err: unknown) => {
      modelState.set({
        kernel: "error",
        kernelError: err instanceof Error ? err.message : String(err),
      });
    });

  window.addEventListener("beforeunload", (event) => {
    if (documentStore.dirty && documentStore.document.timeline.length > 0) {
      event.preventDefault();
    }
  });
}
