import { describe, expect, it } from "vitest";
import {
  type CreatedRef,
  DocumentStore,
  addExtrude,
  addSketch,
  createDocument,
  deserializeDocument,
  serializeDocument,
  updateSketch,
} from "@fabcad/cad-document";
import { createRectangle2Point, detectProfiles, editSketch, profileRefOf } from "@fabcad/sketch";
import {
  SHARE_LINK_LIMIT,
  ShareLinkError,
  decodeShareFragment,
  encodeShareFragment,
  isShareFragment,
  makeShareLink,
} from "../src/app/shareLink";

const BASE = "https://fooping-tech.github.io/FabCAD/app/";

function plate(): DocumentStore {
  const store = new DocumentStore(createDocument("Plate"));
  const s: CreatedRef = {};
  store.execute(addSketch({ type: "origin", plane: "XY" }, s));
  store.execute(
    updateSketch(s.id!, "Rect", (k) =>
      editSketch(k, (b) => {
        createRectangle2Point(b, { x: 0, y: 0 }, { x: 60, y: 40 });
      }),
    ),
  );
  const sketch = store.document.features[s.id!];
  if (sketch?.type !== "sketch") throw new Error("no sketch");
  const region = detectProfiles(sketch.sketch)[0]!;
  store.execute(addExtrude({ sketchId: s.id!, profiles: [profileRefOf(region)], distance: "5" }));
  return store;
}

describe("share links", () => {
  it("carry the project in the fragment and give it back as it was", async () => {
    const doc = plate().document;
    const link = await makeShareLink(`${BASE}#old`, serializeDocument(doc, false));
    if (!link.ok) throw new Error("no link");
    const url = new URL(link.url);
    expect(url.origin + url.pathname).toBe(BASE);
    // Everything about the model is in the fragment, which is not sent to the server.
    expect(url.search).toBe("");
    expect(isShareFragment(url.hash)).toBe(true);
    const back = deserializeDocument(await decodeShareFragment(url.hash));
    expect(back.features).toEqual(doc.features);
    expect(back.timeline).toEqual(doc.timeline);
    expect(back.bodies).toEqual(doc.bodies);
    expect(back.name).toBe("Plate");
  });

  it("keeps text other than ASCII", async () => {
    const json = JSON.stringify({ name: "箱 — Ø8 ✓" });
    expect(await decodeShareFragment(await encodeShareFragment(json))).toBe(json);
  });

  it("refuses a link longer than 1 MiB, before and after it is made", async () => {
    // Random text hardly compresses.
    let noise = "";
    let seed = 1;
    while (noise.length < SHARE_LINK_LIMIT * 1.2) {
      seed = (seed * 16807) % 2147483647;
      noise += seed.toString(36);
    }
    const made = await makeShareLink(BASE, noise);
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.length).toBeGreaterThan(SHARE_LINK_LIMIT);
    await expect(decodeShareFragment(`#project=v1.${"A".repeat(SHARE_LINK_LIMIT)}`)).rejects.toThrow(/1 MiB/);
  });

  it("says why a damaged or newer link cannot be opened", async () => {
    const good = await encodeShareFragment(serializeDocument(plate().document, false));
    // Keep the Base64url payload decodable so the failure is specifically a truncated DEFLATE stream.
    const cut = good.slice(0, -4);
    await expect(decodeShareFragment(cut)).rejects.toThrow(ShareLinkError);
    await expect(decodeShareFragment(cut)).rejects.toThrow(/cut off/);
    await expect(decodeShareFragment("#project=v1.%%%")).rejects.toThrow(/damaged/);
    await expect(decodeShareFragment("#project=v9.AAAA")).rejects.toThrow(/newer version/);
    await expect(decodeShareFragment("#project=garbage")).rejects.toThrow(/damaged/);
    expect(isShareFragment("#section")).toBe(false);
    expect(isShareFragment("")).toBe(false);
  });
});
