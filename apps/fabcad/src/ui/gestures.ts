/**
 * Touch gestures, recognised in one place so that the viewport, the ribbon and the menus agree
 * on what a tap, a double tap and a long press are.
 *
 * - Double tap: the context menu of the editor (what a right-click is with a mouse).
 * - Long press: help for a tool icon.
 * - Two-finger swipe on a trackpad: pan the view (pinch and the mouse wheel zoom).
 *
 * The functions here hold no DOM listeners of their own; they are fed with pointer positions
 * and times, which keeps them testable without a browser.
 */

/** Selection and Node Edit start their drag on touch-down; creation tools place on release. */
export const sketchTouchUsesDrag = (tool: string): boolean =>
  tool === "select" || tool === "node-edit";

export interface TapPoint {
  x: number;
  y: number;
  /** Milliseconds, e.g. `event.timeStamp`. */
  time: number;
}

export interface DoubleTapOptions {
  /** Longest time between the two taps (ms). */
  interval?: number;
  /** Largest distance between the two taps (px). */
  distance?: number;
  /** Longest time a finger may stay down to count as a tap (ms). */
  hold?: number;
  /** Largest movement of the finger during a tap (px). */
  slop?: number;
}

export interface DoubleTapDetector<T> {
  /**
   * Report a finger that went down at `down` and was lifted at `up`. Returns the context of
   * the first tap when this is the second tap of a double tap, otherwise null. `context` is
   * kept with a first tap and handed back with the second.
   */
  tap(down: TapPoint, up: TapPoint, context: T): { first: T } | null;
  /** Forget a pending first tap: a drag, a pinch or a second finger came in between. */
  reset(): void;
}

export function createDoubleTapDetector<T = undefined>(
  options: DoubleTapOptions = {},
): DoubleTapDetector<T> {
  const interval = options.interval ?? 350;
  const distance = options.distance ?? 32;
  const hold = options.hold ?? 300;
  const slop = options.slop ?? 12;
  let last: { at: TapPoint; context: T } | null = null;
  return {
    tap(down, up, context) {
      const isTap =
        up.time - down.time <= hold && Math.hypot(up.x - down.x, up.y - down.y) <= slop;
      if (!isTap) {
        last = null;
        return null;
      }
      const first = last;
      if (
        first &&
        down.time - first.at.time <= interval &&
        Math.hypot(up.x - first.at.x, up.y - first.at.y) <= distance
      ) {
        // A third tap starts over: it is not the second tap of another double tap.
        last = null;
        return { first: first.context };
      }
      last = { at: up, context };
      return null;
    },
    reset() {
      last = null;
    },
  };
}

export const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;

export interface LongPressHandlers {
  onPointerDown: (e: PointerLike) => void;
  onPointerMove: (e: PointerLike) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  /**
   * True once, right after a long press fired: the click that follows the lifting of the
   * finger belongs to the long press and must not start the tool.
   */
  consumeClick: () => boolean;
}

export interface PointerLike {
  pointerType: string;
  clientX: number;
  clientY: number;
}

/**
 * Long press with a finger or a pen. `fire` gets the position of the press. Mouse input never
 * long-presses: it has the right button.
 */
export function createLongPress(
  fire: (at: { x: number; y: number }) => void,
  delay = LONG_PRESS_MS,
): LongPressHandlers {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { x: number; y: number } | null = null;
  let fired = false;
  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    start = null;
  };
  return {
    onPointerDown(e) {
      cancel();
      fired = false;
      if (e.pointerType === "mouse") return;
      const at = { x: e.clientX, y: e.clientY };
      start = at;
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        fire(at);
      }, delay);
    },
    onPointerMove(e) {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > LONG_PRESS_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    consumeClick() {
      const was = fired;
      fired = false;
      return was;
    },
  };
}

// ------------------------------------------------------------------ trackpad

/** What a wheel event carries that tells a trackpad from a mouse wheel. */
export interface WheelSample {
  deltaX: number;
  deltaY: number;
  /** 0: pixels, 1: lines, 2: pages. */
  deltaMode: number;
  /** Set by browsers for a pinch on a trackpad (and for Ctrl + wheel). */
  ctrlKey: boolean;
  /** Non-standard `wheelDeltaY` of Chrome and Safari, when there is one. */
  wheelDeltaY?: number;
  /** Milliseconds, e.g. `event.timeStamp`. */
  time: number;
}

export type WheelGesture = "pan" | "zoom";

/**
 * Tells a two-finger swipe on a trackpad (pan the view) from a mouse wheel and a pinch (zoom).
 *
 * - A pinch arrives with `ctrlKey`: zoom.
 * - A mouse wheel moves in lines, or in big integer steps with no sideways part; Chrome and
 *   Safari report `wheelDeltaY` in steps of 120 for it, but as -3 × `deltaY` for a trackpad.
 * - A swipe that has been recognised keeps panning while its events keep coming (`gap` ms),
 *   so that a slow, purely vertical swipe does not turn into zooming halfway.
 */
export function createWheelClassifier(gap = 160): (e: WheelSample) => WheelGesture {
  let last: { gesture: WheelGesture; time: number } | null = null;
  return (e) => {
    let gesture: WheelGesture;
    if (e.ctrlKey) gesture = "zoom";
    else if (last?.gesture === "pan" && e.time - last.time < gap) gesture = "pan";
    else if (e.deltaMode !== 0) gesture = "zoom";
    else if (e.deltaX !== 0) gesture = "pan";
    else if (e.wheelDeltaY !== undefined && e.wheelDeltaY !== 0) {
      gesture = e.wheelDeltaY === -3 * e.deltaY ? "pan" : "zoom";
    } else gesture = Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 ? "zoom" : "pan";
    last = { gesture, time: e.time };
    return gesture;
  };
}
