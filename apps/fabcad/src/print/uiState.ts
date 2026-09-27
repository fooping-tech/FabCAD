import { TinyStore } from "../app/tinyStore";

export interface PrintUiState {
  selectedBodyId: string | null;
  showOverhangs: boolean;
}

export const printUiState = new TinyStore<PrintUiState>({
  selectedBodyId: null,
  showOverhangs: true,
});

export function selectPrintPart(bodyId: string | null): void {
  printUiState.set({ selectedBodyId: bodyId });
}
