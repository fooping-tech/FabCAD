import { toast } from "../app/appState";
import { downloadBlob, safeFileName } from "../app/session";
import { type ExportFormat, type FabricationOutput, buildSheetFiles } from "./pipeline";

/**
 * Download the sheets as SVG or DXF, one file per sheet (`name-sheet-1.svg`, … when there are
 * several). The files are drawn from `output.geometry`, the same geometry as the preview.
 */
export function exportSheets(
  format: ExportFormat,
  output: FabricationOutput,
  docName: string,
  labels: boolean,
): void {
  const files = buildSheetFiles(format, output, safeFileName(docName), labels);
  if (files.length === 0) {
    toast("There are no parts to export.", "warning");
    return;
  }
  files.forEach((file, i) => {
    // Browsers drop downloads that start in the same tick; space them out.
    if (i === 0) downloadBlob(file.data, file.fileName, file.mime);
    else setTimeout(() => downloadBlob(file.data, file.fileName, file.mime), i * 200);
  });
  const what = files.length === 1 ? files[0]!.fileName : `${files.length} ${format.toUpperCase()} files`;
  const skipped = output.layout.unplaced.length;
  if (skipped > 0) {
    toast(`Exported ${what}. ${skipped} part(s) do not fit on the sheet and were left out.`, "warning");
  } else {
    toast(`Exported ${what}.`);
  }
}
