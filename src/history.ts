import { cloneDocument } from "./geometry";
import type { SketchDocument } from "./types";

export class DocumentHistory {
  private undoStack: SketchDocument[] = [];
  private redoStack: SketchDocument[] = [];

  constructor(initial: SketchDocument) {
    this.undoStack = [cloneDocument(initial)];
  }

  get current(): SketchDocument {
    return cloneDocument(this.undoStack[this.undoStack.length - 1]);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 1;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  commit(document: SketchDocument): void {
    this.undoStack.push(cloneDocument(document));
    this.redoStack = [];
  }

  undo(): SketchDocument {
    if (this.canUndo) this.redoStack.push(this.undoStack.pop()!);
    return this.current;
  }

  redo(): SketchDocument {
    const next = this.redoStack.pop();
    if (next) this.undoStack.push(next);
    return this.current;
  }
}
