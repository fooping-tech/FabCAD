import type {
  CadDocument,
  LoftSection,
  OriginAxisName,
  PatternAxis,
  PlaneReference,
  Point3Ref,
} from "@fabcad/cad-document";
import type { OriginPlaneName } from "@fabcad/geometry";
import type { ReactElement } from "react";
import { commitDialog, patchDialog } from "../app/actions";
import type {
  AlignDialog,
  HoleDialog,
  LoftDialog,
  MoveDialog,
  OffsetPlaneDialog,
  SolidDialog,
  SourcePick,
  SplitDialog,
  SweepDialog,
} from "../app/appState";
import { useDocument } from "../app/session";
import { nextPicking } from "../app/solidDialogs";
import { Icon } from "../ui/Icon";
import { Field, OperationFields, PickBox } from "./dialogFields";
import { ExpressionInput } from "./ExpressionInput";

/**
 * Fields of the dialogs of Hole, the patterns, Mirror, Move/Copy, Align, Split, Sweep, Loft
 * and Offset Plane.
 */

const featureName = (doc: CadDocument, id: string | null): string =>
  (id ? doc.features[id]?.name : undefined) ?? "Missing sketch";

const bodyName = (doc: CadDocument, id: string | null): string =>
  (id ? doc.bodies[id]?.name : undefined) ?? "Missing body";

const listed = (names: string[]): string =>
  names.length <= 2 ? names.join(", ") : `${names.length} selected`;

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(([id, text]) => (
        <button
          key={id}
          role="radio"
          aria-checked={value === id}
          className={value === id ? "on" : ""}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Like `Segmented`, for choices whose names do not fit side by side. */
function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}): ReactElement {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => {
        const picked = options.find(([id]) => id === e.target.value);
        if (picked) onChange(picked[0]);
      }}
    >
      {options.map(([id, text]) => (
        <option key={id} value={id}>
          {text}
        </option>
      ))}
    </select>
  );
}

function Check({
  label,
  checked,
  onChange,
  secondary,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  secondary?: boolean;
}): ReactElement {
  return (
    <Field label={label} secondary={secondary}>
      <div style={{ paddingTop: 6 }}>
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
      </div>
    </Field>
  );
}

function Value({
  label,
  kind,
  value,
  onChange,
  autoFocus,
  secondary,
}: {
  label: string;
  kind: "length" | "angle" | "none";
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  secondary?: boolean;
}): ReactElement {
  return (
    <Field label={label} secondary={secondary}>
      <ExpressionInput
        label={label}
        kind={kind}
        live
        autoFocus={autoFocus}
        value={value}
        onChange={onChange}
        onEnter={commitDialog}
      />
    </Field>
  );
}

// ---------------------------------------------------------------- shared picks

/** What a pattern or a mirror repeats: features or bodies, and which. */
function SourceFields({
  dialog,
}: {
  dialog: Extract<SolidDialog, SourcePick>;
}): ReactElement {
  const doc = useDocument();
  const bodies = dialog.sourceKind === "bodies";
  const ids = bodies ? dialog.bodyIds : dialog.featureIds;
  const names = ids.map((id) => (bodies ? bodyName(doc, id) : (doc.features[id]?.name ?? "?")));
  return (
    <>
      <Field label="Repeat">
        <Segmented
          label="What to repeat"
          value={dialog.sourceKind}
          options={[
            ["features", "Features"],
            ["bodies", "Bodies"],
          ]}
          onChange={(sourceKind) => patchDialog({ sourceKind, picking: "source" })}
        />
      </Field>
      <Field label={bodies ? "Bodies" : "Features"}>
        <PickBox
          active={dialog.picking === "source"}
          text={
            names.length > 0
              ? listed(names)
              : bodies
                ? "Click bodies"
                : "Click a face, or the timeline"
          }
          onActivate={() => patchDialog({ picking: "source" })}
          onClear={
            ids.length > 0
              ? () => patchDialog(bodies ? { bodyIds: [], picking: "source" } : { featureIds: [], picking: "source" })
              : undefined
          }
        />
      </Field>
    </>
  );
}

const AXES: readonly (readonly [OriginAxisName, string])[] = [
  ["X", "X"],
  ["Y", "Y"],
  ["Z", "Z"],
];

