import type { HelpEntry } from "../help/types";

/**
 * The guide for AI agents that operate FabCAD through the screen (computer use): how the
 * screen is laid out, where the state can be read, how to enter exact values without precise
 * clicks, and recipes for common work. The reference of the tools is generated from the in-app
 * help (`help/content.ts`), so it changes with it. Pure functions; the build writes the result
 * to `llms.txt` and `agents/index.html` (`vite.config.ts`).
 */

type Block =
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { table: { head: string[]; rows: string[][] } };

interface Section {
  title: string;
  blocks: Block[];
  sub?: Section[];
}

const INTRO =
  "FabCAD is a parametric 3D CAD that runs in the browser, with a Fabrication Compiler that " +
  "turns bodies into laser-cut parts (SVG / DXF) or 3D-print layouts. This page is for AI " +
  "agents that use FabCAD through the screen, with mouse and keyboard.";

const SECTIONS: Section[] = [
  {
    title: "Opening the app",
    blocks: [
      { p: "The CAD is at /FabCAD/app/ (https://fooping-tech.github.io/FabCAD/app/). It needs no account; the project is saved automatically in the browser and comes back after a reload." },
      { p: "After the page opens, wait until the view shows neither \"Loading the geometry kernel\" nor \"Building the model\". The status bar at the bottom right then reads \"Ready\"." },
    ],
  },
  {
    title: "Screen layout",
    blocks: [
      {
        table: {
          head: ["Area", "Where", "What it is for"],
          rows: [
            ["Header", "top", "DESIGN / FABRICATION workspace switch, File menu (New, Open, Save, Import, Parameters), Undo / Redo, Save, Export"],
            ["Ribbon", "below the header", "the commands of the workspace, in labelled groups (SKETCH, CREATE, MODIFY, CONSTRAINTS …). Every button has a tooltip with its name and shortcut"],
            ["Browser", "left, upper half", "the tree of the document: Origin (XY / XZ / YZ planes, axes), Sketches, Bodies, Components. Rows can be clicked to select, and to pick a plane"],
            ["Properties", "left, lower half", "properties of the selection, and the Parameters of the document"],
            ["View", "centre", "the 3D view. In a sketch, a banner at the top centre shows the sketch name, its constraint status and Finish Sketch"],
            ["View buttons", "top right of the view", "Top, Front, Right, Bottom, Back, Left, Iso, Fit; Persp / Ortho"],
            ["Timeline", "bottom", "the history of the design, one item per feature. A red item has an error; hover it for the message. The copy button at its left copies the history log"],
            ["Status bar", "very bottom", "left: what the running command wants next. Right: cursor position in sketch coordinates (X … mm Y … mm), sketch status, Ready / Computing"],
          ],
        },
      },
    ],
  },
  {
    title: "Reading the state",
    blocks: [
      {
        list: [
          "The status bar hint (bottom left) always says what the running command expects: \"Pick the first corner\", \"Select a profile\" …",
          "In a sketch, the banner says \"Fully constrained\" or \"Under-constrained · N DOF\".",
          "Messages appear for a few seconds as toasts at the bottom centre.",
          "Command windows (Extrude, Offset, Fillet …) show their problem next to OK, e.g. \"Select a profile\"; OK stays disabled until it is solved.",
          "For a complete record, press the copy button at the left end of the timeline: it copies every step with its status, the size and make-up of each body, and the project as JSON.",
        ],
      },
    ],
  },
  {
    title: "Entering exact values",
    blocks: [
      { p: "Clicks on the canvas snap to points, midpoints, curves and a 1 mm grid, but exact geometry is easier to enter by typing:" },
      {
        list: [
          "Typed points: while a Create tool (Line, Rectangle, Circle, Arc, Spline …) runs in a sketch, type a digit and a Point box opens at the bottom of the view. Type `x, y` (absolute), `@dx, dy` (relative to the previous point) or `@length<angle` (polar, degrees), then Enter. The box stays open for the next point; Enter on an empty box finishes a polyline or spline; Esc closes the box. Values may be expressions with parameters (`width / 2, 10`).",
          "Dimensions: press D, click a line (or two points, a circle …), click empty space to place the dimension, type the value in the box that opens, Enter. A dimension can be edited later by double-clicking it.",
          "Feature values (Extrude distance, Fillet radius …) are typed in the command window; Enter in the window, or OK, applies the feature.",
          "Parameters: File → Parameters… defines named values that every field accepts.",
        ],
      },
    ],
  },
  {
    title: "Recipes",
    blocks: [],
    sub: [
      {
        title: "A plate 60 × 40 × 5 mm",
        blocks: [
          {
            steps: [
              "Press R. The status bar asks for a plane.",
              "In the Browser, click Origin to open it, then click \"XY Plane\". The sketch opens.",
              "Type `0, 0` Enter, then `@60, 40` Enter: a rectangle from the origin.",
              "Press Esc twice (closes the Point box, then ends the tool).",
              "Press E. The only profile of the sketch is preselected and the Extrude window opens.",
              "Type 5 in Distance, press Enter.",
            ],
          },
        ],
      },
      {
        title: "A hole through the plate",
        blocks: [
          {
            steps: [
              "Click the top face of the plate in the view, then press C: a sketch on that face starts with the Circle tool. (Or press C, then click the face.)",
              "Type the centre, e.g. `30, 20` Enter, then a point on the circle, `@4, 0` Enter: a circle of radius 4.",
              "Press Esc twice, then E. Click inside the circle to select its profile if it is not selected.",
              "In the Extrude window choose Flipped (into the plate): the operation turns to Cut by itself. Type 5, Enter.",
            ],
          },
        ],
      },
      {
        title: "Laser-cutting output",
        blocks: [
          {
            steps: [
              "Click FABRICATION in the header. Laser is the process selected at the top left.",
              "In MATERIAL on the left, set Thickness to the thickness of the plate (5): a flat part must be as thick as the material. Click into the field, select its text, type 5, Enter.",
              "The Parts and Sheet tabs at the top of the view show the parts and their layout on the sheet. A body that cannot be made into parts is listed as Unsupported, with the reason.",
              "Export → \"SVG — laser cutting\" (or DXF) downloads the file. When nothing can be cut, a message says why.",
            ],
          },
        ],
      },
    ],
  },
  {
    title: "Pitfalls",
    blocks: [
      {
        list: [
          "Esc works in steps: first it drops the picks of the command (or closes the Point box), then it ends the command, then it clears the selection.",
          "In a sketch with the Select tool, dragging moves geometry. Outside a sketch, left-drag orbits the view; right-drag orbits too, middle-drag pans, the wheel zooms. F6 (or Fit) brings everything into view.",
          "Shortcuts are single letters. They do nothing while a text field has the focus; click the view first if a letter is not taken.",
          "A sketch tool started outside a sketch asks for a plane first (a Browser plane row or a planar face).",
          "Command windows open beside the last click and can be dragged by their title bar if they cover something.",
          "Projected geometry (purple) follows the body it came from and cannot be dragged.",
        ],
      },
    ],
  },
];

