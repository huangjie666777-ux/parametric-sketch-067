import { cloneDoc } from "./model";
import type { SketchDoc } from "./types";

export class History {
  private undoStack: SketchDoc[] = [];
  private redoStack: SketchDoc[] = [];

  constructor(private current: SketchDoc) {}

  get doc(): SketchDoc {
    return this.current;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Begin a transaction: capture pre-state. Returns a commit function. */
  begin(): (next: SketchDoc) => void {
    const before = cloneDoc(this.current);
    return (next: SketchDoc) => {
      this.undoStack.push(before);
      this.current = next;
      this.redoStack = [];
    };
  }

  /** Live update without recording history (used during an active drag). */
  setLive(next: SketchDoc): void {
    this.current = next;
  }

  /**
   * Finish a live interaction: record exactly one history entry using the
   * captured pre-state. New operations clear redo.
   */
  commitLive(before: SketchDoc, next: SketchDoc): void {
    this.undoStack.push(before);
    this.current = next;
    this.redoStack = [];
  }

  snapshot(): SketchDoc {
    return cloneDoc(this.current);
  }

  undo(): SketchDoc {
    const prev = this.undoStack.pop();
    if (!prev) return this.current;
    this.redoStack.push(cloneDoc(this.current));
    this.current = prev;
    return this.current;
  }

  redo(): SketchDoc {
    const next = this.redoStack.pop();
    if (!next) return this.current;
    this.undoStack.push(cloneDoc(this.current));
    this.current = next;
    return this.current;
  }
}
