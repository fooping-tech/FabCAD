import { type ReactElement, useEffect, useState } from "react";
import {
  autosaveState,
  keepThisTabsAutosave,
  modelState,
  restartCadWorker,
  resumeRecompute,
  retryAutosave,
  stopCadWorker,
} from "../app/session";
import { useStore } from "../app/tinyStore";
import { useHelpTrigger } from "../help/useHelpTrigger";

/** A computation running this long can be stopped. */
const STOP_AFTER_S = 8;

/** Help on right-click or long press. */
function useHelpHandlers(id: string, title: string) {
  const trigger = useHelpTrigger({ id, title });
  const { guard, ...handlers } = trigger ?? { guard: (f: () => void) => f };
  return { guard, handlers };
}

/**
 * What autosave and the geometry kernel need from the user: Retry, Keep this tab, Stop, Resume,
 * Restart CAD. In the status bar, and in the touch bar on small screens, which have no status bar.
 */
export function StatusActions({ touch = false }: { touch?: boolean }): ReactElement {
  const model = useStore(modelState);
  const autosave = useStore(autosaveState);
  const saveHelp = useHelpHandlers("file.autosave", "Autosave");
  const stopHelp = useHelpHandlers("model.stop", "Stop Computation");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!model.busy) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [model.busy]);
  const computeSeconds = model.computeStartedAt ? Math.max(0, Math.floor((now - model.computeStartedAt) / 1000)) : 0;
  const cls = touch ? "touch-btn" : "btn small";

  return (
    <>
      {autosave.status === "error" && (
        <button
          className={touch ? `${cls} danger` : cls}
          title={autosave.message}
          {...saveHelp.handlers}
          onClick={saveHelp.guard(retryAutosave)}
        >
          {touch ? "Autosave failed · Retry" : "Retry"}
        </button>
      )}
      {autosave.status === "conflict" && (
        <button
          className={touch ? `${cls} danger` : cls}
          title="Save this tab's project in place of the other tab's (that one stays in Recover autosave…)"
          {...saveHelp.handlers}
          onClick={saveHelp.guard(() => void keepThisTabsAutosave())}
        >
          Keep this tab
        </button>
      )}
      {model.busy && computeSeconds >= STOP_AFTER_S && (
        <button className={cls} {...stopHelp.handlers} onClick={stopHelp.guard(() => void stopCadWorker())}>
          Stop ({computeSeconds} s)
        </button>
      )}
      {model.kernel === "error" && (
        <button className={cls} {...stopHelp.handlers} onClick={stopHelp.guard(() => void restartCadWorker())}>
          Restart CAD
        </button>
      )}
      {model.paused && model.kernel === "ready" && (
        <button className={cls} {...stopHelp.handlers} onClick={stopHelp.guard(resumeRecompute)}>
          Resume
        </button>
      )}
    </>
  );
}