/** A direction or an axis: an origin axis, an edge of a body or a line of a sketch. */
function AxisField({
  label,
  value,
  active,
  circular,
  secondary,
  onActivate,
  onChange,
}: {
  label: string;
  value: PatternAxis | null;
  active: boolean;
  /** Circular edges are accepted for their axis. */
  circular?: boolean;
  secondary?: boolean;
  onActivate: () => void;
  onChange: (value: PatternAxis | null) => void;
}): ReactElement {
  const doc = useDocument();
  const text = !value
    ? circular
      ? "Click an edge or a sketch line"
      : "Click a straight edge or sketch line"
    : value.type === "origin-axis"
      ? `${value.axis} axis`
      : value.type === "edge"
        ? `Edge · ${bodyName(doc, value.bodyId)}`
        : `Line · ${featureName(doc, value.sketchId)}`;
  return (
    <Field label={label} secondary={secondary}>
      <PickBox
        active={active}
        text={text}
        onActivate={onActivate}
        onClear={value ? () => onChange(null) : undefined}
      />
      <div style={{ marginTop: 4 }}>
        <Segmented
          label={`${label}: origin axis`}
          value={value?.type === "origin-axis" ? value.axis : null}
          options={AXES}
          onChange={(axis) => onChange({ type: "origin-axis", axis })}
        />
      </div>
    </Field>
  );
}

const PLANES: readonly (readonly [OriginPlaneName, string])[] = [
  ["XY", "XY"],
  ["XZ", "XZ"],
  ["YZ", "YZ"],
];

/** A plane: an origin plane, a construction plane or a planar face. */
function PlaneField({
  label,
  value,
  active,
  onActivate,
  onChange,
}: {
  label: string;
  value: PlaneReference | null;
  active: boolean;
  onActivate: () => void;
  onChange: (value: PlaneReference | null) => void;
}): ReactElement {
  const doc = useDocument();
  const text = !value
    ? "Click a flat face or a plane"
    : value.type === "origin-plane"
      ? `${value.plane} plane`
      : value.type === "plane"
        ? (doc.features[value.featureId]?.name ?? "Missing plane")
        : `Face · ${bodyName(doc, value.bodyId)}`;
  return (
    <Field label={label}>
      <PickBox
        active={active}
        text={text}
        onActivate={onActivate}
        onClear={value ? () => onChange(null) : undefined}
      />
      <div style={{ marginTop: 4 }}>
        <Segmented
          label={`${label}: origin plane`}
          value={value?.type === "origin-plane" ? value.plane : null}
          options={PLANES}
          onChange={(plane) => onChange({ type: "origin-plane", plane })}
        />
      </div>
    </Field>
  );
}

function PointField({
  label,
  value,
  active,
  empty,
  onActivate,
  onClear,
}: {
  label: string;
  value: Point3Ref | null;
  active: boolean;
  empty: string;
  onActivate: () => void;
  onClear: () => void;
}): ReactElement {
  const doc = useDocument();
  const fmt = (v: number): string => String(Math.round(v * 1000) / 1000);
  const text = !value
    ? empty
    : value.type === "vertex"
      ? `Vertex · ${bodyName(doc, value.bodyId)}`
      : value.type === "sketch-point"
        ? `Point · ${featureName(doc, value.sketchId)}`
        : `${fmt(value.point.x)}, ${fmt(value.point.y)}, ${fmt(value.point.z)}`;
  return (
    <Field label={label}>
      <PickBox
        active={active}
        text={text}
        onActivate={onActivate}
        onClear={value ? onClear : undefined}
      />
    </Field>
  );
}

function BodiesField({
  label,
  bodyIds,
  active,
  empty,
  secondary,
  onActivate,
  onClear,
}: {
  label: string;
  bodyIds: string[];
  active: boolean;
  empty: string;
  secondary?: boolean;
  onActivate: () => void;
  onClear: () => void;
}): ReactElement {
  const doc = useDocument();
  return (
    <Field label={label} secondary={secondary}>
      <PickBox
        active={active}
        text={bodyIds.length > 0 ? listed(bodyIds.map((id) => bodyName(doc, id))) : empty}
        onActivate={onActivate}
        onClear={bodyIds.length > 0 ? onClear : undefined}
      />
    </Field>
  );
}

