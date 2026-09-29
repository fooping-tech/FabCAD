import type { MaterialProfile } from "@fabcad/fabrication-core";
import type { ReactNode } from "react";
import { CheckField, NumberField, Section, SegmentedField } from "./fields";
import {
  type BoardOverrides,
  type LaserFabricationSettings,
  type PaperOverrides,
  MAX_GLUE_TAB_ANGLE,
  resolveBoardSettings,
  resolvePaperSettings,
  updateFabricationSettings,
} from "./settings";

const LABEL = "Change strategy settings";

/** Set or clear (value `undefined` = back to the default) one board override. */
function setBoard<K extends keyof BoardOverrides>(key: K, value: BoardOverrides[K]): void {
  updateFabricationSettings((s) => {
    const board: BoardOverrides = { ...s.board };
    if (value === undefined) delete board[key];
    else board[key] = value;
    return { board };
  }, LABEL);
}

function setPaper<K extends "joint" | "foldCurvedFacets" | "kerfCompensation">(
  key: K,
  value: PaperOverrides[K],
): void {
  updateFabricationSettings((s) => {
    const paper: PaperOverrides = { ...s.paper };
    if (value === undefined) delete paper[key];
    else paper[key] = value;
    return { paper };
  }, LABEL);
}

type GlueTabs = NonNullable<PaperOverrides["glueTabs"]>;

function setGlueTab<K extends keyof GlueTabs>(key: K, value: GlueTabs[K]): void {
  updateFabricationSettings((s) => {
    const glueTabs: GlueTabs = { ...(s.paper.glueTabs ?? {}) };
    if (value === undefined) delete glueTabs[key];
    else glueTabs[key] = value;
    return { paper: { ...s.paper, glueTabs } };
  }, LABEL);
}

type InsertTabs = NonNullable<PaperOverrides["insertTabs"]>;

function setInsertTab<K extends keyof InsertTabs>(key: K, value: InsertTabs[K]): void {
  updateFabricationSettings((s) => {
    const insertTabs: InsertTabs = { ...(s.paper.insertTabs ?? {}) };
    if (value === undefined) delete insertTabs[key];
    else insertTabs[key] = value;
    return { paper: { ...s.paper, insertTabs } };
  }, LABEL);
}

const POSITIVE = { min: 0, exclusiveMin: true, max: 1000, allowEmpty: true } as const;
const NON_NEGATIVE = { min: 0, max: 1000, allowEmpty: true } as const;
const ANGLE = { min: 0, max: MAX_GLUE_TAB_ANGLE, allowEmpty: true } as const;

interface BoardFormProps {
  material: MaterialProfile;
  overrides: BoardOverrides;
}

function BoardForm({ material, overrides }: BoardFormProps): ReactNode {
  const defaults = resolveBoardSettings(material, {});
  const resolved = resolveBoardSettings(material, overrides);
  const usesTabs = resolved.capJoint === "tab-slot";
  const usesFingers = resolved.capJoint === "finger" || resolved.sideJoint === "finger";
  return (
    <div className="form">
      <div className="form-section">Joints</div>
      <SegmentedField
        label="Cap joint"
        value={resolved.capJoint}
        options={[
          { value: "tab-slot", label: "Tab & Slot", title: "Tabs of the side panels go through slots in the cap" },
          { value: "finger", label: "Finger", title: "Interlocking fingers along the edge" },
          { value: "flat", label: "Flat", title: "Butt joint, glued" },
        ]}
        onChange={(v) => setBoard("capJoint", v)}
      />
      <SegmentedField
        label="Side joint"
        value={resolved.sideJoint}
        options={[
          { value: "flat", label: "Flat / Glue", title: "Butt joint, glued" },
          { value: "finger", label: "Finger", title: "Interlocking fingers along the edge" },
        ]}
        onChange={(v) => setBoard("sideJoint", v)}
      />
      <div className="form-section">Dimensions</div>
      <NumberField
        label="Slot margin"
        unit="mm"
        value={overrides.slotEdgeMargin}
        defaultValue={defaults.slotEdgeMargin}
        rule={NON_NEGATIVE}
        hint={usesTabs ? "Slot to panel edge, 0 = open notch" : "Used by Tab & Slot"}
        onCommit={(v) => setBoard("slotEdgeMargin", v)}
      />
      <NumberField
        label="Tab width"
        unit="mm"
        value={overrides.tabWidth}
        defaultValue={defaults.tabWidth}
        rule={POSITIVE}
        hint={usesTabs ? undefined : "Used by Tab & Slot"}
        onCommit={(v) => setBoard("tabWidth", v)}
      />
      <NumberField
        label="Tab spacing"
        unit="mm"
        value={overrides.tabSpacing}
        defaultValue={defaults.tabSpacing}
        rule={POSITIVE}
        hint={usesTabs ? undefined : "Used by Tab & Slot"}
        onCommit={(v) => setBoard("tabSpacing", v)}
      />
      <NumberField
        label="Finger width"
        unit="mm"
        value={overrides.fingerWidth}
        defaultValue={defaults.fingerWidth}
        rule={POSITIVE}
        hint={usesFingers ? undefined : "Used by Finger joints"}
        onCommit={(v) => setBoard("fingerWidth", v)}
      />
      <CheckField
        label="Kerf compensation"
        checked={resolved.kerfCompensation}
        note={`${material.kerf} mm`}
        onChange={(v) => setBoard("kerfCompensation", v)}
      />
      <div className="fab-note">Empty fields use the default for {material.thickness} mm material.</div>
    </div>
  );
}

