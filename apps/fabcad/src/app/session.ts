import type { BodyGeometry, TessellationOptions } from "@fabcad/brep";
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
  syncBodyRecords,
  updateSketch,
} from "@fabcad/cad-document";
import {
  type BodyNames,
  type ExportItem,
  type FeatureStatus,
  type PlaneResult,
  type SketchSolveInfo,
  type SketchStatus,
  resolveDocumentSketches,
  solveSketchWithParameters,
} from "@fabcad/features";
import { type Sketch, type SketchRegion, detectProfiles } from "@fabcad/sketch";
import { type DragTarget, createDefaultSolver } from "@fabcad/sketch-solver";
import { useSyncExternalStore } from "react";
import { EngineClient, WorkerFailure } from "../worker/engineClient";
import { appState, toast } from "./appState";
import {
  AutosaveConflictError,
  currentAutosaveToken,
  loadAutosave,
  loadRecoverySnapshots,
  storeAutosave,
} from "./persistence";
import { decodeShareFragment, isShareFragment } from "./shareLink";
import { loadCachedModel, storeCachedModel } from "./resultCache";
import { startTextMaintenance } from "../text/typography";
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
  /** Persistent names of the faces and edges of `geometry`. */
  names: BodyNames;
}

export interface ModelState {
  kernel: "loading" | "ready" | "error";
  kernelError: string;
  busy: boolean;
  /** The automatically saved project is still being looked for after the page was opened. */
  restoring: boolean;
  bodies: Record<string, BodyModel>;
  /** Construction planes as evaluated, by feature id. */
  planes: Record<string, PlaneResult>;
  features: Record<string, FeatureStatus>;
  sketches: Record<string, SketchStatus>;
  lastDurationMs: number;
  /** When the recompute running now started, to offer stopping it (`stopCadWorker()`). */
  computeStartedAt: number | null;
  /**
   * Recompute is held after a computation was stopped, so that the model that hung is not
   * computed again right away. The document can still be changed (for example the timeline
   * rolled back) before `resumeRecompute()`.
   */
  paused: boolean;
  /**
   * The model shown is the one kept from the last time this document was open: the engine is
   * still computing it (see `resultCache.ts`).
   */
  cached: boolean;
}

export const modelState = new TinyStore<ModelState>({
  kernel: "loading",
  kernelError: "",
  busy: false,
  restoring: true,
  bodies: {},
  planes: {},
  features: {},
  sketches: {},
  lastDurationMs: 0,
  computeStartedAt: null,
  paused: false,
  cached: false,
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
  if (s.activeComponentId && !doc.assembly.components[s.activeComponentId]) {
    patch.activeComponentId = null;
  }
  if (s.instanceMove && !doc.assembly.instances[s.instanceMove.instanceId]) {
    patch.instanceMove = null;
  }
  appState.set(patch);
}

// ---------------------------------------------------------------- recompute

let client: EngineClient | null = null;
let engineGeneration = 0;
let recomputeRunning = false;
let recomputeQueued = false;
let lastComputed: CadDocument | null = null;
/**
 * Recomputes in a row whose result was written back to the document. Writing back asks for
 * another recompute, which normally finds nothing left to write; the count stops a result
 * that keeps changing the document from going round forever.
 */
let writeBacks = 0;
const MAX_WRITE_BACKS = 4;
/** Counts the results of the engine shown, so that a cached model never replaces a newer one. */
let resultsShown = 0;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keep the model of a document once it has settled (no recompute for a while), so that
 * opening the document again shows it before the engine is done.
 */
function scheduleCacheStore(doc: CadDocument): void {
  if (cacheTimer) clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    if (lastComputed !== doc || recomputeRunning) return;
    const { bodies, planes, features, sketches } = modelState.get();
    void storeCachedModel(doc, { bodies, planes, features, sketches });
  }, 2000);
}

/**
 * Show the cached model of a document that was just opened, while the engine computes it. A
 * result of the engine that arrived first, or a change of the document meanwhile, wins.
 */
async function showCachedModel(doc: CadDocument): Promise<void> {
  const shown = resultsShown;
  const model = await loadCachedModel(doc);
  if (!model || resultsShown !== shown || geometryChanged(doc, documentStore.document)) return;
  modelState.set({ ...model, cached: true });
}

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
  // Projections from another component follow where its instances are.
  a.assembly !== b.assembly ||
  Object.keys(a.bodies).length !== Object.keys(b.bodies).length;

