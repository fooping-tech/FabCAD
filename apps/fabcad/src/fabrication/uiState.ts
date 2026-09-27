import { appState } from "../app/appState";
import { TinyStore } from "../app/tinyStore";

export interface FabricationUiState {
  selectedPartId: string | null;
  partsMode: "cards" | "table";
  /** Zoom of the sheet view relative to "fit width". */
  sheetZoom: number;
}

/** UI-only state of the Fabrication workspace (never saved in the document). */
export const fabricationUiState = new TinyStore<FabricationUiState>({
  selectedPartId: null,
  partsMode: "cards",
  sheetZoom: 1,
});

export function selectPart(partId: string | null): void {
  fabricationUiState.set({ selectedPartId: partId });
}

/** Select a part and make sure a view that shows it is open. */
export function revealPart(partId: string): void {
  selectPart(partId);
  if (appState.get().fabricationTab === "model") appState.set({ fabricationTab: "parts" });
}
