import { type BodyGeometry, type TessellationOptions, isDevelopableSurface } from "@fabcad/brep";
import type { SolidTopology } from "@fabcad/geometry";
import type { CadBody, FabricationWarning } from "@fabcad/fabrication-core";
import { goreTessellation } from "@fabcad/fabrication-laser";
import { listBodies } from "@fabcad/cad-document";
import { useEffect, useMemo, useState } from "react";
import { bodyTopology, modelState, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { type FabricationOutput, compileFabrication } from "./pipeline";
import {
  type BodyChoice,
  type LaserFabricationSettings,
  FABRICATION_EXTENSION_KEY,
  chooseBodies,
  currentMaterial,
  normalizeFabricationSettings,
  resolvePaperSettings,
} from "./settingsModel";

export type FabricationStatus = "idle" | "loading" | "ready" | "error";

export interface FabricationState {
  status: FabricationStatus;
  output: FabricationOutput | null;
  bodies: BodyChoice[];
  settings: LaserFabricationSettings;
  /** True while `output` belongs to an older state of the model (kernel still computing). */
  stale: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------------- caches
// Module level, so that every component using the hook shares topology and compile results.

const MAX_TOPOLOGIES = 64;
/** Topology per `bodyId@hash`; `null` = the kernel has no topology for that body. */
const topologyCache = new Map<string, SolidTopology | null>();
const topologyErrors = new Map<string, string>();
const pending = new Map<string, Promise<void>>();

/** How the kernel is asked to facet a body; `undefined` = its own default. */
type Facets = TessellationOptions | undefined;

const facetTag = (facets: Facets): string =>
  facets ? `~${facets.tolerance ?? ""}/${facets.angularTolerance ?? ""}` : "";

const topologyKey = (bodyId: string, hash: string, facets?: Facets): string =>
  `${bodyId}@${hash}${facetTag(facets)}`;

function remember(key: string, topology: SolidTopology | null): void {
  topologyCache.set(key, topology);
  while (topologyCache.size > MAX_TOPOLOGIES) {
    const oldest = topologyCache.keys().next();
    if (oldest.done) break;
    topologyCache.delete(oldest.value);
  }
}

/** Fetch the topology of a body once per hash. Resolves when the caches are up to date. */
function loadTopology(bodyId: string, hash: string, facets?: Facets): Promise<void> {
  const key = topologyKey(bodyId, hash, facets);
  if (topologyCache.has(key) || topologyErrors.has(key)) return Promise.resolve();
  const running = pending.get(key);
  if (running) return running;
  const request = bodyTopology(bodyId, facets)
    .then((topology) => {
      // The worker answers with the CURRENT shape of the body. When the body changed while the
      // request was on its way, the answer does not belong to `hash`: drop it.
      if (modelState.get().bodies[bodyId]?.hash !== hash) return;
      remember(key, topology ?? null);
    })
    .catch((err: unknown) => {
      if (modelState.get().bodies[bodyId]?.hash !== hash) return;
      topologyErrors.set(key, err instanceof Error ? err.message : String(err));
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, request);
  return request;
}

let settingsMemo: { raw: unknown; settings: LaserFabricationSettings } | null = null;

/** Normalised settings, memoised by the identity of the raw extension value. */
function settingsFor(raw: unknown): LaserFabricationSettings {
  if (!settingsMemo || settingsMemo.raw !== raw) {
    settingsMemo = { raw, settings: normalizeFabricationSettings(raw) };
  }
  return settingsMemo.settings;
}

interface WantedBody {
  id: string;
  name: string;
  hash: string;
  facets: Facets;
}

const keyOf = (w: WantedBody): string => topologyKey(w.id, w.hash, w.facets);

/**
 * Gores are the facets of the body: when faces curved in two directions are to be made from
 * gores, the body is facetted as coarsely as there are gores to a full turn. A body whose
 * faces are all known to lie flat (planes, cylinders, cones, extruded outlines) has no gores
 * and keeps the kernel's default facets, which follow its outline closely.
 */
function facetsFor(settings: LaserFabricationSettings, geometry: BodyGeometry): Facets {
  const material = currentMaterial(settings);
  if (material.category !== "paper") return undefined;
  const paper = resolvePaperSettings(material, settings.paper);
  if (paper.doublyCurved !== "gores" || !paper.foldCurvedFacets) return undefined;
  if (geometry.faces.every((f) => isDevelopableSurface(f.surface))) return undefined;
  const { bounds } = geometry;
  const size = Math.hypot(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z,
  );
  return goreTessellation(paper.gores, size);
}

let compileMemo: {
  key: string;
  settings: LaserFabricationSettings;
  output: FabricationOutput;
} | null = null;

/** Last output per document, shown while the kernel recomputes. */
let lastOutput: { docId: string; output: FabricationOutput } | null = null;

function compileShared(
  docId: string,
  wanted: readonly WantedBody[],
  settings: LaserFabricationSettings,
): FabricationOutput {
  const key = `${docId}#${wanted.map((w) => `${keyOf(w)}:${w.name}`).join("|")}`;
  if (compileMemo && compileMemo.key === key && compileMemo.settings === settings) {
    return compileMemo.output;
  }
  const bodies: CadBody[] = [];
  const missing: FabricationWarning[] = [];
  for (const w of wanted) {
    const topology = topologyCache.get(keyOf(w));
    if (topology) bodies.push({ id: w.id, name: w.name, topology });
    else {
      missing.push({
        code: "unsupported",
        severity: "error",
        message: `Body "${w.name}" has no solid geometry to fabricate.`,
      });
    }
  }
  const compiled = compileFabrication(bodies, settings);
  const output =
    missing.length > 0 ? { ...compiled, warnings: [...missing, ...compiled.warnings] } : compiled;
  compileMemo = { key, settings, output };
  lastOutput = { docId, output };
  return output;
}

// ------------------------------------------------------------------------------------ hook

/** Settings of the current document (normalised, stable identity while unchanged). */
export function useFabricationSettings(): LaserFabricationSettings {
  const doc = useDocument();
  return settingsFor(doc.extensions[FABRICATION_EXTENSION_KEY]);
}

export function useFabrication(): FabricationState {
  const doc = useDocument();
  const model = useStore(modelState);
  const [, setTick] = useState(0);

  const settings = settingsFor(doc.extensions[FABRICATION_EXTENSION_KEY]);
  // Bodies used up by Combine are not offered.
  const bodies = useMemo(
    () => chooseBodies({ bodies: Object.fromEntries(listBodies(doc).map((b) => [b.id, b])) }, settings),
    [doc, settings],
  );

  const modelBodies = model.bodies;
  const wanted = useMemo(() => {
    const list: WantedBody[] = [];
    for (const b of bodies) {
      const model = modelBodies[b.id];
      if (!b.included || model === undefined) continue;
      list.push({
        id: b.id,
        name: b.name,
        hash: model.hash,
        facets: facetsFor(settings, model.geometry),
      });
    }
    return list;
  }, [bodies, modelBodies, settings]);
  const requestKey = wanted.map((w) => keyOf(w)).join("|");

  useEffect(() => {
    let cancelled = false;
    for (const w of wanted) {
      const key = keyOf(w);
      if (topologyCache.has(key) || topologyErrors.has(key)) continue;
      void loadTopology(w.id, w.hash, w.facets).then(() => {
        // Ignore results that arrive after the request set changed or the component unmounted.
        if (!cancelled) setTick((t) => t + 1);
      });
    }
    return () => {
      cancelled = true;
    };
    // `requestKey` identifies `wanted`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const previous = lastOutput && lastOutput.docId === doc.id ? lastOutput.output : null;

  if (model.kernel === "error") {
    return {
      status: "error",
      output: previous,
      bodies,
      settings,
      stale: previous !== null,
      error: model.kernelError || "The geometry kernel failed to start.",
    };
  }
  if (bodies.length === 0) {
    return { status: "idle", output: null, bodies, settings, stale: false };
  }

  const failure = wanted
    .map((w) => ({ body: w, message: topologyErrors.get(keyOf(w)) }))
    .find((f) => f.message !== undefined);
  if (failure) {
    return {
      status: "error",
      output: previous,
      bodies,
      settings,
      stale: previous !== null,
      error: `Could not read the geometry of "${failure.body.name}": ${failure.message ?? ""}`,
    };
  }

  // Included bodies whose shape the kernel has not delivered yet.
  const awaitingModel =
    (model.busy || model.kernel !== "ready") &&
    bodies.some((b) => b.included && modelBodies[b.id] === undefined);
  const loaded = wanted.every((w) => topologyCache.has(keyOf(w)));

  if (loaded && !awaitingModel) {
    const output = compileShared(doc.id, wanted, settings);
    return { status: "ready", output, bodies, settings, stale: false };
  }
  if (previous) return { status: "ready", output: previous, bodies, settings, stale: true };
  return { status: "loading", output: null, bodies, settings, stale: false };
}
