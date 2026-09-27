import {
  type FabricationLineType,
  type FlatPart,
  describeMaterial,
} from "@fabcad/fabrication-core";
import { DEFAULT_SVG_COLORS, pathData, renderSheetSvg } from "@fabcad/svg";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type FabricationTab, appState } from "../app/appState";
import { useStore } from "../app/tinyStore";
import "./fabrication.css";
import { formatNumber } from "./numberInput";
import {
  type PartInfo,
  type PlacedPartBox,
  JOINT_LABEL,
  describeParts,
  hitPartBox,
  partBounds,
  placedPartBoxes,
} from "./partView";
import { type FabricationOutput, usedSheets } from "./pipeline";
import { fabricationUiState, selectPart } from "./uiState";
import { type FabricationState, useFabrication } from "./useFabrication";

// ------------------------------------------------------------------------------------ tabs

const TABS: readonly { id: FabricationTab; label: string }[] = [
  { id: "model", label: "Model" },
  { id: "parts", label: "Parts" },
  { id: "sheet", label: "Sheet" },
];

/** The `[ Model ] [ Parts ] [ Sheet ]` switch of the FABRICATION workspace. */
export function FabricationTabs(): ReactNode {
  const tab = useStore(appState, (s) => s.fabricationTab);
  return (
    <div className="fab-tabs">
      <div className="workspace-tabs" role="tablist" aria-label="Fabrication view">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={t.id === tab ? "on" : undefined}
            onClick={() => appState.set({ fabricationTab: t.id })}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------- legend

const LINE_TYPES: readonly { type: FabricationLineType; label: string }[] = [
  { type: "cut", label: "Cut" },
  { type: "fold", label: "Fold" },
  { type: "engrave", label: "Engrave" },
];

function Legend({ output }: { output: FabricationOutput }): ReactNode {
  const used = useMemo(() => {
    const types = new Set<FabricationLineType>(["cut"]);
    for (const part of output.parts) for (const path of part.paths) types.add(path.type);
    return types;
  }, [output.parts]);
  return (
    <div className="legend" aria-label="Line types">
      {LINE_TYPES.filter((l) => used.has(l.type)).map((l) => (
        <span key={l.type}>
          <i
            style={{
              borderTopColor: DEFAULT_SVG_COLORS[l.type],
              borderTopStyle: l.type === "fold" ? "dashed" : "solid",
            }}
          />
          {l.label}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------------ parts view

const mm = (value: number): string => formatNumber(value, 2);

/**
 * Thumbnail of a part, drawn from its final `paths`. The part frame is Y-up and SVG is Y-down,
 * so the drawing is flipped with `scale(1, -1)`: the part is shown as seen from its outside
 * face, exactly as on the sheet, and is not mirrored.
 */
const PartThumb = memo(function PartThumb({ part }: { part: FlatPart }): ReactNode {
  const drawing = useMemo(() => {
    const b = partBounds(part);
    const width = b.maxX - b.minX;
    const height = b.maxY - b.minY;
    const pad = Math.max(width, height, 1) * 0.04;
    const order = (role: string): number => (role === "outline" ? 0 : 1);
    const paths = part.paths
      .filter((p) => p.points.length >= 2)
      .map((p, index) => ({ p, index }))
      .sort((a, b2) => order(a.p.role) - order(b2.p.role) || a.index - b2.index)
      .map(({ p, index }) => ({
        key: index,
        d: pathData(p),
        type: p.type,
        fill:
          p.type !== "cut" || !p.closed
            ? "none"
            : p.role === "outline"
              ? "#f3f6f9"
              : p.role === "hole" || p.role === "slot"
                ? "#ffffff"
                : "none",
      }));
    return {
      viewBox: `${b.minX - pad} ${-(b.maxY + pad)} ${width + 2 * pad} ${height + 2 * pad}`,
      paths,
    };
  }, [part]);
  return (
    <svg viewBox={drawing.viewBox} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Outline of ${part.name}`}>
      <g transform="scale(1,-1)" strokeLinejoin="round">
        {drawing.paths.map((path) => (
          <path
            key={path.key}
            d={path.d}
            fill={path.fill}
            stroke={DEFAULT_SVG_COLORS[path.type]}
            strokeWidth={1.1}
            strokeDasharray={path.type === "fold" ? "5 3" : undefined}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
    </svg>
  );
});

function activate(e: KeyboardEvent<HTMLElement>, action: () => void): void {
  if (e.target !== e.currentTarget) return;
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    action();
  }
}

interface PartCardProps {
  info: PartInfo;
  material: string;
  selected: boolean;
}

const PartCard = memo(function PartCard({ info, material, selected }: PartCardProps): ReactNode {
  const { part } = info;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const toggle = (): void => selectPart(selected ? null : part.id);
  return (
    <article
      ref={ref}
      className={`part-card${selected ? " selected" : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={toggle}
      onKeyDown={(e) => activate(e, toggle)}
    >
      <header>
        <span className="fab-part-name" title={part.id}>
          {part.name}
        </span>
        <span className="value-preview">{`${mm(info.width)} × ${mm(info.height)}`}</span>
      </header>
      <div className="thumb">
        <PartThumb part={part} />
      </div>
      <div className="meta">
        <dl className="kv" style={{ margin: 0 }}>
          <dt>Size</dt>
          <dd>{`${mm(info.width)} × ${mm(info.height)} mm`}</dd>
          <dt>Thickness</dt>
          <dd>{`${mm(part.thickness)} mm`}</dd>
          <dt>Material</dt>
          <dd title={material}>{material}</dd>
          <dt>Joints</dt>
          <dd>
            {info.joints.length === 0 ? (
              <span className="value-preview">none</span>
            ) : (
              info.joints.map((j) => (
                <span key={j} className="badge info" style={{ marginRight: 4 }}>
                  {JOINT_LABEL[j]}
                </span>
              ))
            )}
          </dd>
        </dl>
        {info.links.length > 0 ? (
          <>
            <div className="fab-links-title">{`Mating edges (${info.links.length})`}</div>
            <ul className="fab-links">
              {info.links.map((link) => (
                <li key={link.connectionId} title={link.text}>
                  {link.text}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </article>
  );
});

interface PartsTableProps {
  infos: PartInfo[];
  selectedPartId: string | null;
}

function PartsTable({ infos, selectedPartId }: PartsTableProps): ReactNode {
  return (
    <div className="fab-table-wrap">
      <table className="grid">
        <thead>
          <tr>
            <th>Part</th>
            <th className="num">Width</th>
            <th className="num">Height</th>
            <th className="num">Thickness</th>
            <th>Joints</th>
            <th className="num">Mating edges</th>
          </tr>
        </thead>
        <tbody>
          {infos.map((info) => {
            const selected = info.part.id === selectedPartId;
            const toggle = (): void => selectPart(selected ? null : info.part.id);
            return (
              <tr
                key={info.part.id}
                className={selected ? "selected" : undefined}
                tabIndex={0}
                aria-selected={selected}
                onClick={toggle}
                onKeyDown={(e) => activate(e, toggle)}
              >
                <td title={info.part.id}>{info.part.name}</td>
                <td className="num">{mm(info.width)}</td>
                <td className="num">{mm(info.height)}</td>
                <td className="num">{mm(info.part.thickness)}</td>
                <td>{info.joints.map((j) => JOINT_LABEL[j]).join(", ") || "–"}</td>
                <td className="num">{info.links.length}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PartsView({ output }: { output: FabricationOutput }): ReactNode {
  const { selectedPartId, partsMode } = useStore(fabricationUiState);
  const infos = useMemo(
    () => describeParts(output.parts, output.connections),
    [output.parts, output.connections],
  );
  const material = describeMaterial(output.material);
  return (
    <>
      <div className="fab-toolbar">
        <div className="fab-summary">
          <strong>{`${infos.length} part${infos.length === 1 ? "" : "s"}`}</strong>
          <span>{material}</span>
          <Legend output={output} />
        </div>
        <div className="segmented" role="radiogroup" aria-label="Parts layout">
          <button
            type="button"
            role="radio"
            aria-checked={partsMode === "cards"}
            className={partsMode === "cards" ? "on" : undefined}
            onClick={() => fabricationUiState.set({ partsMode: "cards" })}
          >
            Cards
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={partsMode === "table"}
            className={partsMode === "table" ? "on" : undefined}
            onClick={() => fabricationUiState.set({ partsMode: "table" })}
          >
            Table
          </button>
        </div>
      </div>
      {partsMode === "table" ? (
        <PartsTable infos={infos} selectedPartId={selectedPartId} />
      ) : (
        <div className="part-cards">
          {infos.map((info) => (
            <PartCard
              key={info.part.id}
              info={info}
              material={material}
              selected={info.part.id === selectedPartId}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------ sheet view

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;
/** Largest "fit" scale in px per mm, so that small sheets are not blown up. */
const MAX_FIT_SCALE = 4;

/** Width of an element, kept up to date. */
function useElementWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

interface SheetCardProps {
  output: FabricationOutput;
  sheet: number;
  /** Position among the used sheets, 1-based. */
  ordinal: number;
  total: number;
  scale: number;
  boxes: readonly PlacedPartBox[];
  selectedPartId: string | null;
}

const SheetCard = memo(function SheetCard({
  output,
  sheet,
  ordinal,
  total,
  scale,
  boxes,
  selectedPartId,
}: SheetCardProps): ReactNode {
  const { geometry } = output;
  const spec = geometry.sheet;
  // Exactly the string that "Export SVG" writes (with labels on); never modified afterwards.
  const svg = useMemo(
    () => ({ __html: renderSheetSvg(geometry, { sheet, labels: true }) }),
    [geometry, sheet],
  );
  const count = useMemo(() => boxes.filter((b) => b.sheet === sheet).length, [boxes, sheet]);
  const highlight = boxes.find((b) => b.sheet === sheet && b.partId === selectedPartId);

  const onClick = (e: MouseEvent<HTMLDivElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((e.clientX - rect.left) / rect.width) * spec.width;
    const y = ((e.clientY - rect.top) / rect.height) * spec.height;
    const hit = hitPartBox(boxes, sheet, x, y);
    selectPart(hit && hit.partId !== selectedPartId ? hit.partId : null);
  };

  return (
    <figure className="fab-sheet" style={{ margin: 0 }}>
      <figcaption className="sheet-caption">
        {`Sheet ${ordinal} of ${total} · ${mm(spec.width)} × ${mm(spec.height)} mm · ` +
          `${count} part${count === 1 ? "" : "s"}`}
      </figcaption>
      <div
        className="sheet-frame"
        style={{ width: spec.width * scale, height: spec.height * scale }}
        onClick={onClick}
      >
        {spec.margin > 0 ? (
          <div
            className="fab-sheet-margin"
            style={{
              left: spec.margin * scale,
              top: spec.margin * scale,
              right: spec.margin * scale,
              bottom: spec.margin * scale,
            }}
          />
        ) : null}
        {highlight ? (
          <div
            className="fab-sheet-highlight"
            style={{
              left: highlight.bounds.minX * scale,
              top: highlight.bounds.minY * scale,
              width: (highlight.bounds.maxX - highlight.bounds.minX) * scale,
              height: (highlight.bounds.maxY - highlight.bounds.minY) * scale,
            }}
          />
        ) : null}
        <div className="fab-sheet-svg" dangerouslySetInnerHTML={svg} />
      </div>
    </figure>
  );
});

function SheetView({ output }: { output: FabricationOutput }): ReactNode {
  const { selectedPartId, sheetZoom } = useStore(fabricationUiState);
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const sheets = useMemo(() => usedSheets(output), [output]);
  const boxes = useMemo(() => placedPartBoxes(output.geometry), [output.geometry]);
  const names = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of output.parts) map.set(p.id, p.name);
    return map;
  }, [output.parts]);

  const spec = output.geometry.sheet;
  // 2 px for the border of the sheet frame.
  const fit = Math.min(MAX_FIT_SCALE, Math.max(0.05, ((width > 0 ? width : 800) - 2) / spec.width));
  const scale = fit * sheetZoom;
  const zoom = (factor: number): void =>
    fabricationUiState.set((s) => ({
      sheetZoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s.sheetZoom * factor)),
    }));

  return (
    <>
      <div className="fab-toolbar">
        <div className="fab-summary">
          <strong>{`${sheets.length} sheet${sheets.length === 1 ? "" : "s"}`}</strong>
          <span>{`${output.layout.placements.length} of ${output.parts.length} parts placed`}</span>
          <Legend output={output} />
        </div>
        <div className="fab-zoom">
          <button type="button" className="icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(1 / 1.25)}>
            −
          </button>
          <span className="value-preview" aria-live="polite">{`${Math.round(sheetZoom * 100)}%`}</span>
          <button type="button" className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoom(1.25)}>
            +
          </button>
          <button
            type="button"
            className="btn small"
            disabled={sheetZoom === 1}
            onClick={() => fabricationUiState.set({ sheetZoom: 1 })}
          >
            Fit
          </button>
        </div>
      </div>
      <div className="sheet-wrap fab-sheets" ref={ref}>
        {output.layout.unplaced.length > 0 ? (
          <div className="fab-unplaced" role="alert">
            <strong>{`${output.layout.unplaced.length} part(s) do not fit on the sheet:`}</strong>
            <ul>
              {output.layout.unplaced.map((id) => (
                <li key={id}>
                  <button type="button" onClick={() => selectPart(id)}>
                    {names.get(id) ?? id}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {sheets.map((sheet, i) => (
          <SheetCard
            key={sheet}
            output={output}
            sheet={sheet}
            ordinal={i + 1}
            total={sheets.length}
            scale={scale}
            boxes={boxes}
            selectedPartId={selectedPartId}
          />
        ))}
        {sheets.length === 0 ? (
          <div className="fab-empty">
            <h3>Nothing on the sheet</h3>
            <p>No part could be placed. Check the sheet size and the warnings.</p>
          </div>
        ) : null}
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------ main

function EmptyState({ state }: { state: FabricationState }): ReactNode {
  if (state.status === "error") {
    return (
      <div className="fab-empty error" role="alert">
        <h3>Fabrication failed</h3>
        <p>{state.error ?? "Unknown error."}</p>
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="fab-empty" role="status">
        <div className="spinner" />
        <p>Reading the geometry of the bodies…</p>
      </div>
    );
  }
  if (state.bodies.length === 0) {
    return (
      <div className="fab-empty">
        <h3>No bodies</h3>
        <p>Design a body in the DESIGN workspace first.</p>
      </div>
    );
  }
  if (!state.bodies.some((b) => b.included)) {
    return (
      <div className="fab-empty">
        <h3>No body selected</h3>
        <p>Tick at least one body in the Bodies panel.</p>
      </div>
    );
  }
  const errors = state.output?.warnings.filter((w) => w.severity === "error") ?? [];
  return (
    <div className="fab-empty">
      <h3>No parts</h3>
      <p>{errors[0]?.message ?? "The selected bodies did not produce any flat parts."}</p>
    </div>
  );
}

/** Main area of the FABRICATION workspace for the tabs Parts and Sheet. */
export function FabricationMain(): ReactNode {
  const tab = useStore(appState, (s) => s.fabricationTab);
  if (tab === "model") return null;
  return <FabricationViews tab={tab} />;
}

function FabricationViews({ tab }: { tab: Exclude<FabricationTab, "model"> }): ReactNode {
  const state = useFabrication();
  const { output } = state;

  // Drop a selection that points at a part which no longer exists.
  const selectedPartId = useStore(fabricationUiState, (s) => s.selectedPartId);
  useEffect(() => {
    if (selectedPartId === null || !output || state.stale) return;
    if (!output.parts.some((p) => p.id === selectedPartId)) selectPart(null);
  }, [output, selectedPartId, state.stale]);

  const showOutput = output !== null && output.parts.length > 0 && state.status === "ready";
  return (
    <div className="fab-view padded">
      {!showOutput || !output ? (
        <EmptyState state={state} />
      ) : tab === "parts" ? (
        <PartsView output={output} />
      ) : (
        <SheetView output={output} />
      )}
    </div>
  );
}
