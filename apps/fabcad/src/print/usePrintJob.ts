import { type CadDocument, setExtension } from "@fabcad/cad-document";
import { type PrintJob, compilePrintJob } from "@fabcad/fabrication-print";
import { type PrintBodyChoice, printBodies, printChoices, withCopyOrientations } from "./bodies";
import { useMemo } from "react";
import { type BodyModel, documentStore, modelState, run, useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import {
  PRINT_EXTENSION_KEY,
  type PrintWorkspaceSettings,
  readPrintSettings,
  toPrintSettings,
} from "./settingsModel";

export type { PrintBodyChoice };

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

/** The print job of a document: what the preview shows and what the export writes. */
export function printJobFor(
  doc: CadDocument,
  settings: PrintWorkspaceSettings,
  choices: readonly PrintBodyChoice[],
  models: Record<string, BodyModel>,
): PrintJob | null {
  const meshes = Object.fromEntries(Object.entries(models).map(([id, m]) => [id, m.geometry]));
  const input = printBodies(doc, choices, meshes);
  if (input.length === 0) return null;
  try {
    return compilePrintJob(input, withCopyOrientations(toPrintSettings(settings), input));
  } catch (err) {
    console.error(err);
    return null;
  }
}

export function usePrintJob(): PrintState {
  const doc = useDocument();
  const models = useStore(modelState, (s) => s.bodies);
  const busy = useStore(modelState, (s) => s.busy);
  const settings = useMemo(() => readPrintSettings(doc), [doc.extensions]);
  const bodies = useMemo<PrintBodyChoice[]>(
    () => printChoices(doc, settings, new Set(Object.keys(models))),
    [doc.bodies, doc.assembly, doc.features, doc.timeline, models, settings],
  );
  const job = useMemo(() => printJobFor(doc, settings, bodies, models), [bodies, models, settings]);
  return { settings, bodies, job, stale: busy };
}
