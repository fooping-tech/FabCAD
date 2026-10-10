import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LONG_PRESS_MS,
  type WheelSample,
  createDoubleTapDetector,
  createLongPress,
  createWheelClassifier,
  sketchTouchUsesDrag,
} from "../src/ui/gestures";

const tap = (x: number, y: number, at: number, held = 60) => ({
  down: { x, y, time: at },
  up: { x, y, time: at + held },
});

describe("sketch touch drag routing", () => {
  it("starts selecting and node editing on touch-down, not release", () => {
    expect(sketchTouchUsesDrag("select")).toBe(true);
    expect(sketchTouchUsesDrag("node-edit")).toBe(true);
  });

  it("keeps shape creation as release-to-place", () => {
    for (const tool of ["text", "line", "spline-fit", "offset", "project"]) {
      expect(sketchTouchUsesDrag(tool)).toBe(false);
    }
  });
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

describe("wheel classifier", () => {
  const sample = (s: Partial<WheelSample>): WheelSample => ({
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    time: 0,
    ...s,
  });

  it("pans for a two-finger swipe and zooms for a pinch or a mouse wheel", () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaX: 3, deltaY: 1, time: 0 }))).toBe("pan");
    expect(classify(sample({ deltaY: 2, ctrlKey: true, time: 1000 }))).toBe("zoom");
    // Chrome / Safari: a trackpad reports wheelDeltaY = -3 × deltaY, a mouse steps of 120.
    expect(classify(sample({ deltaY: 4, wheelDeltaY: -12, time: 2000 }))).toBe("pan");
    expect(classify(sample({ deltaY: 100, wheelDeltaY: -120, time: 3000 }))).toBe("zoom");
    // Firefox: a mouse wheel moves in lines.
    expect(classify(sample({ deltaY: 3, deltaMode: 1, time: 4000 }))).toBe("zoom");
    expect(classify(sample({ deltaY: 100, time: 5000 }))).toBe("zoom");
    expect(classify(sample({ deltaY: 2.5, time: 6000 }))).toBe("pan");
  });

  it("keeps panning while the events of one swipe keep coming", () => {
    const classify = createWheelClassifier();
    expect(classify(sample({ deltaX: 5, time: 0 }))).toBe("pan");
    // A purely vertical step of the same swipe that alone would look like a wheel.
    expect(classify(sample({ deltaY: 60, time: 50 }))).toBe("pan");
    expect(classify(sample({ deltaY: 60, time: 400 }))).toBe("zoom");
    // A pinch always zooms.
    expect(classify(sample({ deltaX: 5, time: 500 }))).toBe("pan");
    expect(classify(sample({ deltaY: 1, ctrlKey: true, time: 520 }))).toBe("zoom");
  });
});
