import { type ReactElement, type ReactNode, useEffect } from "react";
import { appState } from "../app/appState";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";
import { helpFor } from "./content";
import { closeHelpTopic } from "./helpState";

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="help-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

const List = ({ items }: { items: string[] }): ReactElement => (
  <ul>
    {items.map((text, i) => (
      <li key={i}>{text}</li>
    ))}
  </ul>
);

/**
 * The full explanation of a tool. It lies over the editor and takes nothing away from it:
 * the running command, its dialog and the selection are as they were when it is closed.
 */
export function HelpOverlay(): ReactElement | null {
  const topic = useStore(appState, (s) => s.help.topic);

  useEffect(() => {
    if (!topic) return;
    const key = (e: KeyboardEvent): void => {
      // Keys belong to the overlay while it is open: no shortcut reaches the editor.
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        closeHelpTopic();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [topic]);

  if (!topic) return null;
  const entry = helpFor(topic.id, topic);
  return (
    <div
      className="modal-backdrop help-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && closeHelpTopic()}
    >
      <div className="modal help-overlay" role="dialog" aria-modal="true" aria-label={`Help: ${entry.title}`}>
        <div className="modal-title">
          <span>
            {entry.title}
            {entry.shortcut && <span className="help-shortcut">{entry.shortcut}</span>}
          </span>
          <button className="icon-btn" aria-label="Close help" onClick={closeHelpTopic}>
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body help-body">
          <p className="help-summary">{entry.summary}</p>
          <Section title="What it does">
            {entry.what.map((text, i) => (
              <p key={i}>{text}</p>
            ))}
          </Section>
          {entry.when && (
            <Section title="When to use it">
              <List items={entry.when} />
            </Section>
          )}
          {entry.requires && (
            <Section title="What it needs">
              <List items={entry.requires} />
            </Section>
          )}
          {entry.parameters && (
            <Section title="Parameters">
              <dl>
                {entry.parameters.map((p) => (
                  <div key={p.name}>
                    <dt>{p.name}</dt>
                    <dd>{p.text}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          {entry.limitations && (
            <Section title="Limitations">
              <List items={entry.limitations} />
            </Section>
          )}
          {entry.examples && (
            <Section title="Examples">
              <List items={entry.examples} />
            </Section>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={closeHelpTopic}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
