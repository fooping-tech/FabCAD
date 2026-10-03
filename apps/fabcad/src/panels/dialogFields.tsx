import { type BodyOperation, listBodies } from "@fabcad/cad-document";
import type { ReactElement, ReactNode } from "react";
import { patchDialog } from "../app/actions";
import type { OperationPick } from "../app/appState";
import { useDocument } from "../app/session";
import { Icon } from "../ui/Icon";

/** Building blocks shared by the feature dialogs. */

const OPERATIONS: { id: BodyOperation; label: string }[] = [
  { id: "new", label: "New Body" },
  { id: "join", label: "Join" },
  { id: "cut", label: "Cut" },
  { id: "intersect", label: "Intersect" },
];

/** `secondary` fields are folded away on small screens until "Options" is opened. */
export function Field({
  label,
  children,
  secondary,
}: {
  label: string;
  children: ReactNode;
  secondary?: boolean;
}): ReactElement {
  return (
    <div className={`field${secondary ? " secondary" : ""}`} style={{ alignItems: "start" }}>
      <span className="label" style={{ paddingTop: 5 }}>
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function PickBox({
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

export function OperationFields({
  dialog,
}: {
  dialog: OperationPick & { editing: string | null };
}): ReactElement {
  const doc = useDocument();
  // The body the edited feature made itself is not something it can be joined to.
  const edited = dialog.editing ? doc.features[dialog.editing] : undefined;
  const own = edited && "bodyId" in edited ? edited.bodyId : "";
  const bodies = listBodies(doc).filter((b) => b.id !== own);
  return (
    <>
      <Field label="Operation" secondary>
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
        <Field label="Bodies" secondary>
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