// -------------------------------------------------------------------- dialogs

function HoleFields({ dialog }: { dialog: HoleDialog }): ReactElement {
  const doc = useDocument();
  const n = dialog.points.length;
  return (
    <>
      <Field label="Points">
        <PickBox
          active={dialog.picking === "points"}
          text={
            n === 0
              ? "Click sketch points"
              : `${n} ${n === 1 ? "point" : "points"} · ${featureName(doc, dialog.sketchId)}`
          }
          onActivate={() => patchDialog({ picking: "points" })}
          onClear={n > 0 ? () => patchDialog({ points: [], picking: "points" }) : undefined}
        />
      </Field>
      <BodiesField
        label="Body"
        bodyIds={dialog.bodyId ? [dialog.bodyId] : []}
        active={dialog.picking === "body"}
        empty="Click the body to drill"
        secondary={dialog.bodyId !== null}
        onActivate={() => patchDialog({ picking: "body" })}
        onClear={() => patchDialog({ bodyId: null, bodyAuto: false, picking: "body" })}
      />
      <Field label="Type">
        <Choice
          label="Hole type"
          value={dialog.holeType}
          options={[
            ["simple", "Simple"],
            ["counterbore", "Counterbore"],
            ["countersink", "Countersink"],
          ]}
          onChange={(holeType) => patchDialog({ holeType })}
        />
      </Field>
      <Value
        label="Diameter"
        kind="length"
        autoFocus
        value={dialog.diameter}
        onChange={(diameter) => patchDialog({ diameter })}
      />
      <Field label="Extent">
        <Segmented
          label="Extent"
          value={dialog.extent}
          options={[
            ["distance", "Distance"],
            ["through-all", "Through All"],
          ]}
          onChange={(extent) => patchDialog({ extent })}
        />
      </Field>
      {dialog.extent === "distance" && (
        <Value
          label="Depth"
          kind="length"
          value={dialog.depth}
          onChange={(depth) => patchDialog({ depth })}
        />
      )}
      {dialog.holeType === "counterbore" && (
        <>
          <Value
            label="Bore diameter"
            kind="length"
            value={dialog.counterboreDiameter}
            onChange={(counterboreDiameter) => patchDialog({ counterboreDiameter })}
          />
          <Value
            label="Bore depth"
            kind="length"
            value={dialog.counterboreDepth}
            onChange={(counterboreDepth) => patchDialog({ counterboreDepth })}
          />
        </>
      )}
      {dialog.holeType === "countersink" && (
        <>
          <Value
            label="Sink diameter"
            kind="length"
            value={dialog.countersinkDiameter}
            onChange={(countersinkDiameter) => patchDialog({ countersinkDiameter })}
          />
          <Value
            label="Sink angle"
            kind="angle"
            value={dialog.countersinkAngle}
            onChange={(countersinkAngle) => patchDialog({ countersinkAngle })}
          />
        </>
      )}
      <Check label="Flip" secondary checked={dialog.flip} onChange={(flip) => patchDialog({ flip })} />
    </>
  );
}

