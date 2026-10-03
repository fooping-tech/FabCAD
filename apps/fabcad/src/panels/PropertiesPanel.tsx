import {
  FEATURE_LABELS,
  type Feature,
  featureExpressions,
  formatQuantity,
  setFeatureSuppressed,
  updateFeature,
  componentContents,
  listComponents,
  listInstances,
} from "@fabcad/cad-document";
import { dist2 } from "@fabcad/geometry";
import {
  type Sketch,
  type SketchEntity,
  editSketch,
  getPoint,
  measureDimension,
  toggleConstruction,
} from "@fabcad/sketch";
import type { ReactElement, ReactNode } from "react";
import {
  deleteSelection,
  editFeature,
  enterSketch,
  openDialog,
  startSketchOnPlane,
} from "../app/actions";
import { type Selection, appState } from "../app/appState";
import {
  editSketchSolved,
  modelState,
  parameterEvaluation,
  run,
  sketchView,
  useDocument,
} from "../app/session";
import { useStore } from "../app/tinyStore";
import { anglesFromQuaternion } from "@fabcad/assembly";
import {
  activateComponent,
  newInstance,
  openInstanceMove,
  openNewComponent,
  useActiveComponentId,
} from "../app/components";
import { CONSTRAINT_TOOLS } from "../sketch/constraintTools";
import { exportSketchDxf, exportSketchSvg } from "../sketch/exportSketch";
import { ExpressionInput } from "./ExpressionInput";

const n = (v: number, digits = 3): string => {
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, "") || "0";
};

function KV({ rows }: { rows: [string, ReactNode][] }): ReactElement {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function entityRows(sketch: Sketch, e: SketchEntity): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [["Type", e.type[0]!.toUpperCase() + e.type.slice(1)]];
  switch (e.type) {
    case "point":
      rows.push(["X", `${n(e.x)} mm`], ["Y", `${n(e.y)} mm`]);
      break;
    case "line": {
      const a = getPoint(sketch, e.p1);
      const b = getPoint(sketch, e.p2);
      rows.push(
        ["Length", `${n(dist2(a, b))} mm`],
        ["Angle", `${n((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI, 2)}°`],
      );
      break;
    }
    case "circle":
      rows.push(["Radius", `${n(e.radius)} mm`], ["Diameter", `${n(e.radius * 2)} mm`]);
      break;
    case "arc": {
      const c = getPoint(sketch, e.center);
      const s = getPoint(sketch, e.start);
      const en = getPoint(sketch, e.end);
      const r = dist2(c, s);
      let sweep = Math.atan2(en.y - c.y, en.x - c.x) - Math.atan2(s.y - c.y, s.x - c.x);
      if (sweep <= 0) sweep += Math.PI * 2;
      rows.push(
        ["Radius", `${n(r)} mm`],
        ["Sweep", `${n((sweep * 180) / Math.PI, 2)}°`],
        ["Length", `${n(r * sweep)} mm`],
      );
      break;
    }
    case "ellipse": {
      const c = getPoint(sketch, e.center);
      rows.push(
        ["Major radius", `${n(dist2(c, getPoint(sketch, e.majorPoint)))} mm`],
        ["Minor radius", `${n(e.minorRadius)} mm`],
      );
      break;
    }
    case "spline":
      rows.push(["Kind", e.kind === "fit" ? "Fit points" : "Control points"], ["Points", e.points.length]);
      break;
  }
  return rows;
}