interface PaperFormProps {
  material: MaterialProfile;
  overrides: PaperOverrides;
}

function PaperForm({ material, overrides }: PaperFormProps): ReactNode {
  const defaults = resolvePaperSettings(material, {});
  const resolved = resolvePaperSettings(material, overrides);
  const tabs = overrides.glueTabs ?? {};
  const enabled = resolved.glueTabs.enabled;
  const inserting = resolved.joint === "insert";
  const insert = overrides.insertTabs ?? {};
  return (
    <div className="form">
      <div className="form-section">Joints</div>
      <SegmentedField
        label="Joint"
        value={resolved.joint}
        options={[
          { value: "glue", label: "Glue", title: "Glue tabs: one side is glued behind the other" },
          {
            value: "insert",
            label: "Tab & Slit",
            title: "Tabs are pushed through slits in the fold of a flap. No glue; tabs and flaps end up inside.",
          },
        ]}
        onChange={(v) => setPaper("joint", v)}
      />
      {inserting ? (
        <>
          <div className="form-section">Insert tabs</div>
          <NumberField
            label="Tab width"
            unit="mm"
            value={insert.width}
            defaultValue={defaults.insertTabs.width}
            rule={POSITIVE}
            hint="Along the edge, where the tab passes the slit"
            onCommit={(v) => setInsertTab("width", v)}
          />
          <NumberField
            label="Tab depth"
            unit="mm"
            value={insert.depth}
            defaultValue={defaults.insertTabs.depth}
            rule={POSITIVE}
            hint="Length of the tongue behind the slit"
            onCommit={(v) => setInsertTab("depth", v)}
          />
          <NumberField
            label="Tab spacing"
            unit="mm"
            value={insert.spacing}
            defaultValue={defaults.insertTabs.spacing}
            rule={POSITIVE}
            hint="Smallest gap between tabs; long edges get several"
            onCommit={(v) => setInsertTab("spacing", v)}
          />
          <NumberField
            label="Flap"
            unit="mm"
            value={insert.flap}
            defaultValue={defaults.insertTabs.flap}
            rule={POSITIVE}
            hint="Height of the flap with the slits; it lies inside, behind the other face"
            onCommit={(v) => setInsertTab("flap", v)}
          />
          <NumberField
            label="Neck"
            unit="mm"
            value={insert.neck}
            defaultValue={defaults.insertTabs.neck}
            rule={POSITIVE}
            hint="Length of the tab before its shoulders: what passes the slit"
            onCommit={(v) => setInsertTab("neck", v)}
          />
          <NumberField
            label="Lock"
            unit="mm"
            value={insert.lock}
            defaultValue={defaults.insertTabs.lock}
            rule={NON_NEGATIVE}
            hint="How far the tab is wider than the slit on each side, 0 = none"
            onCommit={(v) => setInsertTab("lock", v)}
          />
          <NumberField
            label="Clearance"
            unit="mm"
            value={insert.clearance}
            defaultValue={defaults.insertTabs.clearance}
            rule={NON_NEGATIVE}
            hint="How much longer the slit is than the tab is wide"
            onCommit={(v) => setInsertTab("clearance", v)}
          />
        </>
      ) : null}
      <div className="form-section">{inserting ? "Glue tabs (edges too short for a tab)" : "Glue tabs"}</div>
      <CheckField
        label="Glue tabs on cut edges"
        checked={enabled}
        onChange={(v) => setGlueTab("enabled", v)}
      />
      <NumberField
        label="Tab width"
        unit="mm"
        value={tabs.width}
        defaultValue={defaults.glueTabs.width}
        rule={POSITIVE}
        disabled={!enabled}
        onCommit={(v) => setGlueTab("width", v)}
      />
      <NumberField
        label="Tab angle"
        unit="°"
        value={tabs.angle}
        defaultValue={defaults.glueTabs.angle}
        rule={ANGLE}
        hint="Taper of the tab sides, 0 = rectangular"
        disabled={!enabled}
        onCommit={(v) => setGlueTab("angle", v)}
      />
      <NumberField
        label="Tab inset"
        unit="mm"
        value={tabs.inset}
        defaultValue={defaults.glueTabs.inset}
        rule={NON_NEGATIVE}
        disabled={!enabled}
        onCommit={(v) => setGlueTab("inset", v)}
      />
      <div className="form-section">Unfolding</div>
      <CheckField
        label="Unfold curved facets"
        checked={resolved.foldCurvedFacets}
        onChange={(v) => setPaper("foldCurvedFacets", v)}
      />
      <CheckField
        label="Kerf compensation"
        checked={resolved.kerfCompensation}
        note={`${material.kerf} mm`}
        onChange={(v) => setPaper("kerfCompensation", v)}
      />
    </div>
  );
}

interface StrategySectionProps {
  settings: LaserFabricationSettings;
  material: MaterialProfile;
  strategyName: string;
}

export function StrategySection({ settings, material, strategyName }: StrategySectionProps): ReactNode {
  return (
    <Section
      title="Strategy"
      badge={strategyName ? <span className="badge info">{strategyName}</span> : undefined}
    >
      {material.category === "paper" ? (
        <PaperForm material={material} overrides={settings.paper} />
      ) : (
        <BoardForm material={material} overrides={settings.board} />
      )}
    </Section>
  );
}
