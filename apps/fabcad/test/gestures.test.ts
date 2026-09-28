import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LONG_PRESS_MS, createDoubleTapDetector, createLongPress } from "../src/ui/gestures";

const tap = (x: number, y: number, at: number, held = 60) => ({
  down: { x, y, time: at },
  up: { x, y, time: at + held },
});

describe("double tap", () => {
  it("is two taps at one place, shortly after each other", () => {
    const d = createDoubleTapDetector<string>();
    const a = tap(100, 100, 1000);
    const b = tap(104, 97, 1200);
    expect(d.tap(a.down, a.up, "first")).toBeNull();
    expect(d.tap(b.down, b.up, "second")).toEqual({ first: "first" });
  });

  it("hands back what was kept with the first tap", () => {
    const d = createDoubleTapDetector<{ selection: string[] }>();
    const a = tap(10, 10, 0);
    const b = tap(10, 10, 150);
    d.tap(a.down, a.up, { selection: ["edge-1", "edge-2"] });
    expect(d.tap(b.down, b.up, { selection: ["edge-1"] })?.first.selection).toEqual([
      "edge-1",
      "edge-2",
    ]);
  });

  it("is not two taps that are far apart in time or place", () => {
    const d = createDoubleTapDetector();
    const a = tap(100, 100, 1000);
    const late = tap(100, 100, 1600);
    expect(d.tap(a.down, a.up, undefined)).toBeNull();
    expect(d.tap(late.down, late.up, undefined)).toBeNull();
    // The late tap counts as a first tap again; one that is far away does not complete it.
    const far = tap(200, 100, 1750);
    expect(d.tap(far.down, far.up, undefined)).toBeNull();
    const again = tap(203, 101, 1900);
    expect(d.tap(again.down, again.up, undefined)).not.toBeNull();
  });

  it("ignores drags and long presses, and they break a double tap", () => {
    const d = createDoubleTapDetector();
    const a = tap(100, 100, 1000);
    expect(d.tap(a.down, a.up, undefined)).toBeNull();
    // A pan: the finger moved.
    expect(d.tap({ x: 100, y: 100, time: 1100 }, { x: 160, y: 100, time: 1180 }, undefined)).toBeNull();
    const b = tap(100, 100, 1250);
    expect(d.tap(b.down, b.up, undefined)).toBeNull();
    // A press that is held is not a tap either.
    const held = tap(100, 100, 1400, 500);
    expect(d.tap(held.down, held.up, undefined)).toBeNull();
    const c = tap(100, 100, 2000);
    expect(d.tap(c.down, c.up, undefined)).toBeNull();
  });

  it("can be reset by a second finger", () => {
    const d = createDoubleTapDetector();
    const a = tap(100, 100, 1000);
    const b = tap(100, 100, 1150);
    d.tap(a.down, a.up, undefined);
    d.reset();
    expect(d.tap(b.down, b.up, undefined)).toBeNull();
  });

  it("needs two more taps after a double tap", () => {
    const d = createDoubleTapDetector();
    const taps = [0, 150, 300, 450].map((t) => tap(50, 50, t));
    const results = taps.map((t) => d.tap(t.down, t.up, undefined) !== null);
    expect(results).toEqual([false, true, false, true]);
  });
});

describe("long press", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const touch = (x: number, y: number) => ({ pointerType: "touch", clientX: x, clientY: y });

  it("fires where the finger went down, after the delay", () => {
    const fire = vi.fn();
    const press = createLongPress(fire);
    press.onPointerDown(touch(40, 50));
    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledWith({ x: 40, y: 50 });
  });

  it("swallows the click that ends it, once", () => {
    const press = createLongPress(() => undefined);
    press.onPointerDown(touch(0, 0));
    vi.advanceTimersByTime(LONG_PRESS_MS);
    press.onPointerUp();
    expect(press.consumeClick()).toBe(true);
    expect(press.consumeClick()).toBe(false);
  });

  it("is a plain tap when the finger is lifted early", () => {
    const fire = vi.fn();
    const press = createLongPress(fire);
    press.onPointerDown(touch(0, 0));
    vi.advanceTimersByTime(200);
    press.onPointerUp();
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
    expect(press.consumeClick()).toBe(false);
  });

  it("is called off when the finger moves (scrolling the ribbon) or leaves", () => {
    const fire = vi.fn();
    const press = createLongPress(fire);
    press.onPointerDown(touch(0, 0));
    press.onPointerMove(touch(3, 2));
    press.onPointerMove(touch(30, 0));
    vi.advanceTimersByTime(1000);
    press.onPointerDown(touch(0, 0));
    press.onPointerLeave();
    vi.advanceTimersByTime(1000);
    press.onPointerDown(touch(0, 0));
    press.onPointerCancel();
    vi.advanceTimersByTime(1000);
    expect(fire).not.toHaveBeenCalled();
  });

  it("leaves the mouse alone: it has a right button", () => {
    const fire = vi.fn();
    const press = createLongPress(fire);
    press.onPointerDown({ pointerType: "mouse", clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(2000);
    expect(fire).not.toHaveBeenCalled();
  });
});
