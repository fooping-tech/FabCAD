import { type PrintJob, write3mf, writeBinaryStl } from "@fabcad/fabrication-print";
import { toast } from "../app/appState";
import { downloadBlob, safeFileName } from "../app/session";

/** Export the parts as they lie on the bed, in millimetres. */
export function exportPrintJob(format: "stl" | "3mf", job: PrintJob | null, docName: string): void {
  const parts = job?.parts.filter((p) => p.placed) ?? [];
  if (parts.length === 0) {
    toast("There is nothing to export. Design a body first.", "warning");
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
  toast(
    `Exported ${parts.length} ${parts.length === 1 ? "part" : "parts"} as ${format.toUpperCase()}.` +
      (skipped > 0 ? ` ${skipped} did not fit on the bed and ${skipped === 1 ? "was" : "were"} left out.` : ""),
  );
}
