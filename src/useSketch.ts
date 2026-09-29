import { useCallback, useMemo, useRef, useState } from "react";
import { addLine, addPoint, cloneDocument, deleteConstraint, deleteLine, deletePoint, validateDocument } from "./geometry";
import { DocumentHistory } from "./history";
import { solveSketch } from "./solver";
import { hasEquivalentConstraint } from "./constraints";
import type { Constraint, ConstraintId, LineId, PointId, SketchDocument, SolveResult } from "./types";

export interface Selection {
  points: PointId[];
  lines: LineId[];
}

export interface SketchState {
  doc: SketchDocument;
  status: SolveResult | null;
  message: string;
  selection: Selection;
  selectedConstraintId: ConstraintId | null;
  canUndo: boolean;
  canRedo: boolean;
}

function describeFailure(result: SolveResult): string {
  const residualText = result.largestResiduals
    .slice(0, 3)
    .map((item) => `${item.type} ${item.constraintId.slice(-4)}=${item.magnitude.toExponential(2)}mm`)
    .join("，");
  const zeroText = result.zeroLengthLines.length ? `；零长线: ${result.zeroLengthLines.join(", ")}` : "";
  if (!result.converged) return `未在迭代上限内收敛（不代表已证明无解），RMS=${result.residual.toExponential(2)}；${residualText || "无明显残差"}${zeroText}`;
  return `约束无法满足，RMS=${result.residual.toExponential(2)}；${residualText}${zeroText}`;
}

