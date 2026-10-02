import { describe, expect, it } from "vitest";
import { searchCommands } from "../src/app/commandSearch";

const items = [
  { id: "line", label: "Line", group: "Sketch: create", shortcut: "L" },
  { id: "polyline", label: "Polyline", group: "Sketch: create" },
  { id: "extrude", label: "Extrude", group: "Solid", shortcut: "E" },
  { id: "rect-pattern", label: "Rectangular Pattern", group: "Solid" },
  { id: "svg", label: "Export SVG — laser cutting", group: "Export", keywords: "download file" },
  { id: "top", label: "View: Top", group: "View" },
];
const ids = (q: string) => searchCommands(items, q).map((i) => i.id);

describe("command palette search", () => {
  it("lists everything for an empty query, in order", () => {
    expect(ids("")).toEqual(items.map((i) => i.id));
  });

  it("puts names that start with the query first", () => {
    expect(ids("line")).toEqual(["line", "polyline"]);
    expect(ids("ex")).toEqual(["extrude", "svg"]);
  });

  it("needs every word, found in the name, group or keywords", () => {
    expect(ids("pattern rect")).toEqual(["rect-pattern"]);
    expect(ids("download")).toEqual(["svg"]);
    expect(ids("view top")).toEqual(["top"]);
    expect(ids("sketch circle")).toEqual([]);
  });

  it("ignores case and full-width letters", () => {
    expect(ids("ＥＸＴＲＵＤＥ")).toEqual(["extrude"]);
  });
});