const GROUPS: { prefix: string; title: string }[] = [
  { prefix: "sketch.modify.", title: "Sketch: modify" },
  { prefix: "constraint.", title: "Sketch: constraints" },
  { prefix: "sketch.", title: "Sketch: create and other commands" },
  { prefix: "solid.", title: "Solid: features" },
  { prefix: "fabrication.", title: "Fabrication" },
  { prefix: "", title: "General" },
];

function groupOf(id: string): string {
  return GROUPS.find((g) => id.startsWith(g.prefix))!.title;
}

function shortcuts(help: Record<string, HelpEntry>): Section {
  const rows = Object.values(help)
    .filter((e) => e.shortcut)
    .map((e) => [e.shortcut!, e.title]);
  rows.push(
    ["Enter", "OK of the command window; finish a polyline or spline"],
    ["Esc", "cancel, step by step"],
    ["F6", "Fit everything into view"],
    ["V", "show / hide the selection"],
    ["Delete", "delete the selection"],
    ["Ctrl/Cmd + Z, Ctrl/Cmd + Y", "Undo, Redo"],
    ["Ctrl/Cmd + S", "Save the project to a file"],
  );
  return { title: "Keyboard shortcuts", blocks: [{ table: { head: ["Key", "Command"], rows } }] };
}

function reference(help: Record<string, HelpEntry>): Section {
  const groups = new Map<string, Section>();
  for (const g of GROUPS) groups.set(g.title, { title: g.title, blocks: [] });
  const sub: Section[] = [];
  for (const [id, e] of Object.entries(help)) {
    const blocks: Block[] = [{ p: e.summary }];
    const items: string[] = [...e.what];
    if (e.requires?.length) items.push(...e.requires.map((r) => `Needs: ${r}`));
    for (const p of e.parameters ?? []) items.push(`${p.name}: ${p.text}`);
    for (const l of e.limitations ?? []) items.push(`Limitation: ${l}`);
    for (const x of e.examples ?? []) items.push(`Example: ${x}`);
    if (items.length > 0) blocks.push({ list: items });
    groups.get(groupOf(id))!.sub ??= [];
    groups.get(groupOf(id))!.sub!.push({
      title: `${e.title}${e.shortcut ? ` (${e.shortcut})` : ""}`,
      blocks,
    });
  }
  for (const g of groups.values()) if (g.sub?.length) sub.push(g);
  return {
    title: "Tool reference",
    blocks: [{ p: "Generated from the in-app help, which is also shown by right-clicking (or long-pressing) a tool icon." }],
    sub,
  };
}

