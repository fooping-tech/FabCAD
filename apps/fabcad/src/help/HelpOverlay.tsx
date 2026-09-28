import { type ReactElement, type ReactNode, useEffect } from "react";
import { appState } from "../app/appState";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";
import { fallbackJa, helpFor, helpJaFor } from "./content";
import { closeHelpTopic } from "./helpState";

function Section({
  title,
  titleJa,
  children,
}: {
  title: string;
  titleJa: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="help-section">
      <h3>
        {title}
        <span lang="ja"> · {titleJa}</span>
      </h3>
      {children}
    </section>
  );
}

/** A text in English with its Japanese below it. */
function Both({ en, ja }: { en: string; ja: string | undefined }): ReactElement {
  return (
    <>
      <span className="help-en">{en}</span>
      {ja !== undefined && (
        <span className="help-ja" lang="ja">
          {ja}
        </span>
      )}
    </>
  );
}

const List = ({ items, ja }: { items: string[]; ja: string[] | undefined }): ReactElement => (
  <ul>
    {items.map((text, i) => (
      <li key={i}>
        <Both en={text} ja={ja?.[i]} />
      </li>
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
  // Without a Japanese entry there is no English entry either: the fallback says so in both.
  const ja = helpJaFor(topic.id);
  const whatJa = ja?.what ?? entry.what.map((_t, i) => (i === entry.what.length - 1 ? fallbackJa() : undefined));
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
          <p className="help-summary">
            <Both en={entry.summary} ja={ja?.summary} />
          </p>
          <Section title="What it does" titleJa="できること">
            {entry.what.map((text, i) => (
              <p key={i}>
                <Both en={text} ja={whatJa[i]} />
              </p>
            ))}
          </Section>
          {entry.when && (
            <Section title="When to use it" titleJa="使う場面">
              <List items={entry.when} ja={ja?.when} />
            </Section>
          )}
          {entry.requires && (
            <Section title="What it needs" titleJa="必要なもの">
              <List items={entry.requires} ja={ja?.requires} />
            </Section>
          )}
          {entry.parameters && (
            <Section title="Parameters" titleJa="パラメータ">
              <dl>
                {entry.parameters.map((p, i) => (
                  <div key={p.name}>
                    <dt>{p.name}</dt>
                    <dd>
                      <Both en={p.text} ja={ja?.parameters?.[i]?.text} />
                    </dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          {entry.limitations && (
            <Section title="Limitations" titleJa="制限">
              <List items={entry.limitations} ja={ja?.limitations} />
            </Section>
          )}
          {entry.examples && (
            <Section title="Examples" titleJa="使用例">
              <List items={entry.examples} ja={ja?.examples} />
            </Section>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn primary" onClick={closeHelpTopic}>
            Close · 閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