async function recomputeLoop(): Promise<void> {
  if (recomputeRunning) {
    recomputeQueued = true;
    return;
  }
  recomputeRunning = true;
  const generation = engineGeneration;
  try {
    do {
      recomputeQueued = false;
      const doc = documentStore.document;
      if (!geometryChanged(lastComputed, doc)) continue;
      modelState.set({ busy: true, computeStartedAt: Date.now() });
      const known: Record<string, string> = {};
      for (const b of Object.values(modelState.get().bodies)) known[b.id] = b.hash;
      const result = await engine().request({ type: "recompute", document: doc, known });
      if (generation !== engineGeneration) return;
      lastComputed = doc;
      const previous = modelState.get().bodies;
      const bodies: Record<string, BodyModel> = {};
      for (const b of result.bodies) {
        const geometry = b.geometry ?? previous[b.id]?.geometry;
        const names = b.names ?? previous[b.id]?.names;
        if (geometry && names) bodies[b.id] = { id: b.id, hash: b.hash, geometry, names };
      }
      resultsShown++;
      modelState.set({
        bodies,
        planes: Object.fromEntries((result.planes ?? []).map((p) => [p.id, p])),
        features: result.features,
        sketches: result.sketches,
        lastDurationMs: result.durationMs,
        cached: false,
      });
      // What the recompute found out about the document is written back, unless the document
      // changed meanwhile: the recompute that is queued for that change will do it then.
      if (documentStore.document !== doc) continue;
      const updates = result.sketchUpdates ?? {};
      // Bodies that only evaluation can tell (pattern instances …) get their record here.
      const syncBodies = syncBodyRecords(
        result.bodies.flatMap((b) => (b.record ? [{ id: b.id, ...b.record }] : [])),
        result.bodies.map((b) => b.id),
      );
      const changed =
        writeBacks < MAX_WRITE_BACKS &&
        documentStore.amend((d) => {
          // Projected sketch geometry follows the bodies it was taken from.
          let features = d.features;
          for (const [id, sketch] of Object.entries(updates)) {
            const f = features[id];
            if (!f || f.type !== "sketch") continue;
            if (features === d.features) features = { ...d.features };
            features[id] = { ...f, sketch };
          }
          return syncBodies(features === d.features ? d : { ...d, features });
        });
      writeBacks = changed ? writeBacks + 1 : 0;
      if (!changed) scheduleCacheStore(doc);
    } while (recomputeQueued);
  } catch (err) {
    if (generation === engineGeneration) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      // Only a failed worker needs a restart; an error of the engine leaves it usable.
      if (err instanceof WorkerFailure) modelState.set({ kernel: "error", kernelError: message });
      toast(`Recompute failed: ${message}`, "error");
    }
  } finally {
    recomputeRunning = false;
    modelState.set({ busy: false, computeStartedAt: null });
    if (generation !== engineGeneration && modelState.get().kernel === "ready") requestRecompute();
  }
}

/**
 * Starts a new CAD worker in place of the current one. `pause`: the worker was stopped while it
 * computed (it may hang on this model), so the model is not computed again until
 * `resumeRecompute()`.
 */
export async function restartCadWorker(pause = false): Promise<void> {
  engineGeneration++;
  client?.dispose();
  client = null;
  lastComputed = null;
  modelState.set({
    kernel: "loading",
    busy: false,
    computeStartedAt: null,
    paused: pause,
    cached: false,
    bodies: {},
    planes: {},
    features: {},
    sketches: {},
  });
  try {
    await engine().request({ type: "init" });
    modelState.set({ kernel: "ready" });
    requestRecompute();
  } catch (err) {
    modelState.set({ kernel: "error", kernelError: err instanceof Error ? err.message : String(err) });
  }
}

/** Stops a computation that takes too long; recompute stays paused. */
export function stopCadWorker(): Promise<void> {
  toast("Stopped the computation. Roll back the timeline or change the model, then Resume.", "warning", 9000);
  return restartCadWorker(true);
}

export function resumeRecompute(): void {
  modelState.set({ paused: false });
  requestRecompute();
}

export function requestRecompute(): void {
  const { kernel, paused } = modelState.get();
  if (kernel !== "ready" || paused) return;
  void recomputeLoop();
}

/** `options`: how finely curved faces are facetted; the kernel's default when left out. */
export async function bodyTopology(bodyId: string, options?: TessellationOptions) {
  return engine().request({ type: "topology", bodyId, ...(options ? { options } : {}) });
}

/** A body tessellated with other tolerances than the display, e.g. for a file to print. */
export async function bodyMesh(bodyId: string, options: TessellationOptions) {
  return engine().request({ type: "mesh", bodyId, options });
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
  toast("Project download requested. Verify the file in Downloads.");
}

