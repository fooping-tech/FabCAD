/** A computation can always be stopped after this long. */
const STOP_AFTER_S = 8;

/**
 * When to offer Stop (seconds): 8 s, or twice the longest recompute of this document,
 * whichever is longer. A large model on a slow device is not taken for stuck while it computes
 * as long as usual.
 */
export function stopAfterSeconds(slowestMs: number): number {
  return Math.max(STOP_AFTER_S, Math.ceil((2 * slowestMs) / 1000));
}
