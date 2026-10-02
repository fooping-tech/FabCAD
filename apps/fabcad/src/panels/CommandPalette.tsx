import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { appState } from "../app/appState";
import { searchCommands } from "../app/commandSearch";
import { type PaletteHooks, paletteCommands } from "../app/paletteCommands";
import { useStore } from "../app/tinyStore";
import { Popover } from "../ui/Popover";

const WIDTH = 460;

/** Runs the highlighted command; set while the palette is open (Enter before it has focus). */
let runSelection: (() => void) | null = null;
export function runPaletteSelection(): void {
  runSelection?.();
}

/** Where the palette goes: centred near the top of the window. */
const anchor = (): DOMRect => new DOMRect(Math.max(8, (window.innerWidth - WIDTH) / 2), 64, WIDTH, 0);

/**
 * Ctrl / Cmd + K: run any command by typing its name. Arrow keys choose, Enter runs, Esc
 * closes. Only the commands that make sense in the current state are listed.
 */
export function CommandPalette(hooks: PaletteHooks): ReactElement | null {
  const open = useStore(appState, (s) => s.commandPalette !== null);
  if (!open) return null;
  return <PaletteBody {...hooks} />;
}

function PaletteBody(hooks: PaletteHooks): ReactElement {
  const query = useStore(appState, (s) => s.commandPalette?.query ?? "");
  const setQuery = (q: string): void => appState.set({ commandPalette: { query: q } });
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Taken when the palette opens: the state it was opened in decides what can be run.
  const commands = useMemo(() => paletteCommands(hooks), []); // eslint-disable-line react-hooks/exhaustive-deps
  const found = searchCommands(commands, query);
  const close = (): void => appState.set({ commandPalette: null });
  const run = (index: number): void => {
    const c = found[index];
    if (!c) return;
    close();
    c.run();
  };

  runSelection = () => run(active);
  useEffect(() => () => {
    runSelection = null;
  }, []);
  // The popover is hidden until it has been placed; focus once it can be.
  useEffect(() => {
    let frame = 0;
    const tryFocus = (): void => {
      const el = input.current;
      if (el && getComputedStyle(el).visibility !== "hidden" && document.activeElement !== el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
      if (document.activeElement !== el) frame = requestAnimationFrame(tryFocus);
    };
    tryFocus();
    return () => cancelAnimationFrame(frame);
  }, []);
  // Typing before the focus arrived changes the query: start from the first match again.
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <>
      <div className="palette-backdrop" onPointerDown={close} />
      <Popover anchor={anchor} className="command-palette" role="dialog" label="Command palette" placement={{ align: "left", gap: 0 }}>
        <input
          ref={input}
          className="palette-input"
          value={query}
          placeholder="Type a command…"
          aria-label="Command"
          aria-controls="palette-list"
          aria-activedescendant={found[active] ? `palette-${found[active].id}` : undefined}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(found.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(active);
            } else if (e.key === "Escape") {
              e.preventDefault();
              close();
            }
          }}
        />
        <ul ref={list} id="palette-list" className="palette-list" role="listbox" aria-label="Commands">
          {found.length === 0 && <li className="palette-empty">No command matches.</li>}
          {found.map((c, i) => (
            <li
              key={c.id}
              id={`palette-${c.id}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={i === active ? "on" : ""}
              onPointerMove={() => setActive(i)}
              onClick={() => run(i)}
            >
              <span className="palette-name">{c.label}</span>
              {c.shortcut && <kbd>{c.shortcut}</kbd>}
              <span className="palette-group">{c.group}</span>
              {c.detail && <span className="palette-detail">{c.detail}</span>}
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
}
