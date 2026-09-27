import type { CadDocument } from "./document";

/**
 * Undo / redo through the command pattern. A command is a labelled pure function from one
 * document to the next. Documents are immutable values, so the history keeps the document
 * before and after each command; unchanged parts are shared structurally.
 */
export interface Command {
  label: string;
  apply(doc: CadDocument): CadDocument;
}

export const command = (label: string, apply: (doc: CadDocument) => CadDocument): Command => ({
  label,
  apply,
});

interface HistoryEntry {
  label: string;
  before: CadDocument;
  after: CadDocument;
}

export type StoreListener = (doc: CadDocument) => void;

export interface StoreOptions {
  historyLimit?: number;
}

export class DocumentStore {
  private doc: CadDocument;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private listeners = new Set<StoreListener>();
  private transaction: { label: string; before: CadDocument } | null = null;
  private saved: CadDocument;
  private readonly historyLimit: number;

  constructor(doc: CadDocument, options: StoreOptions = {}) {
    this.doc = doc;
    this.saved = doc;
    this.historyLimit = options.historyLimit ?? 200;
  }

  get document(): CadDocument {
    return this.doc;
  }

  /** Stable snapshot getter for `useSyncExternalStore`. */
  getSnapshot = (): CadDocument => this.doc;

  subscribe = (listener: StoreListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit(): void {
    for (const l of [...this.listeners]) l(this.doc);
  }

  private push(entry: HistoryEntry): void {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Run a command and record it in the history. Returns false when nothing changed. */
  execute(cmd: Command): boolean {
    if (this.transaction) this.commit();
    const before = this.doc;
    const after = cmd.apply(before);
    if (after === before) return false;
    this.doc = after;
    this.push({ label: cmd.label, before, after });
    this.emit();
    return true;
  }

  /**
   * Start an interactive edit (e.g. a drag). Updates made with `update` are visible
   * immediately but collapse into a single history entry on `commit`.
   */
  begin(label: string): void {
    if (this.transaction) this.commit();
    this.transaction = { label, before: this.doc };
  }

  update(fn: (doc: CadDocument) => CadDocument): void {
    if (!this.transaction) throw new Error("update() called outside a transaction");
    const next = fn(this.doc);
    if (next === this.doc) return;
    this.doc = next;
    this.emit();
  }

  commit(): boolean {
    const t = this.transaction;
    if (!t) return false;
    this.transaction = null;
    if (t.before === this.doc) return false;
    this.push({ label: t.label, before: t.before, after: this.doc });
    this.emit();
    return true;
  }

  cancel(): void {
    const t = this.transaction;
    if (!t) return;
    this.transaction = null;
    if (this.doc !== t.before) {
      this.doc = t.before;
      this.emit();
    }
  }

  get inTransaction(): boolean {
    return this.transaction !== null;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  undo(): boolean {
    if (this.transaction) this.cancel();
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.redoStack.push(entry);
    this.doc = entry.before;
    this.emit();
    return true;
  }

  redo(): boolean {
    if (this.transaction) this.cancel();
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.undoStack.push(entry);
    this.doc = entry.after;
    this.emit();
    return true;
  }

  /** Replace the document (New / Open). Clears the history. */
  load(doc: CadDocument): void {
    this.transaction = null;
    this.undoStack = [];
    this.redoStack = [];
    this.doc = doc;
    this.saved = doc;
    this.emit();
  }

  markSaved(): void {
    this.saved = this.doc;
    this.emit();
  }

  get dirty(): boolean {
    return this.saved !== this.doc;
  }
}
