import type { CadDocument } from "@fabcad/cad-document";
import { type PrintJob, write3mf, writeBinaryStl } from "@fabcad/fabrication-print";
import { toast } from "../app/appState";
import { type BodyModel, bodyMesh, downloadBlob, safeFileName } from "../app/session";
import { type PrintBodyChoice, sourceBodyId } from "./bodies";
import type { PrintWorkspaceSettings } from "./settingsModel";
import { printJobFor } from "./usePrintJob";

/**
 * How finely the bodies are tessellated for the file: as for an STL of the model (0.02 mm),
 * finer than the display (0.05 mm), which the preview of the bed uses.
 */
export const PRINT_TESSELLATION = { tolerance: 0.02, angularTolerance: 0.2 };

/** Bodies the job refused, with why (one entry per body, not per copy). */
export function refusedBodies(job: PrintJob | null): { bodyId: string; message: string }[] {
  const out = new Map<string, string>();
  for (const w of job?.warnings ?? []) {
    if (w.severity !== "error" || !w.partId) continue;
    const id = sourceBodyId(w.partId);
    if (!out.has(id)) out.set(id, w.message);
  }
  return [...out].map(([bodyId, message]) => ({ bodyId, message }));
}

/**
 * Why nothing of a job can be written, or null when there are parts on the bed. `chosen` is
 * the number of bodies chosen for printing.
 */
export function nothingToPrint(job: PrintJob | null, chosen: number): string | null {
  if ((job?.parts.filter((p) => p.placed).length ?? 0) > 0) return null;
  if (chosen === 0) return "No body is chosen for printing.";
  const refused = refusedBodies(job);
  if (refused.length > 0) {
    return (
      `Nothing can be printed. ${refused.map((r) => r.message).join(" ")} ` +
      "Export → 3D model → STL… writes the body without this check, for a slicer that repairs meshes."
    );
  }
  if (job && job.parts.length > 0) return "Nothing fits on the bed: make the bed larger or the parts smaller.";
  return "There is nothing to export. Design a body first.";
}

/**
 * Export the print job of the chosen bodies with the finer tessellation of
 * `PRINT_TESSELLATION`. The job is compiled again from those meshes; the parts are the same
 * as in the preview, only their facets follow the curved faces more closely.
 */
export async function exportPrintFile(
  format: "stl" | "3mf",
  doc: CadDocument,
  settings: PrintWorkspaceSettings,
  choices: readonly PrintBodyChoice[],
  models: Record<string, BodyModel>,
  chosen: number,
): Promise<void> {
  const fine: Record<string, BodyModel> = { ...models };
  try {
    await Promise.all(
      choices
        .filter((c) => c.included && models[c.id])
        .map(async (c) => {
          const geometry = await bodyMesh(c.id, PRINT_TESSELLATION);
          if (geometry) fine[c.id] = { ...models[c.id]!, geometry };
        }),
    );
  } catch (err) {
    // The display meshes still make a file.
    console.error(err);
  }
  exportPrintJob(format, printJobFor(doc, settings, choices, fine), doc.name, chosen);
}

/** Export the parts as they lie on the bed, in millimetres. */
export function exportPrintJob(
  format: "stl" | "3mf",
  job: PrintJob | null,
  docName: string,
  chosen = job?.parts.length ?? 0,
): void {
  const parts = job?.parts.filter((p) => p.placed) ?? [];
  const problem = nothingToPrint(job, chosen);
  if (problem || parts.length === 0) {
    toast(problem ?? "There is nothing to export. Design a body first.", "warning", 9000);
    return;
  }
  const name = safeFileName(docName);
  if (format === "stl") {
    const data = writeBinaryStl(parts.map((p) => p.mesh), `FabCAD ${name}`);
    downloadBlob(data as unknown as BlobPart, `${name}.stl`, "model/stl");
  } else {
    const data = write3mf(parts.map((p) => ({ name: p.name, mesh: p.mesh })));
    downloadBlob(data as unknown as BlobPart, `${name}.3mf`, "model/3mf");
  }
  const skipped = (job?.parts.length ?? 0) - parts.length;
  const refused = refusedBodies(job).length;
  toast(
    `Exported ${parts.length} ${parts.length === 1 ? "part" : "parts"} as ${format.toUpperCase()}.` +
      (skipped > 0 ? ` ${skipped} did not fit on the bed and ${skipped === 1 ? "was" : "were"} left out.` : "") +
      (refused > 0 ? ` ${refused} ${refused === 1 ? "body cannot" : "bodies cannot"} be printed and ${refused === 1 ? "was" : "were"} left out (see 3D Print).` : ""),
    refused > 0 ? "warning" : "info",
    refused > 0 ? 9000 : 4000,
  );
}
