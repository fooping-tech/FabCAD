import type { FabricationWarning, NestingAlgorithm, SheetSpec } from "@fabcad/fabrication-core";
import { type ReactNode, useMemo } from "react";
import { useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { MaterialSection } from "./MaterialSection";
import { StrategySection } from "./StrategySection";
import { exportSheets } from "./export";
import "./fabrication.css";
import { CheckField, NumberField, Section, SegmentedField } from "./fields";
import { formatNumber } from "./numberInput";
import {
  type BodyDetection,
  type FabricationOutput,
  fabricationRegistry,
  fabricationStats,
} from "./pipeline";
import {
  type BodyChoice,
  type LaserFabricationSettings,
  currentMaterial,
  toggleBody,
  updateFabricationSettings,
} from "./settings";
import { fabricationUiState, revealPart } from "./uiState";
import { type FabricationState, useFabrication } from "./useFabrication";

// ---------------------------------------------------------------------------------- bodies

interface BodiesSectionProps {
  bodies: BodyChoice[];
  explicit: boolean;
}

function BodiesSection({ bodies, explicit }: BodiesSectionProps): ReactNode {
  const included = bodies.filter((b) => b.included).length;
  return (
    <Section title="Bodies" badge={<span className="badge">{`${included} / ${bodies.length}`}</span>}>
      {bodies.length === 0 ? (
        <div className="empty">Design a body in the DESIGN workspace first.</div>
      ) : (
        <div className="form">
          {bodies.map((b) => (
            <CheckField
              key={b.id}
              label={b.name}
              checked={b.included}
              note={b.visible ? undefined : "hidden"}
              onChange={(checked) =>
                updateFabricationSettings(
                  { bodyIds: toggleBody(bodies, b.id, checked) },
                  "Change fabricated bodies",
                )
              }
            />
          ))}
          {explicit ? (
            <div className="fab-row spread">
              <span className="fab-note">Custom selection</span>
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  updateFabricationSettings({ bodyIds: null }, "Change fabricated bodies")
                }
              >
                All visible
              </button>
            </div>
          ) : (
            <div className="fab-note">All visible bodies are fabricated.</div>
          )}
        </div>
      )}
    </Section>
  );
}

// ----------------------------------------------------------------------------------- sheet

const SIZE_RULE = { min: 0, exclusiveMin: true, max: 10000 } as const;

function setSheet(patch: Partial<SheetSpec>): void {
  updateFabricationSettings((s) => ({ sheet: { ...s.sheet, ...patch } }), "Change sheet settings");
}

function SheetSection({ settings }: { settings: LaserFabricationSettings }): ReactNode {
  const { sheet } = settings;
  // The margin must leave a usable area.
  const maxMargin = Math.max(0, Math.floor((Math.min(sheet.width, sheet.height) / 2 - 0.5) * 10) / 10);
  const minSize = sheet.margin * 2;
  return (
    <Section
      title="Sheet"
      badge={<span className="badge">{`${formatNumber(sheet.width, 1)} × ${formatNumber(sheet.height, 1)}`}</span>}
    >
      <div className="form">
        <NumberField
          label="Width"
          unit="mm"
          value={sheet.width}
          rule={{ ...SIZE_RULE, min: minSize }}
          onCommit={(v) => {
            if (v !== undefined) setSheet({ width: v });
          }}
        />
        <NumberField
          label="Height"
          unit="mm"
          value={sheet.height}
          rule={{ ...SIZE_RULE, min: minSize }}
          onCommit={(v) => {
            if (v !== undefined) setSheet({ height: v });
          }}
        />
        <NumberField
          label="Margin"
          unit="mm"
          value={sheet.margin}
          rule={{ min: 0, max: maxMargin }}
          hint="Clear border of the sheet"
          onCommit={(v) => {
            if (v !== undefined) setSheet({ margin: v });
          }}
        />
        <NumberField
          label="Gap"
          unit="mm"
          value={sheet.gap}
          rule={{ min: 0, max: 1000 }}
          hint="Between parts"
          onCommit={(v) => {
            if (v !== undefined) setSheet({ gap: v });
          }}
        />
        <SegmentedField<NestingAlgorithm>
          label="Nesting"
          value={settings.nesting}
          options={[
            { value: "row", label: "Row", title: "Parts in document order, row by row" },
            { value: "shelf", label: "Shelf", title: "Parts sorted by height on shelves" },
          ]}
          onChange={(nesting) => updateFabricationSettings({ nesting }, "Change nesting")}
        />
        <CheckField
          label="Allow rotation (90°)"
          checked={settings.allowRotation}
          onChange={(allowRotation) =>
            updateFabricationSettings({ allowRotation }, "Change nesting")
          }
        />
      </div>
    </Section>
  );
}

