import type { Constraint, ConstraintId, LineId, PointId, SketchDocument, SketchLine, SketchPoint } from "./types";
import { nextId } from "./identity";

export const MAX_POINTS = 20;
export const MIN_LINE_LENGTH = 1e-7;

export function emptyDocument(): SketchDocument {
  return { points: {}, lines: {}, constraints: [] };
}

export function cloneDocument(document: SketchDocument): SketchDocument {
  return {
    points: Object.fromEntries(Object.entries(document.points).map(([id, p]) => [id, { ...p }])),
    lines: Object.fromEntries(Object.entries(document.lines).map(([id, l]) => [id, { ...l }])),
    constraints: document.constraints.map((constraint) => ({ ...constraint })),
  };
}

export function finiteNumber(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateDocument(document: SketchDocument): string[] {
  const errors: string[] = [];
  for (const line of Object.values(document.lines)) {
    if (!document.points[line.a] || !document.points[line.b]) errors.push(`线段 ${line.id} 引用了不存在的点`);
    if (line.a === line.b) errors.push(`线段 ${line.id} 的端点不能相同`);
  }
  for (const constraint of document.constraints) {
    const needPoint = (id: PointId) => {
      if (!document.points[id]) errors.push(`约束 ${constraint.id} 引用了不存在的点 ${id}`);
    };
    const needLine = (id: LineId) => {
      if (!document.lines[id]) errors.push(`约束 ${constraint.id} 引用了不存在的线段 ${id}`);
    };
    if (constraint.type === "coincident" || constraint.type === "distance") {
      needPoint(constraint.a);
      needPoint(constraint.b);
      if (constraint.type === "distance" && (!(constraint.value > 0) || !Number.isFinite(constraint.value))) errors.push(`距离约束 ${constraint.id} 必须是有限正数`);
    } else if (constraint.type === "horizontal" || constraint.type === "vertical") {
      needLine(constraint.line);
    } else if (constraint.type === "perpendicular") {
      needLine(constraint.a);
      needLine(constraint.b);
    } else if (constraint.type === "fixed") {
      needPoint(constraint.point);
      if (!Number.isFinite(constraint.x) || !Number.isFinite(constraint.y)) errors.push(`固定约束 ${constraint.id} 坐标非法`);
    }
  }
  return errors;
}

export function addPoint(document: SketchDocument, x: number, y: number): SketchPoint {
  if (!finiteNumber(x) || !finiteNumber(y)) throw new Error("点坐标必须是有限数值");
  if (Object.keys(document.points).length >= MAX_POINTS) throw new Error(`最多只能创建 ${MAX_POINTS} 个点`);
  const point: SketchPoint = { id: nextId("p"), x, y };
  document.points[point.id] = point;
  return point;
}

export function addLine(document: SketchDocument, a: PointId, b: PointId): SketchLine {
  if (a === b) throw new Error("零长线无效");
  if (!document.points[a] || !document.points[b]) throw new Error("未知点引用");
  const length = Math.hypot(document.points[b].x - document.points[a].x, document.points[b].y - document.points[a].y);
  if (length < MIN_LINE_LENGTH) throw new Error("零长线无效");
  const line: SketchLine = { id: nextId("l"), a, b };
  document.lines[line.id] = line;
  return line;
}

export function deletePoint(document: SketchDocument, pointId: PointId): void {
  const lineIds = Object.values(document.lines)
    .filter((line) => line.a === pointId || line.b === pointId)
    .map((line) => line.id);
  for (const lineId of lineIds) delete document.lines[lineId];
  document.constraints = document.constraints.filter((constraint) => !usesPoint(constraint, pointId) && !usesAnyLine(constraint, lineIds));
  delete document.points[pointId];
}

export function deleteLine(document: SketchDocument, lineId: LineId): void {
  document.constraints = document.constraints.filter((constraint) => !usesAnyLine(constraint, [lineId]));
  delete document.lines[lineId];
}

export function deleteConstraint(document: SketchDocument, constraintId: ConstraintId): void {
  document.constraints = document.constraints.filter((constraint) => constraint.id !== constraintId);
}

function usesPoint(constraint: Constraint, pointId: PointId): boolean {
  if (constraint.type === "coincident" || constraint.type === "distance") return constraint.a === pointId || constraint.b === pointId;
  return constraint.type === "fixed" && constraint.point === pointId;
}

function usesAnyLine(constraint: Constraint, lineIds: LineId[]): boolean {
  if (lineIds.length === 0) return false;
  if (constraint.type === "horizontal" || constraint.type === "vertical") return lineIds.includes(constraint.line);
  if (constraint.type === "perpendicular") return lineIds.includes(constraint.a) || lineIds.includes(constraint.b);
  return false;
}
