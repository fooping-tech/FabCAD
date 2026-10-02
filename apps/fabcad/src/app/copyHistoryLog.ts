import { toast } from "./appState";
import { historyLog } from "./historyLog";
import { documentStore, modelState } from "./session";

/** Copy the history log (steps, bodies and the project) for a bug report. */
export async function copyHistoryLog(): Promise<void> {
  const { features, bodies } = modelState.get();
  const text = historyLog(documentStore.document, features, bodies, {
    version: __APP_VERSION__,
    date: new Date(),
  });
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied the history log.");
  } catch {
    toast("The browser did not allow copying.", "warning");
  }
}
