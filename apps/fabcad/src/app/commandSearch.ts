/**
 * Search of the command palette. Pure: every word typed must occur in the name, the group or
 * the keywords of a command; names that start with what was typed come first.
 */

export interface PaletteEntry {
  id: string;
  label: string;
  group: string;
  shortcut?: string;
  /** Other words the command is found by ("circle" for Hole, "export" for SVG …). */
  keywords?: string;
}

const norm = (t: string): string => t.toLowerCase().normalize("NFKC");

function score(entry: PaletteEntry, words: string[], query: string): number | null {
  const label = norm(entry.label);
  const all = `${label} ${norm(entry.group)} ${norm(entry.keywords ?? "")} ${norm(entry.shortcut ?? "")}`;
  if (!words.every((w) => all.includes(w))) return null;
  if (label.startsWith(query)) return 0;
  const first = words[0]!;
  if (label.split(/[\s/—()-]+/).some((w) => w.startsWith(first))) return 1;
  if (words.every((w) => label.includes(w))) return 2;
  return 3;
}

export function searchCommands<T extends PaletteEntry>(items: readonly T[], query: string): T[] {
  const q = norm(query.trim());
  if (q === "") return items.slice();
  const words = q.split(/\s+/);
  return items
    .map((item, index) => ({ item, index, s: score(item, words, q) }))
    .filter((x): x is { item: T; index: number; s: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .map((x) => x.item);
}
