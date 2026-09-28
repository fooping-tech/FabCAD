import type { MaterialProfile, StrategySettings } from "@fabcad/fabrication-core";

/** Settings of the laser board strategy (MDF / acrylic / cardboard). */
export interface BoardSettings extends StrategySettings {
  /** Joint for edges where one panel (the cap) lies over the other. Default "tab-slot". */
  capJoint: "tab-slot" | "finger" | "flat";
  /** Joint between two non-cap panels. Default "flat" (butt joint, glued). */
  sideJoint: "flat" | "finger";
  /** Distance from the slot panel's outline to its slots (mm). 0 = open notches. Default 3. */
  slotEdgeMargin: number;
  /** Target tab width (mm). Default 3 × thickness. The tab count is derived per edge. */
  tabWidth: number;
  /** Smallest acceptable tab (mm). Default 1.5 × thickness. */
  minTabWidth: number;
  /** Target spacing between tabs (mm). Default 4 × thickness. */
  tabSpacing: number;
  /** Target finger width (mm). Default 2 × thickness. */
  fingerWidth: number;
  /**
   * How far from 90° (degrees) an edge may be. Used by the classification of the body
   * (rectangular box, side walls of a flat part) and by the joints. Default 1.
   */
  angleTolerance: number;
  /**
   * How far the thickness of a body may be from the material thickness (mm) for the body to
   * be the sheet itself (a flat part). Default 0.1.
   */
  thicknessTolerance: number;
  /** Apply kerf compensation to the final paths. Default true. */
  kerfCompensation: boolean;
  /** Per-face role override, keyed by topology face id (rectangular boxes only). */
  roles?: Record<number, "slot" | "tab">;
}

export function defaultBoardSettings(material: MaterialProfile): BoardSettings {
  const t = material.thickness;
  return {
    capJoint: "tab-slot",
    sideJoint: "flat",
    slotEdgeMargin: 3,
    tabWidth: 3 * t,
    minTabWidth: 1.5 * t,
    tabSpacing: 4 * t,
    fingerWidth: 2 * t,
    angleTolerance: 1,
    thicknessTolerance: 0.1,
    kerfCompensation: true,
  };
}
