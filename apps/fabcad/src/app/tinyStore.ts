import { useSyncExternalStore } from "react";

/** Minimal observable store for UI state. */
export class TinyStore<T> {
  private listeners = new Set<() => void>();

  constructor(private state: T) {}

  get = (): T => this.state;

  set(patch: Partial<T> | ((state: T) => Partial<T>)): void {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    let changed = false;
    for (const key of Object.keys(p) as (keyof T)[]) {
      if (p[key] !== this.state[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...p };
    for (const l of [...this.listeners]) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
}

export function useStore<T>(store: TinyStore<T>): T;
export function useStore<T, S>(store: TinyStore<T>, selector: (state: T) => S): S;
export function useStore<T, S>(store: TinyStore<T>, selector?: (state: T) => S): T | S {
  const state = useSyncExternalStore(store.subscribe, store.get);
  return selector ? selector(state) : state;
}
