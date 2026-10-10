import { nodeHandlePair, setNodeMode, type NodeMode } from "@fabcad/sketch";
import { appState } from "../app/appState";
import { documentStore, editSketchSolved } from "../app/session";

/** Set the selected anchors' mode as one undoable sketch command. */
export function setSelectedNodeMode(mode: NodeMode): boolean {
  const { activeSketchId, selection } = appState.get();
  if (!activeSketchId) return false;
  const feature = documentStore.document.features[activeSketchId];
  if (!feature || feature.type !== "sketch") return false;
  const anchors = selection.flatMap((s) =>
    s.kind === "entity" && s.sketchId === activeSketchId && nodeHandlePair(feature.sketch, s.entityId)
      ? [s.entityId] : [],
  );
  if (anchors.length === 0) return false;
  return editSketchSolved(activeSketchId, `Node: ${mode}`, (sketch) =>
    anchors.reduce((next, id) => setNodeMode(next, id, mode), sketch),
  );
}