export function useSketch(initial: SketchDocument) {
  const historyRef = useRef(new DocumentHistory(initial));
  const [state, setState] = useState<SketchState>(() => ({
    doc: historyRef.current.current,
    status: null,
    message: "就绪：坐标单位为 mm，Y 轴向上。",
    selection: { points: [], lines: [] },
    selectedConstraintId: null,
    canUndo: false,
    canRedo: false,
  }));
  const dragStartRef = useRef<SketchDocument | null>(null);
  const dragLiveRef = useRef<SketchDocument | null>(null);

  const publish = useCallback((doc: SketchDocument, status: SolveResult | null, message: string, selection?: Selection, selectedConstraintId?: ConstraintId | null) => {
    setState((previous) => ({
      doc,
      status,
      message,
      selection: selection ?? previous.selection,
      selectedConstraintId: selectedConstraintId === undefined ? previous.selectedConstraintId : selectedConstraintId,
      canUndo: historyRef.current.canUndo,
      canRedo: historyRef.current.canRedo,
    }));
  }, []);

  const analyze = useCallback((candidate: SketchDocument, selection?: Selection, selectedConstraintId?: ConstraintId | null) => {
    const validationErrors = validateDocument(candidate);
    if (validationErrors.length > 0) {
      publish(historyRef.current.current, null, validationErrors.join("；"));
      return false;
    }
    const result = solveSketch(candidate);
    if (!result.ok) {
      publish(historyRef.current.current, result, describeFailure(result), selection, selectedConstraintId);
      return false;
    }
    for (const [id, [x, y]] of Object.entries(result.positions)) {
      candidate.points[id].x = x;
      candidate.points[id].y = y;
    }
    historyRef.current.commit(candidate);
    publish(historyRef.current.current, result, `已求解：剩余局部自由度 ${result.dof}，独立方程 ${result.rank}，冗余方程 ${result.redundantEquations}。`, selection, selectedConstraintId);
    return true;
  }, [publish]);

  const createPoint = useCallback((x: number, y: number) => {
    const candidate = historyRef.current.current;
    const point = addPoint(candidate, x, y);
    analyze(candidate, { points: [point.id], lines: [] }, null);
  }, [analyze]);

  const connectPoints = useCallback((a: PointId, b: PointId) => {
    const candidate = historyRef.current.current;
    const line = addLine(candidate, a, b);
    analyze(candidate, { points: [], lines: [line.id] }, null);
  }, [analyze]);

  const addConstraint = useCallback((make: (doc: SketchDocument) => Constraint, selection: Selection) => {
    const candidate = historyRef.current.current;
    try {
      const constraint = make(candidate);
      if (hasEquivalentConstraint(candidate.constraints, constraint)) {
        publish(candidate, null, "等价关系已存在，未重复添加。", selection, null);
        return;
      }
      candidate.constraints.push(constraint);
      analyze(candidate, selection, constraint.id);
    } catch (error) {
      publish(candidate, null, error instanceof Error ? error.message : String(error), selection, null);
    }
  }, [analyze, publish]);

  const updateDistance = useCallback((constraintId: ConstraintId, value: number) => {
    const candidate = historyRef.current.current;
    const constraint = candidate.constraints.find((item) => item.id === constraintId);
    if (!constraint || constraint.type !== "distance") return;
    if (!Number.isFinite(value) || value <= 0) {
      publish(candidate, null, "距离必须是有限正数。");
      return;
    }
    constraint.value = value;
    analyze(candidate, state.selection, constraintId);
  }, [analyze, publish, state.selection]);

  const removeConstraint = useCallback((constraintId: ConstraintId) => {
    const candidate = historyRef.current.current;
    deleteConstraint(candidate, constraintId);
    analyze(candidate, state.selection, null);
  }, [analyze, state.selection]);

  const removeSelection = useCallback(() => {
    const candidate = historyRef.current.current;
    for (const lineId of state.selection.lines) deleteLine(candidate, lineId);
    for (const pointId of state.selection.points) deletePoint(candidate, pointId);
    analyze(candidate, { points: [], lines: [] }, null);
  }, [analyze, state.selection]);

  const removePointOnly = useCallback((pointId: PointId) => {
    const candidate = historyRef.current.current;
    deletePoint(candidate, pointId);
    analyze(candidate, { points: [], lines: [] }, null);
  }, [analyze]);

  const removeLineOnly = useCallback((lineId: LineId) => {
    const candidate = historyRef.current.current;
    deleteLine(candidate, lineId);
    analyze(candidate, { points: [], lines: [] }, null);
  }, [analyze]);

  const setSelection = useCallback((selection: Selection) => {
    setState((previous) => ({ ...previous, selection, selectedConstraintId: null }));
  }, []);

  const selectConstraint = useCallback((id: ConstraintId | null) => {
    setState((previous) => ({ ...previous, selectedConstraintId: id, selection: { points: [], lines: [] } }));
  }, []);

  const beginDrag = useCallback((pointId: PointId) => {
    const doc = historyRef.current.current;
    const fixed = doc.constraints.some((constraint) => constraint.type === "fixed" && constraint.point === pointId);
    if (fixed) {
      publish(doc, null, "固定点不可拖动。");
      return false;
    }
    dragStartRef.current = cloneDocument(doc);
    dragLiveRef.current = cloneDocument(doc);
    return true;
  }, [publish]);

  const dragTo = useCallback((pointId: PointId, x: number, y: number) => {
    const start = dragStartRef.current;
    if (!start) return;
    const candidate = cloneDocument(start);
    const result = solveSketch(candidate, { targets: { [pointId]: { x, y, weight: 0.08 } } });
    if (!result.ok || result.zeroLengthLines.length > 0) {
      publish(start, result, describeFailure(result));
      return;
    }
    for (const [id, [px, py]] of Object.entries(result.positions)) {
      candidate.points[id].x = px;
      candidate.points[id].y = py;
    }
    dragLiveRef.current = candidate;
    publish(candidate, result, `拖动中：剩余自由度 ${result.dof}；鼠标位置仅作软目标。`, { points: [pointId], lines: [] }, null);
  }, [publish]);

  const endDrag = useCallback(() => {
    if (!dragStartRef.current) return;
    const start = dragStartRef.current;
    dragStartRef.current = null;
    const live = dragLiveRef.current ?? historyRef.current.current;
    const moved = Object.keys(start.points).some((id) => Math.abs(start.points[id].x - live.points[id]?.x) > 1e-9 || Math.abs(start.points[id].y - live.points[id]?.y) > 1e-9);
    const result = solveSketch(live);
    if (moved && result.ok) historyRef.current.commit(live);
    dragLiveRef.current = null;
    publish(historyRef.current.current, result, moved ? "拖拽已提交为一条历史。" : "未产生移动，未新增历史。", state.selection, null);
  }, [publish, state.selection]);

  const undo = useCallback(() => {
    dragStartRef.current = null;
    dragLiveRef.current = null;
    const doc = historyRef.current.undo();
    publish(doc, solveSketch(doc), "已撤销。", { points: [], lines: [] }, null);
  }, [publish]);

  const redo = useCallback(() => {
    const doc = historyRef.current.redo();
    publish(doc, solveSketch(doc), "已重做。", { points: [], lines: [] }, null);
  }, [publish]);

  const loadExample = useCallback((doc: SketchDocument) => {
    dragStartRef.current = null;
    dragLiveRef.current = null;
    historyRef.current = new DocumentHistory(doc);
    publish(historyRef.current.current, solveSketch(doc), "示例已载入。", { points: [], lines: [] }, null);
  }, [publish]);

  return useMemo(() => ({
    state,
    createPoint,
    connectPoints,
    addConstraint,
    updateDistance,
    removeConstraint,
    removeSelection,
    removePointOnly,
    removeLineOnly,
    setSelection,
    selectConstraint,
    beginDrag,
    dragTo,
    endDrag,
    undo,
    redo,
    loadExample,
  }), [state, createPoint, connectPoints, addConstraint, updateDistance, removeConstraint, removeSelection, removePointOnly, removeLineOnly, setSelection, selectConstraint, beginDrag, dragTo, endDrag, undo, redo, loadExample]);
}
