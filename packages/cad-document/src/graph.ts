import type { CadDocument } from "./document";
import { listFeatures } from "./document";
import { expressionReferences } from "./expression";
import {
  featureExpressions,
  featureInputBodies,
  featureInputSketches,
  featureOutputBodies,
} from "./features";
import { evaluateParameters } from "./parameters";

/**
 * Dependency graph over parameters and features. Node ids are `param:<name>` and
 * `feature:<id>`. An edge A → B means "B depends on A".
 */
export interface DependencyGraph {
  nodes: string[];
  /** For each node, the nodes it depends on. */
  dependsOn: Map<string, Set<string>>;
  /** For each node, the nodes that depend on it. */
  dependents: Map<string, Set<string>>;
}

export const paramNode = (name: string): string => `param:${name}`;
export const featureNode = (id: string): string => `feature:${id}`;

export function buildDependencyGraph(doc: CadDocument): DependencyGraph {
  const graph: DependencyGraph = { nodes: [], dependsOn: new Map(), dependents: new Map() };
  const addNode = (n: string): void => {
    if (graph.dependsOn.has(n)) return;
    graph.nodes.push(n);
    graph.dependsOn.set(n, new Set());
    graph.dependents.set(n, new Set());
  };
  const addEdge = (from: string, to: string): void => {
    addNode(from);
    addNode(to);
    graph.dependsOn.get(to)!.add(from);
    graph.dependents.get(from)!.add(to);
  };

  const evaluation = evaluateParameters(doc.parameters);
  for (const p of doc.parameters) {
    addNode(paramNode(p.name));
    for (const dep of evaluation.dependencies[p.name] ?? expressionReferences(p.expression)) {
      addEdge(paramNode(dep), paramNode(p.name));
    }
  }

  // The last feature that wrote each body, while walking the timeline in order.
  const lastWriter = new Map<string, string>();
  for (const f of listFeatures(doc)) {
    const node = featureNode(f.id);
    addNode(node);
    for (const e of featureExpressions(f)) {
      for (const ref of expressionReferences(e.expression)) addEdge(paramNode(ref), node);
    }
    for (const s of featureInputSketches(f)) addEdge(featureNode(s), node);
    for (const b of featureInputBodies(f)) {
      const writer = lastWriter.get(b);
      if (writer) addEdge(featureNode(writer), node);
    }
    for (const b of featureOutputBodies(f)) lastWriter.set(b, f.id);
  }
  return graph;
}

/** All nodes reachable downstream of the given nodes, including the start nodes. */
export function downstream(graph: DependencyGraph, start: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const d of graph.dependents.get(n) ?? []) stack.push(d);
  }
  return seen;
}

/** Feature ids that must be recomputed after the given changes, in timeline order. */
export function affectedFeatures(
  doc: CadDocument,
  changed: { parameters?: string[]; features?: string[] },
): string[] {
  const graph = buildDependencyGraph(doc);
  const start = [
    ...(changed.parameters ?? []).map(paramNode),
    ...(changed.features ?? []).map(featureNode),
  ];
  const hit = downstream(graph, start);
  return doc.timeline.filter((id) => hit.has(featureNode(id)));
}

/** Topological order of the graph (dependencies first). Throws on cycles. */
export function topologicalOrder(graph: DependencyGraph): string[] {
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (n: string): void => {
    const s = state.get(n);
    if (s === 2) return;
    if (s === 1) throw new Error(`Dependency cycle at ${n}`);
    state.set(n, 1);
    for (const d of graph.dependsOn.get(n) ?? []) visit(d);
    state.set(n, 2);
    order.push(n);
  };
  for (const n of graph.nodes) visit(n);
  return order;
}
