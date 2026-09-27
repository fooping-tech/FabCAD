import { setExtension } from "@fabcad/cad-document";
import { type PrintBody, type PrintJob, compilePrintJob } from "@fabcad/fabrication-print";
import { useMemo } from "react";
import { type BodyModel, documentStore, modelState, run, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import {
  PRINT_EXTENSION_KEY,
  type PrintWorkspaceSettings,
  readPrintSettings,
  toPrintSettings,
} from "./settingsModel";

export interface PrintBodyChoice {
  id: string;
  name: string;
  visible: boolean;
  included: boolean;
}

export interface PrintState {
  settings: PrintWorkspaceSettings;
  bodies: PrintBodyChoice[];
  job: PrintJob | null;
  /** True while the model is being recomputed: the job shows the previous geometry. */
  stale: boolean;
}

export function updatePrintSettings(
  patch: Partial<PrintWorkspaceSettings>,
  label = "Change print settings",
): void {
  const current = readPrintSettings(documentStore.document);
  run(setExtension(PRINT_EXTENSION_KEY, { ...current, ...patch }, label));
}

/** Bodies as the print compiler receives them: tessellated, nothing else. */
export function printBodies(
  bodies: PrintBodyChoice[],
  models: Record<string, BodyModel>,
): PrintBody[] {
  return bodies.flatMap((b) => {
    const g = models[b.id]?.geometry;
    return b.included && g
      ? [{ id: b.id, name: b.name, mesh: { positions: g.positions, indices: g.indices } }]
      : [];
  });
}

export function usePrintJob(): PrintState {
  const doc = useDocument();
  const models = useStore(modelState, (s) => s.bodies);
  const busy = useStore(modelState, (s) => s.busy);
  const settings = useMemo(() => readPrintSettings(doc), [doc.extensions]);
  const bodies = useMemo<PrintBodyChoice[]>(
    () =>
      Object.values(doc.bodies)
        .filter((b) => models[b.id])
        .map((b) => ({
          id: b.id,
          name: b.name,
          visible: b.visible,
          included: settings.bodyIds ? settings.bodyIds.includes(b.id) : b.visible,
        })),
    [doc.bodies, models, settings.bodyIds],
  );
  const job = useMemo(() => {
    const input = printBodies(bodies, models);
    if (input.length === 0) return null;
    try {
      return compilePrintJob(input, toPrintSettings(settings));
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [bodies, models, settings]);
  return { settings, bodies, job, stale: busy };
}
