import { toast } from "./appState";
import { historyLog } from "./historyLog";
import { documentStore, modelState } from "./session";

/** The history log of the document as it is now; `project: false` leaves out the JSON. */
export function currentHistoryLog(project = true): string {
  const { features, bodies } = modelState.get();
  return historyLog(documentStore.document, features, bodies, {
    version: __APP_VERSION__,
    date: new Date(),
    project,
  });
}

/** Copy the history log (steps, bodies and the project) for a bug report. */
export async function copyHistoryLog(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentHistoryLog());
    toast("Copied the history log.");
  } catch {
    toast("The browser did not allow copying.", "warning");
  }
}
