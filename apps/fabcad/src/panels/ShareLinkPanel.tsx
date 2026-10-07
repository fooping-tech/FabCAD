import { type ReactElement, useEffect, useState } from "react";
import { serializeDocument } from "@fabcad/cad-document";
import { appState, toast } from "../app/appState";
import { saveProject, useDocument } from "../app/session";
import { SHARE_LINK_LIMIT, makeShareLink } from "../app/shareLink";
import { useStore } from "../app/tinyStore";
import { FloatingPanel } from "../ui/FloatingPanel";

/** The address of the app itself, to which the fragment is added. */
const appAddress = (): string => window.location.href.replace(/#.*$/, "");

/**
 * A link that opens the current project: the project is in the link itself (its fragment), so
 * nothing is uploaded. The link is shown as text too, for where the clipboard cannot be used.
 */
export function ShareLinkPanel(): ReactElement | null {
  const open = useStore(appState, (s) => s.shareLinkOpen);
  const doc = useDocument();
  const [link, setLink] = useState<Awaited<ReturnType<typeof makeShareLink>> | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setLink(null);
    // Follows the model while the window is open; a short pause keeps typing cheap.
    const t = setTimeout(() => {
      void makeShareLink(appAddress(), serializeDocument(doc, false)).then((l) => live && setLink(l));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, doc]);

  if (!open) return null;
  const close = (): void => appState.set({ shareLinkOpen: false });
  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Copied the share link.");
    } catch {
      toast("The browser did not allow copying. Select the link in the window and copy it.", "warning");
    }
  };
  const limit = `${(SHARE_LINK_LIMIT / 1_048_576).toFixed(0)} MiB`;

  return (
    <FloatingPanel id="share-link" anchor={null} title="Share Link" className="share-link" onClose={close}>
      <div className="floating-body">
        {!link ? (
          <p className="field-hint">Making the link…</p>
        ) : link.ok ? (
          <>
            <textarea
              className="share-link-text"
              readOnly
              aria-label="Share link"
              value={link.url}
              onFocus={(e) => e.currentTarget.select()}
            />
            <p className="field-hint">
              {link.url.length.toLocaleString("en")} characters (at most {limit}).
            </p>
          </>
        ) : (
          <p className="share-link-problem" role="alert">
            The link would be {link.length.toLocaleString("en")} characters long, more than the {limit} a
            share link can carry. Save the project as a file and send the file instead.
          </p>
        )}
        <ul className="share-link-notes">
          <li>
            The model is inside the link itself: anyone who has the link can open it. Nothing is
            uploaded.
          </li>
          <li>
            Chat, mail and social apps may cut long links. If the link does not open, send the
            project file (Save project) instead.
          </li>
          <li>Fonts you loaded yourself are not in the link, as in a saved project.</li>
        </ul>
        <div className="form-actions">
          <button className="btn" onClick={close}>
            Close
          </button>
          {link && !link.ok && (
            <button className="btn accent" onClick={saveProject}>
              Save project
            </button>
          )}
          {link?.ok && (
            <button className="btn accent" onClick={() => void copy(link.url)}>
              Copy link
            </button>
          )}
        </div>
      </div>
    </FloatingPanel>
  );
}
