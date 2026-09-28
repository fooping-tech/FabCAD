import {
  type CadBody,
  type FabricationClassification,
  type FabricationResult,
  type FabricationStrategy,
  type MaterialProfile,
  describeMaterial,
} from "@fabcad/fabrication-core";
import {
  type BoardClassification,
  BOARD_SUPPORT_TEXT,
  classifyBoardBody,
} from "./boardClassifier";
import { type BoardSettings, defaultBoardSettings } from "./boardSettings";
import { compileFlatPart } from "./flatPart";
import { compileRectangularBox } from "./rectangularBox";

/**
 * Laser board strategy (MDF / acrylic / cardboard):
 *
 *   Solid → classify ─┬─ flat part        → flatPart.ts
 *                     ├─ rectangular box  → rectangularBox.ts
 *                     └─ unsupported      → no parts, one error
 *
 * Nothing is compiled before the classification. A body that is neither a flat part nor a
 * rectangular box produces no manufacturing output at all.
 */
export { type BoardSettings, defaultBoardSettings } from "./boardSettings";
export { edgeCompensation } from "./rectangularBox";

const publicClassification = (c: BoardClassification): FabricationClassification => ({
  kind: c.kind,
  label: c.label,
  supported: c.kind !== "unsupported",
  ...(c.reason !== undefined ? { reason: c.reason } : {}),
});

/** Message of the `unsupported-board-shape` error. */
export function unsupportedBoardMessage(
  body: Pick<CadBody, "name">,
  material: MaterialProfile,
  reason: string,
): string {
  return (
    `"${body.name}" cannot be automatically fabricated from ${describeMaterial(material)}. ` +
    `Reason: ${reason} ${BOARD_SUPPORT_TEXT}`
  );
}

function fabricateBoard(
  body: CadBody,
  material: MaterialProfile,
  input: BoardSettings,
): FabricationResult {
  const settings: BoardSettings = { ...defaultBoardSettings(material), ...input };
  const classification = classifyBoardBody(body, material, {
    thicknessTolerance: settings.thicknessTolerance,
    angleTolerance: settings.angleTolerance,
  });
  const base = {
    bodyId: body.id,
    material,
    strategyId: "laser.board",
    classification: publicClassification(classification),
  };

  if (classification.kind === "flat-part" && classification.flatPart) {
    const flat = compileFlatPart(body, material, settings, classification.flatPart);
    return { ...base, parts: flat.parts, connections: [], warnings: flat.warnings };
  }
  if (classification.kind === "rectangular-box") {
    return { ...compileRectangularBox(body, material, settings), ...base };
  }
  return {
    ...base,
    parts: [],
    connections: [],
    warnings: [
      {
        code: "unsupported-board-shape",
        severity: "error",
        message: unsupportedBoardMessage(
          body,
          material,
          classification.reason ?? "This shape is not supported.",
        ),
      },
    ],
  };
}

export const laserBoardStrategy: FabricationStrategy<BoardSettings> = {
  id: "laser.board",
  name: "Laser cut board (flat parts and rectangular boxes)",
  process: "laser",
  supports: (material) => material.category === "board",
  defaultSettings: defaultBoardSettings,
  fabricate: fabricateBoard,
};