function SketchSelection({
  sketchId,
  sketch,
  selection,
}: {
  sketchId: string;
  sketch: Sketch;
  selection: Selection[];
}): ReactElement {
  const first = selection[0]!;
  if (selection.length > 1) {
    const ids = selection.flatMap((s) => (s.kind === "entity" ? [s.entityId] : []));
    return (
      <>
        <p className="empty" style={{ padding: "2px 0 8px" }}>
          {selection.length} objects selected. Pick a constraint in the toolbar to relate them.
        </p>
        <div className="form-actions" style={{ justifyContent: "flex-start", marginTop: 0 }}>
          {ids.length > 0 && (
            <button
              className="btn small"
              onClick={() =>
                editSketchSolved(sketchId, "Normal / Construction", (s) => toggleConstruction(s, ids))
              }
            >
              Toggle construction
            </button>
          )}
          <button className="btn small danger" onClick={deleteSelection}>
            Delete
          </button>
        </div>
      </>
    );
  }
  if (first.kind === "entity") {
    const e = sketch.entities[first.entityId];
    if (!e) return <p className="empty">The selected object no longer exists.</p>;
    const related = Object.values(sketch.constraints).filter((c) => c.refs.includes(e.id));
    return (
      <>
        <KV rows={entityRows(sketch, e)} />
        {e.type !== "point" && (
          <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8 }}>
            <input
              type="checkbox"
              checked={!!e.construction}
              onChange={() =>
                editSketchSolved(sketchId, "Normal / Construction", (s) => toggleConstruction(s, [e.id]))
              }
            />
            Construction geometry
          </label>
        )}
        {related.length > 0 && (
          <>
            <div className="form-section">Constraints</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {related.map((c) => (
                <button
                  key={c.id}
                  className="badge"
                  style={{ border: 0 }}
                  title="Select this constraint"
                  onClick={() =>
                    appState.set({ selection: [{ kind: "constraint", sketchId, id: c.id }] })
                  }
                >
                  {CONSTRAINT_TOOLS.find((t) => t.type === c.type)?.label ?? c.type}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="form-actions">
          <button className="btn small danger" onClick={deleteSelection}>
            Delete
          </button>
        </div>
      </>
    );
  }
  if (first.kind === "dimension") {
    const d = sketch.dimensions[first.id];
    if (!d) return <p className="empty">The selected dimension no longer exists.</p>;
    const measured = measureDimension(sketch, d);
    return (
      <div className="form">
        <KV
          rows={[
            ["Type", d.type],
            ["Measured", measured === null ? "—" : `${n(measured)} ${d.type === "angle" ? "°" : "mm"}`],
          ]}
        />
        <div className="field" style={{ alignItems: "start", marginTop: 4 }}>
          <span className="label" style={{ paddingTop: 5 }}>
            Value
          </span>
          <ExpressionInput
            label="Dimension value"
            kind={d.type === "angle" ? "angle" : "length"}
            value={d.expression}
            onChange={(expression) =>
              editSketchSolved(
                sketchId,
                "Edit dimension",
                (s) => ({
                  ...s,
                  dimensions: { ...s.dimensions, [d.id]: { ...d, expression } },
                }),
                { rejectOverConstrained: true },
              )
            }
          />
        </div>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={d.driving}
            onChange={(e) =>
              editSketchSolved(
                sketchId,
                e.target.checked ? "Make driving" : "Make driven",
                (s) => ({
                  ...s,
                  dimensions: { ...s.dimensions, [d.id]: { ...d, driving: e.target.checked } },
                }),
                { rejectOverConstrained: true },
              )
            }
          />
          Driving dimension
        </label>
        <div className="form-actions">
          <button className="btn small danger" onClick={deleteSelection}>
            Delete
          </button>
        </div>
      </div>
    );
  }
  if (first.kind === "constraint") {
    const c = sketch.constraints[first.id];
    if (!c) return <p className="empty">The selected constraint no longer exists.</p>;
    return (
      <>
        <KV
          rows={[
            ["Constraint", CONSTRAINT_TOOLS.find((t) => t.type === c.type)?.label ?? c.type],
            ["References", c.refs.length],
          ]}
        />
        <div className="form-actions">
          <button
            className="btn small"
            onClick={() =>
              appState.set({
                selection: c.refs.map((entityId) => ({ kind: "entity", sketchId, entityId })),
              })
            }
          >
            Select geometry
          </button>
          <button
            className="btn small danger"
            onClick={() => {
              editSketchSolved(sketchId, "Delete constraint", (s) =>
                editSketch(s, (b) => b.removeConstraint(c.id)),
              );
              appState.set({ selection: [] });
            }}
          >
            Delete
          </button>
        </div>
      </>
    );
  }
  if (first.kind === "profile") {
    const region = sketchView(sketch).regions.find((r) => r.id === first.regionId);
    return (
      <>
        <KV
          rows={[
            ["Type", "Profile"],
            ["Area", region ? `${n(region.area, 2)} mm²` : "—"],
            ["Holes", region ? region.holePolygons.length : 0],
          ]}
        />
        <div className="form-actions">
          <button className="btn small accent" onClick={() => openDialog("extrude")}>
            Extrude
          </button>
        </div>
      </>
    );
  }
  return <p className="empty">Nothing to show.</p>;
}

function FeatureProperties({ feature }: { feature: Feature }): ReactElement {
  const status = useStore(modelState, (s) => s.features[feature.id]);
  const expressions = feature.type === "sketch" ? [] : featureExpressions(feature);
  return (
    <div className="form">
      <KV
        rows={[
          ["Feature", FEATURE_LABELS[feature.type]],
          ["Name", feature.name],
          [
            "Status",
            feature.suppressed ? (
              <span className="badge">Suppressed</span>
            ) : status?.state === "error" ? (
              <span className="badge danger">Error</span>
            ) : status?.state === "rolled-back" ? (
              <span className="badge">Rolled back</span>
            ) : (
              <span className="badge ok">OK</span>
            ),
          ],
        ]}
      />
      {status?.message && <div className="warning-item error">{status.message}</div>}
      {feature.type === "sketch" && (
        <KV
          rows={[
            ["Entities", Object.keys(feature.sketch.entities).length],
            ["Constraints", Object.keys(feature.sketch.constraints).length],
            ["Dimensions", Object.keys(feature.sketch.dimensions).length],
            ["Profiles", sketchView(feature.sketch).regions.length],
          ]}
        />
      )}
      {expressions.map((e) => (
        <div className="field" key={e.key} style={{ alignItems: "start" }}>
          <span className="label" style={{ paddingTop: 5, textTransform: "capitalize" }}>
            {e.key}
          </span>
          <ExpressionInput
            label={e.key}
            kind={e.kind}
            value={e.expression}
            onChange={(value) =>
              run(updateFeature(feature.id, { [e.key]: value } as never, `Edit ${feature.name}`))
            }
          />
        </div>
      ))}
      <div className="form-actions">
        {feature.type === "offset-plane" && (
          <button className="btn small" onClick={() => startSketchOnPlane(feature.id)}>
            Create Sketch
          </button>
        )}
        {feature.type === "sketch" && (
          <>
            <button className="btn small" onClick={() => exportSketchSvg(feature.id)}>
              SVG
            </button>
            <button className="btn small" onClick={() => exportSketchDxf(feature.id)}>
              DXF
            </button>
          </>
        )}
        <button
          className="btn small"
          onClick={() => run(setFeatureSuppressed(feature.id, !feature.suppressed))}
        >
          {feature.suppressed ? "Unsuppress" : "Suppress"}
        </button>
        <button className="btn small danger" onClick={deleteSelection}>
          Delete
        </button>
        <button className="btn small accent" onClick={() => editFeature(feature.id)}>
          Edit
        </button>
      </div>
    </div>
  );
}

/** A component definition or one of its instances. */
function ComponentSelection({
  selection,
}: {
  selection: Extract<Selection, { kind: "component" | "instance" }>;
}): ReactElement {
  const doc = useDocument();
  const active = useActiveComponentId();
  const instance =
    selection.kind === "instance" ? doc.assembly.instances[selection.instanceId] : undefined;
  const componentId = selection.kind === "component" ? selection.componentId : instance?.componentId;
  const component = componentId ? doc.assembly.components[componentId] : undefined;
  if (!component) return <p className="empty">Nothing to show.</p>;
  const contents = componentContents(doc, component.id);
  if (component.id === doc.assembly.rootComponentId) {
    return (
      <>
        <KV
          rows={[
            ["Component", `${doc.name} (root)`],
            ["Components", listComponents(doc).length],
            ["Sketches", contents.sketchIds.length],
            ["Bodies", contents.bodyIds.length],
          ]}
        />
        <div className="form-actions" style={{ flexWrap: "wrap" }}>
          <button className="btn small" onClick={openNewComponent}>
            New Component
          </button>
          {active !== component.id && (
            <button className="btn small accent" onClick={() => activateComponent(null)}>
              Activate Root
            </button>
          )}
        </div>
      </>
    );
  }
  const rows: [string, ReactNode][] =
    selection.kind === "component"
      ? [
          ["Component", component.name],
          ["Instances", listInstances(doc, component.id).length],
          ["Sketches", contents.sketchIds.length],
          ["Features", contents.featureIds.length - contents.sketchIds.length],
          ["Bodies", contents.bodyIds.length],
        ]
      : [
          ["Instance", instance!.name],
          ["Component", component.name],
          ["Position", `${instance!.transform.position.map((v) => n(v, 2)).join(", ")} mm`],
          ["Rotation", `${anglesFromQuaternion(instance!.transform.rotation).map((v) => n(v, 2)).join(", ")} deg`],
        ];
  return (
    <>
      <KV rows={rows} />
      <div className="form-actions" style={{ flexWrap: "wrap" }}>
        {selection.kind === "instance" && (
          <button className="btn small" onClick={() => openInstanceMove(selection.instanceId)}>
            Move / Rotate
          </button>
        )}
        <button className="btn small" onClick={() => newInstance(component.id)}>
          Create Instance
        </button>
        {active === component.id ? (
          <button className="btn small accent" onClick={() => activateComponent(null)}>
            Activate Root
          </button>
        ) : (
          <button className="btn small accent" onClick={() => activateComponent(component.id)}>
            Activate
          </button>
        )}
      </div>
    </>
  );
}

function ModelSelection({ selection }: { selection: Selection }): ReactElement {
  const doc = useDocument();
  const bodies = useStore(modelState, (s) => s.bodies);
  if (selection.kind === "component" || selection.kind === "instance") {
    return <ComponentSelection selection={selection} />;
  }
  if (selection.kind === "feature" || selection.kind === "plane") {
    const f = doc.features[selection.featureId];
    return f ? <FeatureProperties feature={f} /> : <p className="empty">Nothing to show.</p>;
  }
  if (selection.kind === "origin-plane") {
    return (
      <>
        <KV rows={[["Type", "Origin plane"], ["Plane", selection.plane]]} />
        <div className="form-actions">
          <button className="btn small accent" onClick={() => openDialog("pick-sketch-plane")}>
            Create Sketch
          </button>
        </div>
      </>
    );
  }
  if (selection.kind === "entity") {
    const f = doc.features[selection.sketchId];
    const e = f?.type === "sketch" ? f.sketch.entities[selection.entityId] : undefined;
    if (f?.type !== "sketch" || !e) return <p className="empty">Nothing to show.</p>;
    return (
      <>
        <KV rows={[["Sketch", f.name], ...entityRows(f.sketch, e)]} />
        <div className="form-actions">
          <button className="btn small accent" onClick={() => enterSketch(f.id)}>
            Edit Sketch
          </button>
        </div>
      </>
    );
  }
  if (selection.kind === "profile") {
    const f = doc.features[selection.sketchId];
    if (f?.type !== "sketch") return <p className="empty">Nothing to show.</p>;
    return <SketchSelection sketchId={f.id} sketch={f.sketch} selection={[selection]} />;
  }
  if (!("bodyId" in selection)) return <p className="empty">Nothing to show.</p>;
  const record = doc.bodies[selection.bodyId];
  const g = bodies[selection.bodyId]?.geometry;
  const rows: [string, ReactNode][] = [["Body", record?.name ?? "—"]];
  if (selection.kind === "body" && g) {
    rows.push(
      ["Volume", `${n(g.volume, 2)} mm³`],
      ["Area", `${n(g.area, 2)} mm²`],
      [
        "Size",
        `${n(g.bounds.max.x - g.bounds.min.x, 2)} × ${n(g.bounds.max.y - g.bounds.min.y, 2)} × ${n(
          g.bounds.max.z - g.bounds.min.z,
          2,
        )} mm`,
      ],
      ["Faces", g.faces.length],
      ["Edges", g.edges.length],
    );
  } else if (selection.kind === "face") {
    const face = g?.faces[selection.faceIndex];
    rows.push(
      ["Type", "Face"],
      ["Surface", face?.surface ?? "—"],
      ["Normal", `${n(selection.normal.x, 3)}, ${n(selection.normal.y, 3)}, ${n(selection.normal.z, 3)}`],
    );
  } else if (selection.kind === "edge") {
    const edge = g?.edges[selection.edgeIndex];
    rows.push(["Type", "Edge"], ["Curve", edge?.curve ?? "—"], ["Length", edge ? `${n(edge.length)} mm` : "—"]);
  } else if (selection.kind === "vertex") {
    rows.push(
      ["Type", "Vertex"],
      ["X", `${n(selection.point.x)} mm`],
      ["Y", `${n(selection.point.y)} mm`],
      ["Z", `${n(selection.point.z)} mm`],
    );
  }
  return (
    <>
      <KV rows={rows} />
      <div className="form-actions">
        {selection.kind === "face" && selection.planar && (
          <button className="btn small accent" onClick={() => openDialog("pick-sketch-plane")}>
            Create Sketch
          </button>
        )}
        {selection.kind === "edge" && (
          <>
            <button className="btn small" onClick={() => openDialog("chamfer")}>
              Chamfer
            </button>
            <button className="btn small accent" onClick={() => openDialog("fillet")}>
              Fillet
            </button>
          </>
        )}
        {selection.kind === "face" && (
          <button className="btn small" onClick={() => openDialog("shell")}>
            Shell
          </button>
        )}
        {selection.kind === "body" && (
          <button className="btn small danger" onClick={deleteSelection}>
            Delete
          </button>
        )}
      </div>
    </>
  );
}

function Overview(): ReactElement {
  const doc = useDocument();
  const evaluation = parameterEvaluation(doc);
  const sketching = useStore(appState, (s) => s.activeSketchId !== null);
  return (
    <>
      {sketching ? (
        <p className="empty" style={{ padding: "2px 0 6px" }}>
          Draw with the Create tools, relate geometry with Constraints and size it with Dimension
          (D). Dimension values accept parameter expressions.
        </p>
      ) : (
        <p className="empty" style={{ padding: "2px 0 6px" }}>
          Select something to see its properties.
        </p>
      )}
      <div className="form-section" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>Parameters</span>
        <button
          className="btn small"
          style={{ textTransform: "none", letterSpacing: 0, marginTop: -4 }}
          onClick={() => openDialog("parameters")}
        >
          Edit…
        </button>
      </div>
      {doc.parameters.length === 0 ? (
        <p className="empty" style={{ padding: "2px 0" }}>
          No parameters yet.
        </p>
      ) : (
        <KV
          rows={doc.parameters.map((p) => {
            const v = evaluation.values[p.name];
            return [
              p.name,
              evaluation.errors[p.id] ? (
                <span className="badge danger" title={evaluation.errors[p.id]}>
                  Error
                </span>
              ) : v ? (
                formatQuantity(v, 3)
              ) : (
                "—"
              ),
            ];
          })}
        />
      )}
    </>
  );
}

export function PropertiesPanel(): ReactElement {
  const doc = useDocument();
  const selection = useStore(appState, (s) => s.selection);
  const activeSketchId = useStore(appState, (s) => s.activeSketchId);
  const active = activeSketchId ? doc.features[activeSketchId] : undefined;
  const first = selection[0];

  let body: ReactNode;
  if (!first) body = <Overview />;
  else if (active?.type === "sketch") {
    body = <SketchSelection sketchId={active.id} sketch={active.sketch} selection={selection} />;
  } else if (selection.length > 1) {
    body = (
      <>
        <p className="empty" style={{ padding: "2px 0 8px" }}>
          {selection.length} objects selected.
        </p>
        <div className="form-actions" style={{ justifyContent: "flex-start", marginTop: 0 }}>
          {selection.every((s) => s.kind === "edge") && (
            <>
              <button className="btn small" onClick={() => openDialog("chamfer")}>
                Chamfer
              </button>
              <button className="btn small accent" onClick={() => openDialog("fillet")}>
                Fillet
              </button>
            </>
          )}
          {selection.every((s) => s.kind === "profile") && (
            <button className="btn small accent" onClick={() => openDialog("extrude")}>
              Extrude
            </button>
          )}
          {selection.every((s) => s.kind === "body") && (
            <button className="btn small accent" onClick={() => openDialog("combine")}>
              Combine
            </button>
          )}
          {selection.some((s) => s.kind === "feature" || s.kind === "body") && (
            <button className="btn small danger" onClick={deleteSelection}>
              Delete
            </button>
          )}
        </div>
      </>
    );
  } else body = <ModelSelection selection={first} />;

  return (
    <div className="panel grow">
      <div className="panel-title">Properties</div>
      <div className="panel-body padded">{body}</div>
    </div>
  );
}