function MoveFields({ dialog }: { dialog: MoveDialog }): ReactElement {
  return (
    <>
      <BodiesField
        label="Bodies"
        bodyIds={dialog.bodyIds}
        active={dialog.picking === "bodies"}
        empty="Click bodies"
        onActivate={() => patchDialog({ picking: "bodies" })}
        onClear={() => patchDialog({ bodyIds: [], picking: "bodies" })}
      />
      <Field label="Type">
        <Choice
          label="Move type"
          value={dialog.mode}
          options={[
            ["free", "Free Move"],
            ["translate", "Translate"],
            ["rotate", "Rotate"],
            ["point-to-point", "Point to Point"],
          ]}
          onChange={(mode) => patchDialog({ mode, picking: nextPicking({ ...dialog, mode }).picking })}
        />
      </Field>
      {(dialog.mode === "translate" || dialog.mode === "free") && (
        <>
          <Value label="X" kind="length" autoFocus value={dialog.x} onChange={(x) => patchDialog({ x })} />
          <Value label="Y" kind="length" value={dialog.y} onChange={(y) => patchDialog({ y })} />
          <Value label="Z" kind="length" value={dialog.z} onChange={(z) => patchDialog({ z })} />
        </>
      )}
      {dialog.mode === "free" && (
        <>
          <Value label="X Angle" kind="angle" value={dialog.rx} onChange={(rx) => patchDialog({ rx })} />
          <Value label="Y Angle" kind="angle" value={dialog.ry} onChange={(ry) => patchDialog({ ry })} />
          <Value label="Z Angle" kind="angle" value={dialog.rz} onChange={(rz) => patchDialog({ rz })} />
        </>
      )}
      {dialog.mode === "rotate" && (
        <>
          <AxisField
            label="Axis"
            circular
            value={dialog.axis}
            active={dialog.picking === "axis"}
            onActivate={() => patchDialog({ picking: "axis" })}
            onChange={(axis) => patchDialog(axis ? { axis } : { axis, picking: "axis" })}
          />
          <Value
            label="Angle"
            kind="angle"
            value={dialog.angle}
            onChange={(angle) => patchDialog({ angle })}
          />
        </>
      )}
      {dialog.mode === "point-to-point" && (
        <>
          <PointField
            label="From"
            value={dialog.from}
            active={dialog.picking === "from"}
            empty="Click a vertex or sketch point"
            onActivate={() => patchDialog({ picking: "from" })}
            onClear={() => patchDialog({ from: null, picking: "from" })}
          />
          <PointField
            label="To"
            value={dialog.to}
            active={dialog.picking === "to"}
            empty="Click a vertex or sketch point"
            onActivate={() => patchDialog({ picking: "to" })}
            onClear={() => patchDialog({ to: null, picking: "to" })}
          />
        </>
      )}
      <Check
        label="Create copy"
        secondary
        checked={dialog.copy}
        onChange={(copy) => patchDialog({ copy })}
      />
    </>
  );
}

function AlignFields({ dialog }: { dialog: AlignDialog }): ReactElement {
  const doc = useDocument();
  const faces = dialog.mode === "face-to-face";
  const face = (bodyId: string | null, empty: string): string =>
    bodyId ? `Face · ${bodyName(doc, bodyId)}` : empty;
  return (
    <>
      <Field label="Type">
        <Segmented
          label="Align type"
          value={dialog.mode}
          options={[
            ["face-to-face", "Face to Face"],
            ["point-to-point", "Point to Point"],
          ]}
          onChange={(mode) =>
            // The body that moves is the one the first pick of the chosen kind lies on.
            patchDialog({
              mode,
              bodyId:
                mode === "face-to-face"
                  ? dialog.fromFace
                    ? dialog.bodyId
                    : null
                  : dialog.fromPoint?.type === "vertex"
                    ? dialog.fromPoint.bodyId
                    : null,
              picking: nextPicking({ ...dialog, mode }).picking,
            })
          }
        />
      </Field>
      {faces ? (
        <>
          <Field label="From">
            <PickBox
              active={dialog.picking === "from"}
              text={face(dialog.fromFace ? dialog.bodyId : null, "Click a face of the body to move")}
              onActivate={() => patchDialog({ picking: "from" })}
              onClear={
                dialog.fromFace
                  ? () => patchDialog({ fromFace: null, bodyId: null, picking: "from" })
                  : undefined
              }
            />
          </Field>
          <Field label="To">
            <PickBox
              active={dialog.picking === "to"}
              text={face(dialog.toFace?.bodyId ?? null, "Click a face of another body")}
              onActivate={() => patchDialog({ picking: "to" })}
              onClear={dialog.toFace ? () => patchDialog({ toFace: null, picking: "to" }) : undefined}
            />
          </Field>
          <Check
            label="Flip"
            secondary
            checked={dialog.flip}
            onChange={(flip) => patchDialog({ flip })}
          />
        </>
      ) : (
        <>
          <PointField
            label="From"
            value={dialog.fromPoint}
            active={dialog.picking === "from"}
            empty="Click a vertex of the body to move"
            onActivate={() => patchDialog({ picking: "from" })}
            onClear={() => patchDialog({ fromPoint: null, bodyId: null, picking: "from" })}
          />
          <PointField
            label="To"
            value={dialog.toPoint}
            active={dialog.picking === "to"}
            empty="Click a vertex or sketch point"
            onActivate={() => patchDialog({ picking: "to" })}
            onClear={() => patchDialog({ toPoint: null, picking: "to" })}
          />
        </>
      )}
    </>
  );
}

