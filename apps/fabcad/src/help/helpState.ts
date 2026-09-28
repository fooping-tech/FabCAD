import { type HelpRequest, type HelpTopic, appState } from "../app/appState";

/** Open the small help menu of a tool. Nothing else of the editor changes. */
export function openHelpMenu(request: HelpRequest): void {
  appState.set((s) => ({ help: { ...s.help, menu: request } }));
}

export function closeHelpMenu(): void {
  if (appState.get().help.menu) appState.set((s) => ({ help: { ...s.help, menu: null } }));
}

/** Show the full explanation of a tool in the overlay. */
export function openHelpTopic(topic: HelpTopic): void {
  appState.set({ help: { menu: null, topic } });
}

export function closeHelpTopic(): void {
  if (appState.get().help.topic) appState.set((s) => ({ help: { ...s.help, topic: null } }));
}
