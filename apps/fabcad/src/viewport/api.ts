import type { ViewName } from "./scene";

/** Imperative handle of the mounted viewport, for keyboard shortcuts and menus. */
export interface ViewportApi {
  /** Cancel the picks of the running sketch command. True when there was something to cancel. */
  cancel(): boolean;
  /** Finish an open-ended sketch command (polyline, spline). */
  confirm(): boolean;
  fit(): void;
  setView(view: ViewName): void;
  /** Open the inline editor of a dimension of the active sketch. */
  editDimension(dimensionId: string): void;
}

let current: ViewportApi | null = null;

export const registerViewport = (api: ViewportApi | null): void => {
  current = api;
};

export const viewportApi = (): ViewportApi | null => current;