function SplitFields({ dialog }: { dialog: SplitDialog }): ReactElement {
  return (
    <>
      <BodiesField
        label="Body"
        bodyIds={dialog.bodyId ? [dialog.bodyId] : []}
        active={dialog.picking === "body"}
        empty="Click the body to split"
        onActivate={() => patchDialog({ picking: "body" })}
        onClear={() => patchDialog({ bodyId: null, picking: "body" })}
      />
      <PlaneField
        label="Split with"
        value={dialog.tool}
        active={dialog.picking === "tool"}
        onActivate={() => patchDialog({ picking: "tool" })}
        onChange={(tool) => patchDialog({ tool, picking: "tool" })}
      />
      <Field label="Keep">
        <Segmented
          label="Keep"
          value={dialog.keep}
          options={[
            ["both", "Both"],
            ["positive", "Positive"],
            ["negative", "Negative"],
          ]}
          onChange={(keep) => patchDialog({ keep })}
        />
      </Field>
    </>
  );
}

function SweepFields({ dialog }: { dialog: SweepDialog }): ReactElement {
  const doc = useDocument();
  const n = dialog.path.length;
  return (
    <>
      <Field label="Profile">
        <PickBox
          active={dialog.picking === "profile"}
          text={
            dialog.profiles.length === 0
              ? "Click a closed profile"
              : `${dialog.profiles.length} selected · ${featureName(doc, dialog.sketchId)}`
          }
          onActivate={() => patchDialog({ picking: "profile" })}
          onClear={
            dialog.profiles.length > 0
              ? () => patchDialog({ profiles: [], picking: "profile" })
              : undefined
          }
        />
      </Field>
      <Field label="Path">
        <PickBox
          active={dialog.picking === "path"}
          text={
            n === 0
              ? "Click a sketch curve"
              : `${n} ${n === 1 ? "curve" : "curves"} · ${featureName(doc, dialog.pathSketchId)}`
          }
          onActivate={() => patchDialog({ picking: "path" })}
          onClear={n > 0 ? () => patchDialog({ path: [], picking: "path" }) : undefined}
        />
      </Field>
      <OperationFields dialog={dialog} />
    </>
  );
}

