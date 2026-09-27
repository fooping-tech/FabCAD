import { type Vec2, boundsOfPoints } from "@fabcad/geometry";
import { partPathPoints, rotatePartPoint } from "./sheet";
import type {
  FabricationWarning,
  FlatPart,
  NestingAlgorithm,
  PartPlacement,
  SheetLayout,
  SheetSpec,
} from "./types";

/**
 * Sheet layout ("nesting").
 *
 * Layout is a pluggable strategy: `row` and `shelf` are rectangle packers registered below.
 * True-shape nesting, rotation optimisation or grain direction can be added later as further
 * `NestingStrategy` implementations without touching callers: a strategy receives the real
 * path points of every part (`NestingItem.points`), not only their boxes.
 *
 * Sheet coordinates: millimetres, origin top-left, Y down. See `sheet.ts` for the transform.
 */

export interface NestingOptions {
  /** Allow rotating parts by 90°. Default false (keeps grain direction). */
  allowRotation?: boolean;
}

/** Axis-aligned box of a part on the sheet for one rotation. */
export interface OrientedBox {
  rotation: number;
  width: number;
  height: number;
  /** Add to the desired top-left corner of the box to get `PartPlacement.x / y`. */
  originX: number;
  originY: number;
}

export interface NestingItem {
  partId: string;
  /** Points of the part's final paths, in the part frame (Y up). */
  points: readonly Vec2[];
  /** Box of the part when rotated counter-clockwise by `rotation` degrees. */
  box(rotation: number): OrientedBox;
}

export interface NestingOutput {
  placements: PartPlacement[];
  unplaced: string[];
}

export interface NestingStrategy {
  id: string;
  name: string;
  pack(items: readonly NestingItem[], sheet: SheetSpec, options: NestingOptions): NestingOutput;
}

const TOL = 1e-9;

export function createNestingItem(part: FlatPart): NestingItem {
  const points = partPathPoints(part);
  const cache = new Map<number, OrientedBox>();
  return {
    partId: part.id,
    points,
    box(rotation: number): OrientedBox {
      const hit = cache.get(rotation);
      if (hit) return hit;
      // Sheet-relative coordinates of a rotated point r are (r.x, −r.y).
      const b = boundsOfPoints(points.map((p) => rotatePartPoint(p, rotation)));
      const empty = !Number.isFinite(b.minX);
      const box: OrientedBox = empty
        ? { rotation, width: 0, height: 0, originX: 0, originY: 0 }
        : {
            rotation,
            width: b.maxX - b.minX,
            height: b.maxY - b.minY,
            originX: -b.minX,
            originY: b.maxY,
          };
      cache.set(rotation, box);
      return box;
    },
  };
}

interface Usable {
  width: number;
  height: number;
}

const usableArea = (sheet: SheetSpec): Usable => ({
  width: sheet.width - 2 * sheet.margin,
  height: sheet.height - 2 * sheet.margin,
});

const fits = (box: OrientedBox, area: Usable): boolean =>
  box.width <= area.width + TOL && box.height <= area.height + TOL;

function place(item: NestingItem, box: OrientedBox, sheet: number, x: number, y: number): PartPlacement {
  return {
    partId: item.partId,
    sheet,
    x: x + box.originX,
    y: y + box.originY,
    rotation: box.rotation,
  };
}

/** `row`: parts in the given order, left to right, wrapping to a new row and a new sheet. */
export const rowNesting: NestingStrategy = {
  id: "row",
  name: "Rows",
  pack(items, sheet, options) {
    const area = usableArea(sheet);
    const placements: PartPlacement[] = [];
    const unplaced: string[] = [];
    let sheetIndex = 0;
    let cx = 0;
    let cy = 0;
    let rowHeight = 0;
    for (const item of items) {
      let box = item.box(0);
      if (!fits(box, area) && options.allowRotation && fits(item.box(90), area)) box = item.box(90);
      if (!fits(box, area)) {
        unplaced.push(item.partId);
        continue;
      }
      if (cx > 0 && cx + box.width > area.width + TOL) {
        cx = 0;
        cy += rowHeight + sheet.gap;
        rowHeight = 0;
      }
      if (cy > 0 && cy + box.height > area.height + TOL) {
        sheetIndex++;
        cx = 0;
        cy = 0;
        rowHeight = 0;
      }
      placements.push(place(item, box, sheetIndex, sheet.margin + cx, sheet.margin + cy));
      cx += box.width + sheet.gap;
      rowHeight = Math.max(rowHeight, box.height);
    }
    return { placements, unplaced };
  },
};

interface Shelf {
  sheet: number;
  y: number;
  height: number;
  used: number;
}

/**
 * `shelf`: parts sorted by height (descending) and packed first-fit into shelves. With
 * `allowRotation` parts are laid on their long side first and may be turned by 90° when that
 * makes them fit into the remaining space of an existing shelf.
 */
