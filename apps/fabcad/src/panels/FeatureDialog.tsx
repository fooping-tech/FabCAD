import { type BodyOperation, FEATURE_LABELS } from "@fabcad/cad-document";
import type { ReactElement, ReactNode } from "react";
import { closeDialog, commitDialog, dialogProblem, patchDialog } from "../app/actions";
import { type Dialog, appState } from "../app/appState";
import { useDocument } from "../app/session";
import { useStore } from "../app/tinyStore";
import { Icon } from "../ui/Icon";
import { ExpressionInput } from "./ExpressionInput";

const OPERATIONS: { id: BodyOperation; label: string }[] = [
  { id: "new", label: "New Body" },
  { id: "join", label: "Join" },
  { id: "cut", label: "Cut" },
  { id: "intersect", label: "Intersect" },
];

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="field" style={{ alignItems: "start" }}>
      <span className="label" style={{ paddingTop: 5 }}>
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

function PickBox({
  active,
  text,
  onActivate,
  onClear,
}: {
  active: boolean;
  text: string;
  onActivate?: () => void;
  onClear?: () => void;
}): ReactElement {
  return (
    <div
      className={`pick-box${active ? " on" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onActivate?.();
      }}
    >
      <span>{text}</span>
      {onClear && (
        <button
          className="clear"
          aria-label="Clear selection"
          title="Clear"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}

function OperationFields({
  dialog,
}: {
  dialog: Extract<Dialog, { type: "extrude" | "revolve" }>;
}): ReactElement {
  const doc = useDocument();
  const bodies = Object.values(doc.bodies);
  return (
    <>
      <Field label="Operation">
        <select
          value={dialog.operation}
          aria-label="Operation"
          onChange={(e) => {
            const operation = e.target.value as BodyOperation;
            patchDialog({
              operation,
              targetBodyIds:
                operation !== "new" && dialog.targetBodyIds.length === 0
                  ? bodies.filter((b) => b.visible).map((b) => b.id)
                  : dialog.targetBodyIds,
            });
          }}
        >
          {OPERATIONS.map((o) => (
            <option key={o.id} value={o.id} disabled={o.id !== "new" && bodies.length === 0}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {dialog.operation !== "new" && (
        <Field label="Bodies">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 4 }}>
            {bodies.map((b) => (
              <label key={b.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={dialog.targetBodyIds.includes(b.id)}
                  onChange={(e) =>
                    patchDialog({
                      targetBodyIds: e.target.checked
                        ? [...dialog.targetBodyIds, b.id]
                        : dialog.targetBodyIds.filter((id) => id !== b.id),
                    })
                  }
                />
                {b.name}
              </label>
            ))}
          </div>
        </Field>
      )}
    </>
  );
}

function Body({ dialog }: { dialog: Dialog }): ReactElement | null {
  const doc = useDocument();
  const sketchName = (id: string | null): string => {
    const f = id ? doc.features[id] : undefined;
    return f ? f.name : "";
  };
  switch (dialog.type) {
    case "extrude":
      return (
        <>
          <Field label="Profile">
            <PickBox
              active
              text={
                dialog.profiles.length === 0
                  ? "Click a closed profile"
                  : `${dialog.profiles.length} selected · ${sketchName(dialog.sketchId)}`
              }
              onClear={dialog.profiles.length > 0 ? () => patchDialog({ profiles: [] }) : undefined}
            />
          </Field>
          <Field label="Distance">
            <ExpressionInput
              label="Distance"
              kind="length"
              live
              autoFocus
              value={dialog.distance}
              onChange={(distance) => patchDialog({ distance })}
              onEnter={commitDialog}
            />
          </Field>
          <Field label="Direction">
            <div className="segmented">
              {(
                [
                  ["positive", "One Side"],
                  ["negative", "Flipped"],
                  ["symmetric", "Symmetric"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={dialog.direction === id ? "on" : ""}
                  onClick={() => patchDialog({ direction: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <OperationFields dialog={dialog} />
        </>
      );
    case "revolve": {
      const axisText = !dialog.axis
        ? "Click a sketch line"
        : dialog.axis.type === "origin-axis"
          ? `${dialog.axis.axis} axis`
          : "Sketch line";
      return (
        <>
          <Field label="Profile">
            <PickBox
              active={dialog.picking === "profile"}
              text={
                dialog.profiles.length === 0
                  ? "Click a closed profile"
                  : `${dialog.profiles.length} selected · ${sketchName(dialog.sketchId)}`
              }
              onActivate={() => patchDialog({ picking: "profile" })}
              onClear={
                dialog.profiles.length > 0
                  ? () => patchDialog({ profiles: [], picking: "profile" })
                  : undefined
              }
            />
          </Field>
          <Field label="Axis">
            <PickBox
              active={dialog.picking === "axis"}
              text={axisText}
              onActivate={() => patchDialog({ picking: "axis" })}
              onClear={dialog.axis ? () => patchDialog({ axis: null, picking: "axis" }) : undefined}
            />
            <div className="segmented" style={{ marginTop: 4 }}>
              {(["X", "Y", "Z"] as const).map((axis) => (
                <button
                  key={axis}
                  className={
                    dialog.axis?.type === "origin-axis" && dialog.axis.axis === axis ? "on" : ""
                  }
                  onClick={() => patchDialog({ axis: { type: "origin-axis", axis } })}
                >
                  {axis}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Angle">
            <ExpressionInput
              label="Angle"
              kind="angle"
              live
              value={dialog.angle}
              onChange={(angle) => patchDialog({ angle })}
              onEnter={commitDialog}
            />
          </Field>
          <OperationFields dialog={dialog} />
        </>
      );
    }
    case "fillet":
    case "chamfer":
      return (
        <>
          <Field label="Edges">
            <PickBox
              active
              text={dialog.edges.length === 0 ? "Click edges" : `${dialog.edges.length} selected`}
              onClear={dialog.edges.length > 0 ? () => patchDialog({ edges: [] }) : undefined}
            />
          </Field>
          <Field label={dialog.type === "fillet" ? "Radius" : "Distance"}>
            <ExpressionInput
              label={dialog.type === "fillet" ? "Radius" : "Distance"}
              kind="length"
              live
              autoFocus
              value={dialog.value}
              onChange={(value) => patchDialog({ value })}
              onEnter={commitDialog}
            />
          </Field>
        </>
      );
    case "shell":
      return (
        <>
          <Field label="Faces">
            <PickBox
              active
              text={
                dialog.faces.length === 0
                  ? "Click faces to remove"
                  : `${dialog.faces.length} selected`
              }
              onClear={dialog.faces.length > 0 ? () => patchDialog({ faces: [] }) : undefined}
            />
          </Field>
          <Field label="Thickness">
            <ExpressionInput
              label="Thickness"
              kind="length"
              live
              autoFocus
              value={dialog.value}
              onChange={(value) => patchDialog({ value })}
              onEnter={commitDialog}
            />
          </Field>
        </>
      );
    case "combine":
      return (
        <>
          <Field label="Target">
            <PickBox
              active={dialog.picking === "target"}
              text={
                dialog.targetBodyId
                  ? (doc.bodies[dialog.targetBodyId]?.name ?? "Missing body")
                  : "Click the target body"
              }
              onActivate={() => patchDialog({ picking: "target" })}
              onClear={
                dialog.targetBodyId
                  ? () => patchDialog({ targetBodyId: null, picking: "target" })
                  : undefined
              }
            />
          </Field>
          <Field label="Tools">
            <PickBox
              active={dialog.picking === "tools"}
              text={
                dialog.toolBodyIds.length === 0
                  ? "Click tool bodies"
                  : dialog.toolBodyIds.map((id) => doc.bodies[id]?.name ?? "?").join(", ")
              }
              onActivate={() => patchDialog({ picking: "tools" })}
              onClear={
                dialog.toolBodyIds.length > 0 ? () => patchDialog({ toolBodyIds: [] }) : undefined
              }
            />
          </Field>
          <Field label="Operation">
            <div className="segmented">
              {(
                [
                  ["union", "Join"],
                  ["cut", "Cut"],
                  ["intersect", "Intersect"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  className={dialog.operation === id ? "on" : ""}
                  onClick={() => patchDialog({ operation: id })}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Keep tools">
            <div style={{ paddingTop: 6 }}>
              <input
                type="checkbox"
                aria-label="Keep tool bodies"
                checked={dialog.keepTools}
                onChange={(e) => patchDialog({ keepTools: e.target.checked })}
              />
            </div>
          </Field>
        </>
      );
    default:
      return null;
  }
}

const TITLES: Partial<Record<Dialog["type"], string>> = {
  extrude: FEATURE_LABELS.extrude,
  revolve: FEATURE_LABELS.revolve,
  fillet: FEATURE_LABELS.fillet,
  chamfer: FEATURE_LABELS.chamfer,
  shell: FEATURE_LABELS.shell,
  combine: FEATURE_LABELS.boolean,
};

/** Floating dialog of the running solid feature command. */
export function FeatureDialog(): ReactElement | null {
  const dialog = useStore(appState, (s) => s.dialog);
  if (!dialog) return null;
  const title = TITLES[dialog.type];
  if (!title) return null;
  const problem = dialogProblem(dialog);
  const editing = "editing" in dialog && dialog.editing !== null;
  return (
    <div className="floating" role="dialog" aria-label={title}>
      <div className="floating-title">
        <span>{editing ? `Edit ${title}` : title}</span>
        <button className="icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={closeDialog}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="floating-body">
        <div className="form">
          <Body dialog={dialog} />
        </div>
        <div className="form-actions" style={{ alignItems: "center" }}>
          {problem && (
            <span className="field-hint" style={{ marginRight: "auto", marginTop: 0 }}>
              {problem}
            </span>
          )}
          <button className="btn" onClick={closeDialog}>
            Cancel
          </button>
          <button className="btn accent" disabled={problem !== null} onClick={commitDialog}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