function LoftFields({ dialog }: { dialog: LoftDialog }): ReactElement {
  const doc = useDocument();
  const name = (s: LoftSection): string =>
    s.type === "profile"
      ? `Profile · ${featureName(doc, s.sketchId)}`
      : `Face · ${bodyName(doc, s.bodyId)}`;
  const move = (from: number, to: number): void => {
    const sections = dialog.sections.slice();
    const [section] = sections.splice(from, 1);
    if (!section) return;
    sections.splice(to, 0, section);
    patchDialog({ sections });
  };
  const last = dialog.sections.length - 1;
  return (
    <>
      <Field label="Sections">
        <PickBox
          active
          text={
            dialog.sections.length === 0
              ? "Click profiles or flat faces"
              : "Click to add the next section"
          }
        />
        {dialog.sections.length > 0 && (
          <ol className="pick-list" aria-label="Sections">
            {dialog.sections.map((s, i) => (
              <li key={i}>
                <span className="pick-list-name">
                  {i + 1}. {name(s)}
                </span>
                <button
                  className="icon-btn"
                  title="Move up"
                  aria-label={`Move section ${i + 1} up`}
                  disabled={i === 0}
                  onClick={() => move(i, i - 1)}
                >
                  <Icon name="arrow-up" size={12} />
                </button>
                <button
                  className="icon-btn"
                  title="Move down"
                  aria-label={`Move section ${i + 1} down`}
                  disabled={i === last}
                  onClick={() => move(i, i + 1)}
                >
                  <Icon name="arrow-down" size={12} />
                </button>
                <button
                  className="icon-btn"
                  title="Remove"
                  aria-label={`Remove section ${i + 1}`}
                  onClick={() => patchDialog({ sections: dialog.sections.filter((_s, k) => k !== i) })}
                >
                  <Icon name="close" size={11} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Field>
      <Check
        label="Ruled"
        secondary
        checked={dialog.ruled}
        onChange={(ruled) => patchDialog({ ruled })}
      />
      <OperationFields dialog={dialog} />
    </>
  );
}

function OffsetPlaneFields({ dialog }: { dialog: OffsetPlaneDialog }): ReactElement {
  return (
    <>
      <PlaneField
        label="From"
        value={dialog.base}
        active
        onActivate={() => patchDialog({ picking: "base" })}
        onChange={(base) => patchDialog({ base })}
      />
      <Value
        label="Offset"
        kind="length"
        autoFocus
        value={dialog.offset}
        onChange={(offset) => patchDialog({ offset })}
      />
    </>
  );
}

export function SolidDialogBody({ dialog }: { dialog: SolidDialog }): ReactElement {
  switch (dialog.type) {
    case "hole":
      return <HoleFields dialog={dialog} />;
    case "rectangular-pattern":
      return (
        <>
          <SourceFields dialog={dialog} />
          <AxisField
            label="Direction"
            value={dialog.direction}
            active={dialog.picking === "direction"}
            onActivate={() => patchDialog({ picking: "direction" })}
            onChange={(direction) =>
              patchDialog(direction ? { direction } : { direction, picking: "direction" })
            }
          />
          <Value
            label="Count"
            kind="none"
            autoFocus
            value={dialog.count}
            onChange={(count) => patchDialog({ count })}
          />
          <Value
            label="Distance"
            kind="length"
            value={dialog.distance}
            onChange={(distance) => patchDialog({ distance })}
          />
          <Check
            label="Flip"
            secondary
            checked={dialog.flip}
            onChange={(flip) => patchDialog({ flip })}
          />
          <Check
            label="Second direction"
            secondary
            checked={dialog.second}
            onChange={(second) =>
              patchDialog({
                second,
                picking: second && !dialog.direction2 ? "direction2" : "source",
              })
            }
          />
          {dialog.second && (
            <>
              <AxisField
                label="Direction 2"
                secondary
                value={dialog.direction2}
                active={dialog.picking === "direction2"}
                onActivate={() => patchDialog({ picking: "direction2" })}
                onChange={(direction2) =>
                  patchDialog(direction2 ? { direction2 } : { direction2, picking: "direction2" })
                }
              />
              <Value
                label="Count 2"
                kind="none"
                secondary
                value={dialog.count2}
                onChange={(count2) => patchDialog({ count2 })}
              />
              <Value
                label="Distance 2"
                kind="length"
                secondary
                value={dialog.distance2}
                onChange={(distance2) => patchDialog({ distance2 })}
              />
              <Check
                label="Flip 2"
                secondary
                checked={dialog.flip2}
                onChange={(flip2) => patchDialog({ flip2 })}
              />
            </>
          )}
        </>
      );
    case "circular-pattern":
      return (
        <>
          <SourceFields dialog={dialog} />
          <AxisField
            label="Axis"
            circular
            value={dialog.axis}
            active={dialog.picking === "axis"}
            onActivate={() => patchDialog({ picking: "axis" })}
            onChange={(axis) => patchDialog(axis ? { axis } : { axis, picking: "axis" })}
          />
          <Value
            label="Count"
            kind="none"
            autoFocus
            value={dialog.count}
            onChange={(count) => patchDialog({ count })}
          />
          <Value
            label="Angle"
            kind="angle"
            value={dialog.angle}
            onChange={(angle) => patchDialog({ angle })}
          />
          <Check
            label="Flip"
            secondary
            checked={dialog.flip}
            onChange={(flip) => patchDialog({ flip })}
          />
        </>
      );
    case "mirror":
      return (
        <>
          <SourceFields dialog={dialog} />
          <PlaneField
            label="Mirror plane"
            value={dialog.plane}
            active={dialog.picking === "plane"}
            onActivate={() => patchDialog({ picking: "plane" })}
            onChange={(plane) => patchDialog(plane ? { plane } : { plane, picking: "plane" })}
          />
        </>
      );
    case "move":
      return <MoveFields dialog={dialog} />;
    case "align":
      return <AlignFields dialog={dialog} />;
    case "split":
      return <SplitFields dialog={dialog} />;
    case "sweep":
      return <SweepFields dialog={dialog} />;
    case "loft":
      return <LoftFields dialog={dialog} />;
    case "offset-plane":
      return <OffsetPlaneFields dialog={dialog} />;
  }
}