function resetUi(): void {
  appState.set({
    activeSketchId: null,
    activeComponentId: null,
    instanceMove: null,
    newComponent: null,
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
  modelState.set({ bodies: {}, planes: {}, features: {}, sketches: {}, cached: false });
  documentStore.load(doc);
  void showCachedModel(doc);
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

/** The project kept in this browser that a shared one would replace, if it has any work in it. */
const workIn = (doc: CadDocument | null): CadDocument | null =>
  doc && (doc.timeline.length > 0 || doc.parameters.length > 0) ? doc : null;

/** Take the share fragment out of the address, without loading the page again. */
function clearShareFragment(): void {
  history.replaceState(history.state, "", window.location.pathname + window.location.search);
}

/**
 * Open the project of a share link (`hash`, `#project=…`). `current` is the project it would
 * replace: when there is work in it, the user is asked first. A link that cannot be opened
 * leaves everything as it was and says why. True when the shared project was opened.
 */
export async function openSharedProject(hash: string, current: CadDocument | null): Promise<boolean> {
  let doc: CadDocument;
  try {
    doc = deserializeDocument(await decodeShareFragment(hash));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast(`The shared project could not be opened. ${reason} Your own project was not changed.`, "error", 12000);
    return false;
  }
  const mine = workIn(current);
  if (
    mine &&
    !window.confirm(
      `Open the shared project "${doc.name}"?\n\nIt replaces the project kept in this browser ("${mine.name}"). ` +
        "Choose Cancel to keep working on yours; to keep both, save yours first (File → Save project).",
    )
  ) {
    return false;
  }
  loadDocument(doc);
  clearShareFragment();
  toast(`Opened the shared project "${doc.name}".`);
  return true;
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

/**
 * Write a STEP or STL file of the 3D model. `items` are the solids (see `app/exportModel.ts`):
 * a body may come several times, placed at the instances of its component.
 */
export async function exportModel(format: "step" | "stl", items: ExportItem[]): Promise<boolean> {
  const doc = documentStore.document;
  if (items.length === 0) {
    toast("There is no body to export.", "warning");
    return false;
  }
  if (modelState.get().cached) {
    toast("The model is still being computed. Export again in a moment.", "warning");
    return false;
  }
  try {
    const name = safeFileName(doc.name);
    if (format === "step") {
      const data = await engine().request({ type: "export-step", bodies: items });
      downloadBlob(data as unknown as BlobPart, `${name}.step`, "model/step");
    } else {
      const data = await engine().request({ type: "export-stl", bodies: items, binary: true });
      downloadBlob(data as unknown as BlobPart, `${name}.stl`, "model/stl");
    }
    toast(`Exported ${items.length} ${items.length === 1 ? "solid" : "solids"} as ${format.toUpperCase()}.`);
    return true;
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), "error");
    return false;
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
let autosaveToken: string | null = null;
let autosaveRevision = 0;
let savedRevision = 0;
/** Saves one after another; it starts once the token of the kept autosave is known. */
let saveQueue: Promise<void> = Promise.resolve();
/** The document restored from this browser at start-up, kept there already (see `beforeunload`). */
let restoredDocument: CadDocument | null = null;
/** The document the kept autosave holds: saving it again would only push out a snapshot. */
let autosavedDocument: CadDocument | null = null;

/**
 * `conflict`: another tab saved after this one read the autosave; this tab stops saving until
 * the user chooses to keep its version (`keepThisTabsAutosave()`).
 */
export type AutosaveStatus = "unsaved" | "saving" | "saved" | "error" | "conflict";
export const autosaveState = new TinyStore<{
  status: AutosaveStatus;
  message: string;
  lastSavedAt: number | null;
}>({ status: "unsaved", message: "", lastSavedAt: null });

function flushAutosave(): void {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const revision = autosaveRevision;
  if (revision === savedRevision || autosaveState.get().status === "conflict") return;
  const doc = documentStore.document;
  if (doc === autosavedDocument) {
    savedRevision = revision;
    autosaveState.set({ status: "saved", message: "" });
    return;
  }
  const json = serializeDocument(doc, false);
  const failedBefore = autosaveState.get().status === "error";
  autosaveState.set({ status: "saving" });
  saveQueue = saveQueue.then(async () => {
    // Skip an obsolete snapshot rather than saving it over a newer edit.
    if (revision < autosaveRevision) return;
    try {
      const token = await storeAutosave(json, autosaveToken);
      autosaveToken = token;
      autosavedDocument = doc;
      savedRevision = revision;
      if (revision === autosaveRevision) {
        autosaveState.set({ status: "saved", message: "", lastSavedAt: Date.now() });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof AutosaveConflictError) {
        autosaveState.set({ status: "conflict", message });
        toast("Another FabCAD tab saved its project in this browser. This tab no longer saves: choose Keep this tab in the status bar, or save the project as a file.", "error", 12000);
        return;
      }
      autosaveState.set({ status: "error", message });
      // Saving is tried again with the next change; the toast is shown once per failure.
      if (!failedBefore) toast("Browser autosave failed. Save the project as a file to protect your work.", "error", 9000);
    }
  });
}

export function retryAutosave(): void {
  autosaveRevision++;
  flushAutosave();
}

/** After a conflict: this tab's project replaces what another tab saved (that stays in the snapshots). */
export async function keepThisTabsAutosave(): Promise<void> {
  try {
    autosaveToken = await currentAutosaveToken();
  } catch (err) {
    autosaveState.set({ status: "error", message: err instanceof Error ? err.message : String(err) });
    return;
  }
  autosaveState.set({ status: "unsaved", message: "" });
  autosavedDocument = null;
  retryAutosave();
}

export { loadRecoverySnapshots };

/** Opens a recovery snapshot (Recover Autosave window) in place of the current project. */
export function restoreSnapshot(json: string): boolean {
  try {
    const recovered = deserializeDocument(json);
    if (
      documentStore.dirty &&
      documentStore.document.timeline.length > 0 &&
      !window.confirm("Replace the current project with this autosave? The current project stays in the autosave list.")
    ) {
      return false;
    }
    loadDocument(recovered);
    documentStore.markUnsaved();
    toast("Opened an earlier autosave. Save project to keep it as a file.");
    return true;
  } catch (err) {
    toast(`Could not open this autosave: ${err instanceof Error ? err.message : String(err)}`, "error");
    return false;
  }
}

export function startSession(): void {
  if (started) return;
  started = true;
  // Before the recompute listener: the model is computed from texts with current outlines.
  startTextMaintenance();

  documentStore.subscribe((doc) => {
    // While dragging, the 3D model is left alone; it catches up when the drag is committed.
    if (!documentStore.inTransaction) requestRecompute();
    autosaveRevision++;
    if (autosaveState.get().status !== "conflict") autosaveState.set({ status: "unsaved" });
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(flushAutosave, 1200);
  });

  const shared = isShareFragment(window.location.hash) ? window.location.hash : null;
  const loaded = loadAutosave();
  // A save must know which autosave it replaces (see `AutosaveConflictError`).
  saveQueue = loaded.then(
    (snapshot) => {
      autosaveToken = snapshot.token;
    },
    () => undefined,
  );
  void loaded
    .then(async (snapshot) => {
      if (documentStore.canUndo) return;
      let saved: CadDocument | null = null;
      let fellBack = false;
      try {
        saved = snapshot.json ? workIn(deserializeDocument(snapshot.json)) : null;
      } catch {
        // Try an earlier verified snapshot if the current one cannot be deserialized.
        fellBack = true;
        for (const previous of await loadRecoverySnapshots()) {
          try {
            saved = workIn(deserializeDocument(previous.json));
            if (saved) break;
          } catch { /* skip broken snapshot */ }
        }
        if (saved) toast("Latest recovery was invalid. Loaded an earlier version.", "warning");
      }
      if (snapshot.recovered) toast("Latest autosave was damaged. Restored a previous version.", "warning");
      // A share link opens its project; the one kept here is replaced only if the user says so.
      if (shared && (await openSharedProject(shared, saved))) return;
      if (saved) {
        loadDocument(saved);
        documentStore.markUnsaved();
        restoredDocument = documentStore.document;
        // Kept as it is, unless it came from an earlier snapshot than the damaged latest one.
        if (!snapshot.recovered && !fellBack) autosavedDocument = restoredDocument;
        toast("Restored the project kept in this browser. Save project to keep a file as well.");
      }
    })
    .catch((err: unknown) => {
      autosaveState.set({ status: "error", message: err instanceof Error ? err.message : String(err) });
      toast("Could not read browser recovery data.", "error");
    })
    .finally(() => modelState.set({ restoring: false }));

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

  // A share link pasted into the address bar of an open FabCAD only changes the fragment.
  window.addEventListener("hashchange", () => {
    if (isShareFragment(window.location.hash)) {
      void openSharedProject(window.location.hash, documentStore.document);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAutosave();
  });
  window.addEventListener("pagehide", flushAutosave);

  window.addEventListener("beforeunload", (event) => {
    // A restored project that was not changed is still kept in this browser as it is.
    const doc = documentStore.document;
    if (documentStore.dirty && doc !== restoredDocument && doc.timeline.length > 0) {
      event.preventDefault();
    }
  });
}
