import { useCallback, useMemo, useRef, useState } from "react";
import {
  addConstraint as modelAddConstraint,
  addPoint as modelAddPoint,
  addSegment as modelAddSegment,
  cloneDoc,
  deleteConstraint as modelDeleteConstraint,
  deletePoint as modelDeletePoint,
  deleteSegment as modelDeleteSegment,
  emptyDoc,
  solveDoc,
  updateDistance as modelUpdateDistance,
} from "../sketch/model";
import { History } from "../sketch/history";
import type { Constraint, ResidualInfo, Selection, SketchDoc, SolveResult } from "../sketch/types";

export interface SketchState {
  doc: SketchDoc;
  selection: Selection;
  status: SolveResult | null;
  message: string | null;
  canUndo: boolean;
  canRedo: boolean;
}

function runSolver(doc: SketchDoc, soft?: { pointId: string; x: number; y: number }): SolveResult {
  return solveDoc(doc, soft);
}

function applyPositions(doc: SketchDoc, res: SolveResult): void {
  for (const np of res.positions) {
    const p = doc.points.find((q) => q.id === np.id);
    if (p) {
      p.x = np.x;
      p.y = np.y;
    }
  }
}

export function useSketch(initial?: SketchDoc) {
  const historyRef = useRef<History>(new History(initial ?? emptyDoc()));
  const dragBeforeRef = useRef<SketchDoc | null>(null);
  const [selection, setSelection] = useState<Selection>({ points: [], segments: [] });
  const [state, setState] = useState<SketchState>(() => {
    const status = runSolver(historyRef.current.doc);
    return { doc: historyRef.current.doc, selection: { points: [], segments: [] }, status, message: null, canUndo: false, canRedo: false };
  });

  const buildState = useCallback((sel: Selection, message: string | null): SketchState => {
    const h = historyRef.current;
    const status = runSolver(h.doc);
    return { doc: h.doc, selection: sel, status, message, canUndo: h.canUndo(), canRedo: h.canRedo() };
  }, []);

  const refresh = useCallback((sel: Selection, message: string | null = null) => {
    setState(buildState(sel, message));
  }, [buildState]);

  /** Apply a mutating transaction; commit only when the solver accepts it. */
  const mutate = useCallback(
    (fn: (doc: SketchDoc) => void, successMessage?: string): string | null => {
      const h = historyRef.current;
      const trial = cloneDoc(h.doc);
      try {
        fn(trial);
      } catch (e) {
        setState(buildState(selection, (e as Error).message));
        return (e as Error).message;
      }
      const res = runSolver(trial);
      if (!res.ok) {
        const worst = res.residuals.slice(0, 3).map((r) => `${r.constraintId}: ${r.maxAbs.toExponential(2)}`).join(", ");
        setState(buildState(selection, `约束无法满足或未收敛。残差较大: ${worst || "-"}（保留此前有效图形；未证明无解）`));
        return "infeasible";
      }
      applyPositions(trial, res);
      h.begin()(trial);
      setState(buildState(selection, successMessage ?? null));
      return null;
    },
    [buildState, selection],
  );

  const addPoint = useCallback((x: number, y: number) => mutate((d) => modelAddPoint(d, x, y), "已添加点"), [mutate]);

  const addSegment = useCallback((a: string, b: string) => mutate((d) => modelAddSegment(d, a, b), "已添加线段"), [mutate]);

  const addConstraint = useCallback(
    (c: Omit<Constraint, "id">) => mutate((d) => modelAddConstraint(d, c), "已添加约束"),
    [mutate],
  );

  const changeDistance = useCallback(
    (id: string, value: number) => mutate((d) => modelUpdateDistance(d, id, value), "尺寸已更新"),
    [mutate],
  );

  const removeSelected = useCallback(() => {
    const ptIds = selection.points;
    const segIds = selection.segments;
    mutate((d) => {
      for (const id of segIds) modelDeleteSegment(d, id);
      for (const id of ptIds) modelDeletePoint(d, id);
    }, "已删除");
    setSelection({ points: [], segments: [] });
  }, [mutate, selection]);

  const removeConstraint = useCallback(
    (id: string) => mutate((d) => modelDeleteConstraint(d, id), "约束已删除"),
    [mutate],
  );

  const undo = useCallback(() => {
    historyRef.current.undo();
    setState(buildState(selection, null));
  }, [buildState, selection]);

  const redo = useCallback(() => {
    historyRef.current.redo();
    setState(buildState(selection, null));
  }, [buildState, selection]);

  const loadExample = useCallback((doc: SketchDoc) => {
    historyRef.current.begin()(cloneDoc(doc));
    const sel = { points: [], segments: [] };
    setSelection(sel);
    setState(buildState(sel, null));
  }, [buildState]);

  /** Drag with soft target. Returns true while the trial is feasible. */
  const dragMove = useCallback((pointId: string, x: number, y: number): boolean => {
    const h = historyRef.current;
    if (!dragBeforeRef.current) dragBeforeRef.current = h.snapshot();
    const trial = cloneDoc(h.doc);
    const res = runSolver(trial, { pointId, x, y });
    if (!res.ok) return false;
    applyPositions(trial, res);
    h.setLive(trial);
    setState({
      doc: h.doc,
      selection,
      status: res,
      message: null,
      canUndo: h.canUndo(),
      canRedo: h.canRedo(),
    });
    return true;
  }, [selection]);

  const dragEnd = useCallback(() => {
    const before = dragBeforeRef.current;
    dragBeforeRef.current = null;
    if (!before) return;
    historyRef.current.commitLive(before, cloneDoc(historyRef.current.doc));
    setState(buildState(selection, null));
  }, [buildState, selection]);

  const dragCancel = useCallback(() => {
    const before = dragBeforeRef.current;
    dragBeforeRef.current = null;
    if (before) {
      historyRef.current.setLive(before);
      setState(buildState(selection, null));
    }
  }, [buildState, selection]);

  return useMemo(() => ({
    state,
    selection,
    setSelection,
    addPoint,
    addSegment,
    addConstraint,
    changeDistance,
    removeSelected,
    removeConstraint,
    undo,
    redo,
    loadExample,
    dragMove,
    dragEnd,
    dragCancel,
  }), [state, selection, setSelection, addPoint, addSegment, addConstraint, changeDistance,
    removeSelected, removeConstraint, undo, redo, loadExample, dragMove, dragEnd, dragCancel]);
}

export type SketchController = ReturnType<typeof useSketch>;

export function formatResiduals(residuals: ResidualInfo[]): string {
  return residuals
    .filter((r) => r.maxAbs > 1e-6)
    .slice(0, 3)
    .map((r) => `${r.constraintId}(${r.type}) ${r.maxAbs.toExponential(2)}`)
    .join(", ");
}
