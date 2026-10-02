import { type Sketch, editSketch, toggleConstruction } from "@fabcad/sketch";
import { setTool } from "./actions";
import { appState, setSelection } from "./appState";
import { documentStore, editSketchSolved } from "./session";
import { CONSTRAINT_TOOLS, constraintRefs } from "../sketch/constraintTools";

/** Commands of the sketch shared by the ribbon and the command palette. */

/** A constraint on the selection, or the pick-driven command when the selection does not fit. */
export function applyConstraintToSelection(type: (typeof CONSTRAINT_TOOLS)[number]["type"]): void {
  const { selection, activeSketchId } = appState.get();
  if (!activeSketchId) return;
  const f = documentStore.document.features[activeSketchId];
  if (!f || f.type !== "sketch") return;
  const picked = selection.flatMap((s) => {
    if (s.kind !== "entity" || s.sketchId !== activeSketchId) return [];
    const e = f.sketch.entities[s.entityId];
    return e ? [e] : [];
  });
  const def = CONSTRAINT_TOOLS.find((c) => c.type === type)!;
  const state = picked.length > 0 ? constraintRefs(type, picked) : { state: "incomplete" as const };
  if (state.state !== "ready") {
    // Nothing usable selected: switch to the pick-driven command.
    setSelection([]);
    setTool(`constraint:${type}`);
    return;
  }
  const refs = state.refs;
  const ok = editSketchSolved(
    activeSketchId,
    def.label,
    (sketch: Sketch) => {
      const existing = Object.values(sketch.constraints).find(
        (c) => c.type === type && c.refs.length === refs.length && c.refs.every((r) => refs.includes(r)),
      );
      if (existing) {
        return type === "fix" ? editSketch(sketch, (b) => b.removeConstraint(existing.id)) : sketch;
      }
      return editSketch(sketch, (b) => {
        b.constrain(type, ...refs);
      });
    },
    { rejectOverConstrained: true },
  );
  if (ok) setSelection([]);
}

/** Normal / Construction: of the selected entities, or of the geometry drawn next. */
export function toggleSelectedConstruction(): void {
  const { selection, activeSketchId } = appState.get();
  if (!activeSketchId) return;
  const ids = selection.flatMap((s) =>
    s.kind === "entity" && s.sketchId === activeSketchId ? [s.entityId] : [],
  );
  if (ids.length === 0) {
    appState.set((s) => ({ toolOptions: { ...s.toolOptions, construction: !s.toolOptions.construction } }));
    return;
  }
  editSketchSolved(activeSketchId, "Normal / Construction", (s) => toggleConstruction(s, ids));
}