// -------------------------------------------------------------------------------- analysis

function WarningIcon({ severity }: { severity: FabricationWarning["severity"] }): ReactNode {
  if (severity === "error") {
    return (
      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" />
        <path d="M5 5l4 4M9 5l-4 4" strokeLinecap="round" />
      </svg>
    );
  }
  if (severity === "info") {
    return (
      <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
        <circle cx="7" cy="7" r="5.5" />
        <path d="M7 6.5v3.5M7 4.2v.3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <path d="M7 1.8 12.6 12H1.4L7 1.8Z" strokeLinejoin="round" />
      <path d="M7 5.8v3M7 10.3v.3" strokeLinecap="round" />
    </svg>
  );
}

const SEVERITY_ORDER: Record<FabricationWarning["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
};
const SEVERITY_CLASS: Record<FabricationWarning["severity"], string> = {
  error: " error",
  warning: "",
  info: " info",
};
const MAX_WARNINGS = 60;

interface WarningListProps {
  warnings: FabricationWarning[];
  selectedPartId: string | null;
}

function WarningList({ warnings, selectedPartId }: WarningListProps): ReactNode {
  const sorted = useMemo(
    () =>
      warnings
        .map((w, i) => ({ w, i }))
        .sort((a, b) => SEVERITY_ORDER[a.w.severity] - SEVERITY_ORDER[b.w.severity] || a.i - b.i),
    [warnings],
  );
  if (sorted.length === 0) return <div className="fab-note">No warnings.</div>;
  return (
    <div className="warning-list">
      {sorted.slice(0, MAX_WARNINGS).map(({ w, i }) => {
        const className = `warning-item${SEVERITY_CLASS[w.severity]}${
          w.partId !== undefined && w.partId === selectedPartId ? " selected" : ""
        }`;
        const partId = w.partId;
        return partId !== undefined ? (
          <button
            key={i}
            type="button"
            className={className}
            title="Show the part"
            onClick={() => revealPart(partId)}
          >
            <WarningIcon severity={w.severity} />
            <span>{w.message}</span>
          </button>
        ) : (
          <div key={i} className={className}>
            <WarningIcon severity={w.severity} />
            <span>{w.message}</span>
          </div>
        );
      })}
      {sorted.length > MAX_WARNINGS ? (
        <div className="fab-warning-more">{sorted.length - MAX_WARNINGS} more not shown.</div>
      ) : null}
    </div>
  );
}

/** What was detected in every body: the user never has to guess how a body was interpreted. */
function DetectionList({ detections }: { detections: BodyDetection[] }): ReactNode {
  if (detections.length === 0) return null;
  const single = detections.length === 1;
  return (
    <div className="fab-detections">
      {detections.map((d) => (
        <div key={d.bodyId} className={`fab-detection${d.supported ? "" : " unsupported"}`}>
          {single ? null : <div className="fab-detection-body">{d.bodyName}</div>}
          <div className="fab-detection-kind">
            {d.supported ? `Detected: ${d.label}` : d.label}
          </div>
          {!d.supported && d.reason ? (
            <div className="fab-detection-reason">{`Reason: ${d.reason}`}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AnalysisSection({ state }: { state: FabricationState }): ReactNode {
  const { output, status } = state;
  const selectedPartId = useStore(fabricationUiState, (s) => s.selectedPartId);
  const stats = useMemo(() => (output ? fabricationStats(output) : null), [output]);
  const badge = !stats ? undefined : stats.errors > 0 ? (
    <span className="badge danger">{`${stats.errors} error${stats.errors === 1 ? "" : "s"}`}</span>
  ) : stats.warnings > 0 ? (
    <span className="badge warn">{`${stats.warnings} warning${stats.warnings === 1 ? "" : "s"}`}</span>
  ) : stats.parts > 0 ? (
    <span className="badge ok">OK</span>
  ) : undefined;
  return (
    <Section title="Analysis" badge={badge}>
      {status === "error" ? (
        <div className="warning-list" style={{ marginBottom: 6 }}>
          <div className="warning-item error">
            <WarningIcon severity="error" />
            <span>{state.error ?? "Fabrication failed."}</span>
          </div>
        </div>
      ) : null}
      {output && stats ? (
        <>
          <DetectionList detections={output.detections} />
          <dl className="kv" style={{ margin: "0 0 8px" }}>
            <dt>Parts</dt>
            <dd>{stats.parts}</dd>
            <dt>Connections</dt>
            <dd>{stats.connections}</dd>
            <dt>Sheets</dt>
            <dd>
              {stats.sheets}
              {stats.unplaced > 0 ? ` (${stats.unplaced} part${stats.unplaced === 1 ? "" : "s"} unplaced)` : ""}
            </dd>
            <dt>Cut length</dt>
            <dd>{`${formatNumber(stats.cutLength, 0)} mm`}</dd>
            {stats.foldLength > 0 ? (
              <>
                <dt>Fold length</dt>
                <dd>{`${formatNumber(stats.foldLength, 0)} mm`}</dd>
              </>
            ) : null}
          </dl>
          {state.stale ? <div className="fab-note">Updating…</div> : null}
          <WarningList warnings={output.warnings} selectedPartId={selectedPartId} />
        </>
      ) : status === "loading" ? (
        <div className="fab-note">Reading the geometry…</div>
      ) : status === "idle" ? (
        <div className="fab-note">No bodies to analyse.</div>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------------- export

interface ExportSectionProps {
  output: FabricationOutput | null;
  settings: LaserFabricationSettings;
  stale: boolean;
}

function ExportSection({ output, settings, stale }: ExportSectionProps): ReactNode {
  const docName = useDocument().name;
  const placed = output ? output.layout.placements.length : 0;
  const disabled = !output || placed === 0 || stale;
  return (
    <Section title="Export">
      <div className="form">
        <CheckField
          label="Include labels"
          checked={settings.exportLabels}
          note="SVG"
          onChange={(exportLabels) =>
            updateFabricationSettings({ exportLabels }, "Change export settings")
          }
        />
        <div className="fab-row">
          <button
            type="button"
            className="btn primary"
            disabled={disabled}
            onClick={() => {
              if (output) exportSheets("svg", output, docName, settings.exportLabels);
            }}
          >
            Export SVG
          </button>
          <button
            type="button"
            className="btn"
            disabled={disabled}
            onClick={() => {
              if (output) exportSheets("dxf", output, docName, settings.exportLabels);
            }}
          >
            Export DXF
          </button>
        </div>
        <div className="fab-note">
          {output && output.layout.sheetCount > 1 && placed > 0
            ? "One file per sheet. Units: mm. Cut red, fold blue, engrave black."
            : "Units: mm. Cut red, fold blue, engrave black."}
        </div>
      </div>
    </Section>
  );
}

// ----------------------------------------------------------------------------------- panel

/** Content of the left side panel in the FABRICATION workspace. */
export function FabricationSidePanel(): ReactNode {
  const state = useFabrication();
  const { settings, output } = state;
  const material = currentMaterial(settings);
  const strategyName = useMemo(() => {
    const strategy = fabricationRegistry().forMaterial(material, "laser")[0];
    return strategy?.name ?? "";
  }, [material]);

  return (
    <div className="fab-side">
      <BodiesSection bodies={state.bodies} explicit={settings.bodyIds !== null} />
      <MaterialSection settings={settings} />
      <StrategySection settings={settings} material={material} strategyName={strategyName} />
      <SheetSection settings={settings} />
      <AnalysisSection state={state} />
      <ExportSection output={output} settings={settings} stale={state.stale} />
    </div>
  );
}
