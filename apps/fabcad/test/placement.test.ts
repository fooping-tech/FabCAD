import { describe, expect, it } from "vitest";
import { type Box, clampInto, placeBeside, placeMenu } from "../src/ui/placement";

/** A phone in portrait: 390 × 844, with a 6 px margin taken off. */
const phone: Box = { left: 6, top: 6, right: 384, bottom: 838 };
const desktop: Box = { left: 6, top: 6, right: 1434, bottom: 894 };

const button = (left: number, top: number, size = 42): Box => ({
  left,
  top,
  right: left + size,
  bottom: top + size,
});

const inside = (p: { left: number; top: number }, size: { width: number; height: number }, v: Box) => {
  expect(p.left).toBeGreaterThanOrEqual(v.left);
  expect(p.top).toBeGreaterThanOrEqual(v.top);
  expect(p.left + size.width).toBeLessThanOrEqual(v.right + 1e-9);
  expect(p.top + size.height).toBeLessThanOrEqual(v.bottom + 1e-9);
};

describe("placeMenu", () => {
  it("opens below its button, lined up with it, when there is room", () => {
    const p = placeMenu(button(300, 60, 34), { width: 190, height: 80 }, desktop);
    expect(p).toMatchObject({ side: "below", left: 300, top: 98 });
    expect(p.maxHeight).toBeGreaterThanOrEqual(80);
  });

  it("lines up with the right edge when asked to", () => {
    const p = placeMenu(button(1300, 10, 60), { width: 200, height: 120 }, desktop, { align: "right" });
    expect(p.left).toBe(1160);
  });

  it("flips above a button near the bottom of the screen", () => {
    const size = { width: 200, height: 96 };
    const p = placeMenu(button(320, 780), size, phone);
    expect(p.side).toBe("above");
    expect(p.top + size.height).toBeLessThanOrEqual(780 - 4);
    inside(p, size, phone);
  });

  it("shifts sideways to stay on a narrow screen", () => {
    const size = { width: 200, height: 96 };
    const p = placeMenu(button(340, 110), size, phone);
    expect(p.left).toBe(phone.right - size.width);
    inside(p, size, phone);
    const q = placeMenu(button(-30, 110), size, phone);
    expect(q.left).toBe(phone.left);
  });

  it("takes the side with more room and scrolls when the menu is taller than both", () => {
    const size = { width: 214, height: 900 };
    const low = placeMenu(button(10, 600), size, phone);
    expect(low.side).toBe("above");
    expect(low.maxHeight).toBe(600 - 4 - phone.top);
    expect(low.top).toBe(phone.top);
    const high = placeMenu(button(10, 110), size, phone);
    expect(high.side).toBe("below");
    expect(high.top).toBe(156);
    expect(high.top + high.maxHeight).toBe(phone.bottom);
  });

  it("stays inside the area left by an on-screen keyboard or a scrolled page", () => {
    // Visual viewport of a phone whose page was scrolled up by the browser: the ribbon button
    // is above what can be seen.
    const visible: Box = { left: 6, top: 206, right: 384, bottom: 638 };
    const size = { width: 200, height: 96 };
    const p = placeMenu(button(320, 110), size, visible);
    inside(p, size, visible);
    // With the button below what can be seen, too.
    const q = placeMenu(button(320, 700), size, visible);
    inside(q, size, visible);
  });

  it("places a context menu at the pointer, and above it near the bottom", () => {
    const size = { width: 214, height: 300 };
    const at = (x: number, y: number): Box => ({ left: x, top: y, right: x, bottom: y });
    expect(placeMenu(at(200, 200), size, desktop, { gap: 0 })).toMatchObject({ left: 200, top: 200 });
    const low = placeMenu(at(200, 800), size, desktop, { gap: 0 });
    expect(low.side).toBe("above");
    expect(low.top).toBe(500);
    const corner = placeMenu(at(1430, 890), size, desktop, { gap: 0 });
    inside(corner, size, desktop);
  });

  it("never reports more room than the screen has", () => {
    const tiny: Box = { left: 6, top: 6, right: 154, bottom: 94 };
    const p = placeMenu(button(60, 20, 30), { width: 264, height: 400 }, tiny);
    expect(p.maxWidth).toBe(148);
    expect(p.maxHeight).toBeLessThanOrEqual(88);
    expect(p.left).toBe(tiny.left);
    expect(p.top).toBeGreaterThanOrEqual(tiny.top);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(tiny.bottom);
  });
});

describe("placeBeside", () => {
  const panel = { width: 240, height: 160 };

  it("opens right of and below the click, leaving the clicked point in view", () => {
    expect(placeBeside({ x: 400, y: 300 }, panel, desktop)).toEqual({ left: 428, top: 328 });
  });

  it("goes to the left of the click near the right edge, and above it near the bottom", () => {
    expect(placeBeside({ x: 1400, y: 850 }, panel, desktop)).toEqual({ left: 1132, top: 662 });
  });

  it("stays inside a screen that is too small for either side", () => {
    const p = placeBeside({ x: 200, y: 400 }, panel, phone);
    expect(p.left).toBeGreaterThanOrEqual(phone.left);
    expect(p.left + panel.width).toBeLessThanOrEqual(phone.right);
  });
});

describe("clampInto", () => {
  it("keeps a dragged window inside the visible area", () => {
    const size = { width: 300, height: 200 };
    expect(clampInto({ left: -50, top: 2000 }, size, desktop)).toEqual({ left: 6, top: 694 });
    expect(clampInto({ left: 100, top: 100 }, size, desktop)).toEqual({ left: 100, top: 100 });
    // Larger than the area: its top left corner, with the title to drag it by, stays visible.
    expect(clampInto({ left: 50, top: 50 }, { width: 500, height: 1000 }, phone)).toEqual({ left: 6, top: 6 });
  });
});