function sections(help: Record<string, HelpEntry>): Section[] {
  return [...SECTIONS, shortcuts(help), reference(help)];
}

// ------------------------------------------------------------------ Markdown

function mdBlock(b: Block): string {
  if ("p" in b) return b.p;
  if ("list" in b) return b.list.map((x) => `- ${x}`).join("\n");
  if ("steps" in b) return b.steps.map((x, i) => `${i + 1}. ${x}`).join("\n");
  const cell = (c: string): string => c.replace(/\|/g, "\\|");
  return [
    `| ${b.table.head.map(cell).join(" | ")} |`,
    `| ${b.table.head.map(() => "---").join(" | ")} |`,
    ...b.table.rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ].join("\n");
}

function mdSection(s: Section, level: number): string {
  const parts = [`${"#".repeat(level)} ${s.title}`, ...s.blocks.map(mdBlock)];
  for (const c of s.sub ?? []) parts.push(mdSection(c, level + 1));
  return parts.join("\n\n");
}

/** The guide as Markdown, in the shape of an llms.txt file. */
export function agentGuideMarkdown(help: Record<string, HelpEntry>): string {
  return [
    "# FabCAD — guide for AI agents",
    `> ${INTRO}`,
    ...sections(help).map((s) => mdSection(s, 2)),
  ].join("\n\n") + "\n";
}

// ---------------------------------------------------------------------- HTML

const esc = (t: string): string =>
  t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Inline code in backticks; everything else as text. */
const inline = (t: string): string =>
  esc(t).replace(/`([^`]+)`/g, (_, code: string) => `<code>${code}</code>`);

function htmlBlock(b: Block): string {
  if ("p" in b) return `<p>${inline(b.p)}</p>`;
  if ("list" in b) return `<ul>${b.list.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`;
  if ("steps" in b) return `<ol>${b.steps.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`;
  return (
    `<div class="table"><table><thead><tr>${b.table.head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead>` +
    `<tbody>${b.table.rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
  );
}

const slug = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function htmlSection(s: Section, level: number): string {
  const h = Math.min(level, 6);
  return (
    `<section><h${h} id="${slug(s.title)}">${inline(s.title)}</h${h}>` +
    s.blocks.map(htmlBlock).join("") +
    (s.sub ?? []).map((c) => htmlSection(c, level + 1)).join("") +
    "</section>"
  );
}

/** The guide as a complete HTML page. */
export function agentGuideHtml(help: Record<string, HelpEntry>): string {
  const all = sections(help);
  const toc = all.map((s) => `<li><a href="#${slug(s.title)}">${inline(s.title)}</a></li>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FabCAD Agent Guide</title>
<meta name="description" content="How AI agents operate FabCAD through the screen: layout, state, exact input, recipes and the reference of every tool." />
<link rel="alternate" type="text/markdown" href="../llms.txt" />
<style>
:root { --ink: #1d2b38; --soft: #5a6773; --line: #dfe4e8; --bg: #f7f8f9; --accent: #3d7fb8; color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 860px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 28px; margin: 0 0 8px; }
h2 { font-size: 21px; margin: 40px 0 10px; padding-top: 8px; border-top: 1px solid var(--line); }
h3 { font-size: 17px; margin: 24px 0 6px; }
h4 { font-size: 15px; margin: 18px 0 4px; }
p, li { color: var(--ink); }
.lead { color: var(--soft); font-size: 16px; }
a { color: var(--accent); }
code { font: 13px ui-monospace, SFMono-Regular, Menlo, monospace; background: #eef1f4; padding: 1px 5px; border-radius: 4px; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 14px; background: #fff; }
th, td { border: 1px solid var(--line); padding: 6px 9px; text-align: left; vertical-align: top; }
th { background: #eef1f4; }
nav ol { columns: 2; padding-left: 20px; }
.links { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0 0; }
@media (max-width: 600px) { nav ol { columns: 1; } }
</style>
</head>
<body>
<main>
<h1>FabCAD — guide for AI agents</h1>
<p class="lead">${inline(INTRO)}</p>
<p class="links"><a href="../app/">Open FabCAD</a><a href="../llms.txt">This guide as Markdown (llms.txt)</a><a href="../">About FabCAD</a></p>
<nav aria-label="Contents"><ol>${toc}</ol></nav>
${all.map((s) => htmlSection(s, 2)).join("\n")}
</main>
</body>
</html>
`;
}
