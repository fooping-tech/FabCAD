import { describe, expect, it } from "vitest";
import { agentGuideHtml, agentGuideMarkdown } from "../src/agents/guide";
import { HELP } from "../src/help/content";

describe("guide for AI agents", () => {
  const md = agentGuideMarkdown(HELP);
  const html = agentGuideHtml(HELP);

  it("is an llms.txt: a title, a summary, then sections", () => {
    expect(md.startsWith("# FabCAD — guide for AI agents\n\n> ")).toBe(true);
    for (const title of ["Screen layout", "Entering exact values", "Running commands by name", "Recipes", "Keyboard shortcuts", "Tool reference"]) {
      expect(md).toContain(`## ${title}`);
    }
  });

  it("lists every tool of the in-app help, with its shortcut", () => {
    for (const e of Object.values(HELP)) {
      expect(md).toContain(`${e.title}${e.shortcut ? ` (${e.shortcut})` : ""}`);
      expect(md).toContain(e.summary);
    }
    expect(md).toContain("| E | Extrude |");
  });

  it("says how to reach the editor without the browser's Back button", () => {
    expect(md).toContain("https://fooping-tech.github.io/FabCAD/app/");
    expect(md).toContain("FabCADを開く");
    expect(md).toContain("top right of the page header");
    expect(md).toContain("Do not use the browser's Back button");
    expect(md).toContain("not an error of FabCAD");
    expect(md).toContain("```text\n");
    expect(html).toContain("<pre>Introduction page");
  });

  it("is a complete HTML page with the same content, escaped", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>FabCAD Agent Guide</title>");
    expect(html).toContain("<code>@length&lt;angle</code>");
    expect(html).not.toContain("<angle");
  });
});
