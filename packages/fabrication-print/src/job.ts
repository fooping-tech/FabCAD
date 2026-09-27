import type { FabricationWarning } from "@fabcad/fabrication-core";
import {
  analyzeOverhangs,
  autoOrient,
  meshArea,
  meshBounds,
  meshVolume,
  openEdges,
  orientMesh,
  orientationVector,
  translateMesh,
  weldMesh,
} from "./mesh";
import type { PrintBody, PrintEstimate, PrintJob, PrintPart, PrintSettings } from "./types";

const round = (v: number, d = 2): number => {
  const f = Math.pow(10, d);
  return Math.round(v * f) / f;
};

/**
 * Plastic used by a part. Walls and the solid top and bottom are modelled as a skin of
 * constant thickness over the whole surface, the rest of the volume is filled at the infill
 * density. This is an estimate: the slicer has the final word.
 */
export function estimatePrint(
  volume: number,
  area: number,
  height: number,
  settings: PrintSettings,
): PrintEstimate {
  const { printer, material } = settings;
  const wall = settings.walls * printer.nozzle;
  const cap = settings.topBottomLayers * printer.layerHeight;
  // Average skin thickness; the skin can never be more than the whole body.
  const skin = Math.min(volume, area * ((wall * 2 + cap) / 3));
  const infill = Math.max(0, volume - skin) * Math.max(0, Math.min(1, settings.infill));
  const plastic = skin + infill;
  const mass = (plastic / 1000) * material.density;
  const section = Math.PI * Math.pow(material.diameter / 2, 2);
  return {
    volume,
    plastic,
    mass,
    filament: plastic / section / 1000,
    layers: Math.ceil(height / printer.layerHeight - 1e-9),
  };
}

/**
 * Prepare bodies for printing: orient every body, check it, estimate it and place the parts
 * next to each other on the bed (front to back, in rows).
 */
export function compilePrintJob(bodies: PrintBody[], settings: PrintSettings): PrintJob {
  const warnings: FabricationWarning[] = [];
  const { bed } = settings.printer;
  const parts: PrintPart[] = [];

  for (const source of bodies) {
    const body = { ...source, mesh: weldMesh(source.mesh) };
    if (body.mesh.indices.length < 12) {
      warnings.push({
        code: "unsupported",
        severity: "error",
        message: `"${body.name}" has no printable geometry.`,
        partId: body.id,
      });
      continue;
    }
    const volume = meshVolume(body.mesh);
    if (!(volume > 1e-6) || openEdges(body.mesh) > 0) {
      warnings.push({
        code: "non-manifold",
        severity: "error",
        message: `"${body.name}" is not a closed solid and cannot be printed: its surface has gaps, or parts of it touch only along an edge.`,
        partId: body.id,
      });
      continue;
    }
    const choice = settings.orientations[body.id] ?? "auto";
    const down =
      choice === "auto"
        ? autoOrient(body.mesh, settings.overhangAngle)
        : orientationVector(choice);
    const mesh = orientMesh(body.mesh, down);
    const bounds = meshBounds(mesh);
    const report = analyzeOverhangs(mesh, settings.overhangAngle);
    const area = meshArea(mesh);
    const size = { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z };

    if (size.x > bed.width + 1e-6 || size.y > bed.depth + 1e-6 || size.z > bed.height + 1e-6) {
      // Lying the other way round in the plane may still fit.
      const turned = size.y <= bed.width + 1e-6 && size.x <= bed.depth + 1e-6 && size.z <= bed.height + 1e-6;
      warnings.push({
        code: "part-too-large",
        severity: "error",
        message: turned
          ? `"${body.name}" (${round(size.x, 1)} × ${round(size.y, 1)} × ${round(size.z, 1)} mm) only fits the bed when turned by 90°.`
          : `"${body.name}" (${round(size.x, 1)} × ${round(size.y, 1)} × ${round(size.z, 1)} mm) is larger than the build volume (${bed.width} × ${bed.depth} × ${bed.height} mm).`,
        partId: body.id,
      });
    }
    if (report.area > 1) {
      warnings.push({
        code: "unsupported",
        severity: "warning",
        message: `"${body.name}" has ${round(report.area, 0)} mm² of overhang beyond ${settings.overhangAngle}°: print with supports or choose another orientation.`,
        partId: body.id,
      });
    }
    const footprint = Math.max(size.x * size.y, 1e-9);
    if (report.contactArea < Math.min(25, footprint * 0.05)) {
      warnings.push({
        code: "narrow-tab",
        severity: "warning",
        message: `"${body.name}" touches the bed with only ${round(report.contactArea, 1)} mm²: use a brim or choose another orientation.`,
        partId: body.id,
      });
    }
    parts.push({
      bodyId: body.id,
      name: body.name,
      mesh,
      overhang: report.flags,
      down,
      size,
      position: { x: 0, y: 0 },
      overhangArea: report.area,
      contactArea: report.contactArea,
      estimate: estimatePrint(volume, area, size.z, settings),
      placed: false,
    });
  }

  // Rows from the front left corner, largest footprint first.
  const order = parts.slice().sort((a, b) => b.size.y - a.size.y || b.size.x - a.size.x);
  let x = 0;
  let y = 0;
  let row = 0;
  for (const part of order) {
    if (part.size.x > bed.width + 1e-6 || part.size.y > bed.depth + 1e-6) continue;
    if (x > 0 && x + part.size.x > bed.width + 1e-6) {
      x = 0;
      y += row + settings.gap;
      row = 0;
    }
    if (y + part.size.y > bed.depth + 1e-6) {
      warnings.push({
        code: "part-too-large",
        severity: "warning",
        message: `"${part.name}" does not fit on the bed together with the other parts: print it separately.`,
        partId: part.bodyId,
      });
      continue;
    }
    part.position = { x, y };
    part.mesh = translateMesh(part.mesh, x, y);
    part.placed = true;
    x += part.size.x + settings.gap;
    row = Math.max(row, part.size.y);
  }
  // Centre the arrangement on the bed.
  const placed = parts.filter((p) => p.placed);
  if (placed.length > 0) {
    const maxX = Math.max(...placed.map((p) => p.position.x + p.size.x));
    const maxY = Math.max(...placed.map((p) => p.position.y + p.size.y));
    const dx = (bed.width - maxX) / 2;
    const dy = (bed.depth - maxY) / 2;
    for (const p of placed) {
      p.position = { x: p.position.x + dx, y: p.position.y + dy };
      p.mesh = translateMesh(p.mesh, dx, dy);
    }
  }

  const total = parts.reduce<PrintEstimate>(
    (sum, p) => ({
      volume: sum.volume + p.estimate.volume,
      plastic: sum.plastic + p.estimate.plastic,
      mass: sum.mass + p.estimate.mass,
      filament: sum.filament + p.estimate.filament,
      layers: Math.max(sum.layers, p.estimate.layers),
    }),
    { volume: 0, plastic: 0, mass: 0, filament: 0, layers: 0 },
  );
  return { parts, warnings, total, printer: settings.printer, material: settings.material };
}