export const shelfNesting: NestingStrategy = {
  id: "shelf",
  name: "Shelves",
  pack(items, sheet, options) {
    const area = usableArea(sheet);
    const placements: PartPlacement[] = [];
    const unplaced: string[] = [];
    const rotate = options.allowRotation ?? false;

    interface Entry {
      item: NestingItem;
      primary: OrientedBox;
      alternate?: OrientedBox;
      order: number;
    }
    const entries: Entry[] = [];
    items.forEach((item, order) => {
      const candidates = (rotate ? [item.box(0), item.box(90)] : [item.box(0)]).filter((b) =>
        fits(b, area),
      );
      if (candidates.length === 0) {
        unplaced.push(item.partId);
        return;
      }
      // Lying orientation (smaller height) first; ties keep the unrotated orientation.
      candidates.sort((a, b) => a.height - b.height || a.rotation - b.rotation);
      entries.push({ item, primary: candidates[0]!, alternate: candidates[1], order });
    });
    entries.sort((a, b) => b.primary.height - a.primary.height || a.order - b.order);

    const shelves: Shelf[] = [];
    const sheetFill: number[] = [];
    const tryShelves = (entry: Entry, box: OrientedBox): boolean => {
      for (const shelf of shelves) {
        const x = shelf.used > 0 ? shelf.used + sheet.gap : 0;
        if (box.height <= shelf.height + TOL && x + box.width <= area.width + TOL) {
          placements.push(
            place(entry.item, box, shelf.sheet, sheet.margin + x, sheet.margin + shelf.y),
          );
          shelf.used = x + box.width;
          return true;
        }
      }
      return false;
    };
    for (const entry of entries) {
      if (tryShelves(entry, entry.primary)) continue;
      if (entry.alternate && tryShelves(entry, entry.alternate)) continue;
      // Open a new shelf on the first sheet that has room below its last shelf.
      const box = entry.primary;
      let target = -1;
      for (let s = 0; s < sheetFill.length; s++) {
        const y = sheetFill[s]! > 0 ? sheetFill[s]! + sheet.gap : 0;
        if (y + box.height <= area.height + TOL) {
          target = s;
          break;
        }
      }
      if (target < 0) {
        target = sheetFill.length;
        sheetFill.push(0);
      }
      const filled = sheetFill[target]!;
      const y = filled > 0 ? filled + sheet.gap : 0;
      const shelf: Shelf = { sheet: target, y, height: box.height, used: 0 };
      shelves.push(shelf);
      sheetFill[target] = y + box.height;
      placements.push(place(entry.item, box, target, sheet.margin, sheet.margin + y));
      shelf.used = box.width;
    }
    return { placements, unplaced };
  },
};

const registry = new Map<string, NestingStrategy>();

/** Register (or replace) a nesting strategy, e.g. a true-shape nester. */
export function registerNestingStrategy(strategy: NestingStrategy): void {
  registry.set(strategy.id, strategy);
}

export function getNestingStrategy(id: string): NestingStrategy | undefined {
  return registry.get(id);
}

export function listNestingStrategies(): NestingStrategy[] {
  return [...registry.values()];
}

registerNestingStrategy(rowNesting);
registerNestingStrategy(shelfNesting);

export const DEFAULT_SHEET: SheetSpec = { width: 600, height: 300, margin: 5, gap: 3 };

/** Lay parts out with an explicit strategy object. */
export function layoutPartsWith(
  parts: FlatPart[],
  sheet: SheetSpec,
  strategy: NestingStrategy,
  options: NestingOptions = {},
  algorithm: NestingAlgorithm = "row",
): SheetLayout {
  const items = parts.map(createNestingItem);
  const { placements, unplaced } = strategy.pack(items, sheet, options);
  const names = new Map<string, string>();
  for (const part of parts) names.set(part.id, part.name);
  const area = usableArea(sheet);
  const warnings: FabricationWarning[] = unplaced.map((partId) => ({
    code: "part-too-large",
    severity: "error",
    message:
      `Part "${names.get(partId) ?? partId}" does not fit on the sheet ` +
      `(usable area ${fmt(area.width)} × ${fmt(area.height)} mm).`,
    partId,
  }));
  let sheetCount = 1;
  for (const p of placements) sheetCount = Math.max(sheetCount, p.sheet + 1);
  return { sheet, algorithm, sheetCount, placements, unplaced, warnings };
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/**
 * Lay parts out on sheets. Uses the bounds of each part's FINAL `paths` (joints and kerf
 * included), never the raw outline.
 */
export function layoutParts(
  parts: FlatPart[],
  sheet: SheetSpec,
  algorithm: NestingAlgorithm,
  options: NestingOptions = {},
): SheetLayout {
  const strategy = registry.get(algorithm) ?? rowNesting;
  return layoutPartsWith(parts, sheet, strategy, options, algorithm);
}
