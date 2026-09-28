/**
 * In-app help. One entry per tool the user can start; the ribbon, the menus and the help
 * overlay all read the same registry (`content.ts`), so there is one place to keep up to date.
 */
export interface HelpEntry {
  title: string;
  /** One or two sentences, shown in the small help menu. */
  summary: string;
  /** Keyboard shortcut, if the tool has one. */
  shortcut?: string;
  /** What the tool does. */
  what: string[];
  /** When to reach for it. */
  when?: string[];
  /** What has to be selected or exist before it can be used. */
  requires?: string[];
  parameters?: { name: string; text: string }[];
  limitations?: string[];
  /** Short step-by-step examples. */
  examples?: string[];
}

/** What is known about a tool that has no entry: its name and the line of its tooltip. */
export interface HelpFallback {
  title: string;
  summary?: string;
}
