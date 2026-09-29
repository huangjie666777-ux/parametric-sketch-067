import { constraintResidual, GeometryError, pointMap } from "./geometry";
import { solve } from "./solver";
import type { Constraint, Point, Segment, SketchDoc, SolveResult } from "./types";

export const MAX_POINTS = 20;

export function emptyDoc(): SketchDoc {
  return { points: [], segments: [], constraints: [], seq: 1 };
}

export function cloneDoc(doc: SketchDoc): SketchDoc {
  return {
    points: doc.points.map((p) => ({ ...p })),
    segments: doc.segments.map((s) => ({ ...s })),
    constraints: doc.constraints.map((c) => ({
      ...c,
      points: c.points ? ([...c.points] as Constraint["points"]) : undefined,
      segments: c.segments ? ([...c.segments] as Constraint["segments"]) : undefined,
      fix: c.fix ? { ...c.fix } : undefined,
    })),
    seq: doc.seq,
  };
}

function nextId(doc: SketchDoc, prefix: string): string {
  const id = `${prefix}${doc.seq}`;
  doc.seq += 1;
  return id;
}

function requirePoint(doc: SketchDoc, id: string): Point {
  const p = doc.points.find((q) => q.id === id);
  if (!p) throw new GeometryError(`未知点引用: ${id}`);
  return p;
}

function requireSegment(doc: SketchDoc, id: string): Segment {
  const s = doc.segments.find((q) => q.id === id);
  if (!s) throw new GeometryError(`未知线段引用: ${id}`);
  return s;
}

export function addPoint(doc: SketchDoc, x: number, y: number): string {
  if (doc.points.length >= MAX_POINTS) throw new GeometryError(`最多 ${MAX_POINTS} 个点`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new GeometryError("坐标必须是有限数值");
  const id = nextId(doc, "p");
  doc.points.push({ id, x, y });
  return id;
}

export function addSegment(doc: SketchDoc, aId: string, bId: string): string {
  const a = requirePoint(doc, aId);
  const b = requirePoint(doc, bId);
  if (aId === bId) throw new GeometryError("零长线: 线段两端不能为同一点");
  if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) throw new GeometryError("零长线: 两点重合");
  const id = nextId(doc, "s");
  doc.segments.push({ id, a: aId, b: bId });
  return id;
}

function findDuplicate(doc: SketchDoc, c: Omit<Constraint, "id">): boolean {
  const sameRefs = (a: string[] | undefined, b: string[] | undefined) => {
    if (a === undefined && b === undefined) return true;
    if (!a || !b || a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
  };
  return doc.constraints.some(
    (x) =>
      x.type === c.type &&
      sameRefs(x.points as string[] | undefined, c.points as string[] | undefined) &&
      sameRefs(x.segments as string[] | undefined, c.segments as string[] | undefined),
  );
}

export function addConstraint(doc: SketchDoc, c: Omit<Constraint, "id">): string {
  validateConstraintData(doc, c);
  if (findDuplicate(doc, c)) throw new GeometryError("冗余关系已存在，不能重复添加");
  const id = nextId(doc, "c");
  doc.constraints.push({ ...c, id } as Constraint);
  return id;
}

export function validateConstraintData(doc: SketchDoc, c: Omit<Constraint, "id">): void {
  switch (c.type) {
    case "coincident": {
      if (!c.points || c.points.length !== 2) throw new GeometryError("点重合需要两个点");
      const [a, b] = c.points;
      requirePoint(doc, a);
      requirePoint(doc, b);
      if (a === b) throw new GeometryError("不能约束同一点重合");
      break;
    }
    case "horizontal":
    case "vertical": {
      if (!c.segments || c.segments.length !== 1) throw new GeometryError("需要一条线段");
      requireSegment(doc, c.segments[0]);
      break;
    }
    case "perpendicular": {
      if (!c.segments || c.segments.length !== 2) throw new GeometryError("垂直约束需要两条线段");
      requireSegment(doc, c.segments[0]);
      requireSegment(doc, c.segments[1]);
      if (c.segments[0] === c.segments[1]) throw new GeometryError("不能约束线段与自身垂直");
      break;
    }
    case "distance": {
      if (!c.points || c.points.length !== 2) throw new GeometryError("距离约束需要两个点");
      requirePoint(doc, c.points[0]);
      requirePoint(doc, c.points[1]);
      if (c.points[0] === c.points[1]) throw new GeometryError("零长线: 距离约束不能作用于同一点");
      if (typeof c.value !== "number" || !Number.isFinite(c.value) || c.value <= 0) {
        throw new GeometryError("距离必须是有限正数");
      }
      break;
    }
    case "fixed": {
      if (!c.points || c.points.length !== 1) throw new GeometryError("固定约束需要一个点");
      const p = requirePoint(doc, c.points[0]);
      if (!c.fix || !Number.isFinite(c.fix.x) || !Number.isFinite(c.fix.y)) {
        throw new GeometryError("固定坐标必须是有限数值");
      }
      void p;
      break;
    }
  }
}

export function updateDistance(doc: SketchDoc, constraintId: string, value: number): void {
  const c = doc.constraints.find((q) => q.id === constraintId);
  if (!c) throw new GeometryError(`未知约束引用: ${constraintId}`);
  if (c.type !== "distance") throw new GeometryError("只能修改距离约束");
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new GeometryError("距离必须是有限正数");
  }
  c.value = value;
}

export function deletePoint(doc: SketchDoc, id: string): void {
  if (!doc.points.some((p) => p.id === id)) throw new GeometryError(`未知点引用: ${id}`);
  const segIds = new Set(
    doc.segments.filter((s) => s.a === id || s.b === id).map((s) => s.id),
  );
  doc.segments = doc.segments.filter((s) => !segIds.has(s.id));
  doc.constraints = doc.constraints.filter((c) => {
    if (c.points?.includes(id)) return false;
    if (c.segments?.some((sid) => segIds.has(sid))) return false;
    return true;
  });
  doc.points = doc.points.filter((p) => p.id !== id);
}

export function deleteSegment(doc: SketchDoc, id: string): void {
  if (!doc.segments.some((s) => s.id === id)) throw new GeometryError(`未知线段引用: ${id}`);
  doc.segments = doc.segments.filter((s) => s.id !== id);
  doc.constraints = doc.constraints.filter((c) => !c.segments?.includes(id));
}

export function deleteConstraint(doc: SketchDoc, id: string): void {
  if (!doc.constraints.some((c) => c.id === id)) throw new GeometryError(`未知约束引用: ${id}`);
  doc.constraints = doc.constraints.filter((c) => c.id !== id);
}

/** Validate that every constraint reference resolves and no zero-length segments exist. */
export function validateDoc(doc: SketchDoc): void {
  for (const s of doc.segments) {
    const a = requirePoint(doc, s.a);
    const b = requirePoint(doc, s.b);
    if (s.a === s.b || Math.hypot(a.x - b.x, a.y - b.y) < 1e-9) {
      throw new GeometryError(`零长线: ${s.id}`);
    }
  }
  const pm = pointMap(doc.points);
  const sm = new Map(doc.segments.map((s) => [s.id, s]));
  for (const c of doc.constraints) {
    validateConstraintData(doc, c);
    constraintResidual(c, pm, sm); // throws on unknown references
  }
}

/** Run the solver against a working copy; returns positions without mutating. */
export function solveDoc(doc: SketchDoc, soft?: { pointId: string; x: number; y: number }): SolveResult {
  return solve(doc.points, doc.constraints, doc.segments, soft);
}
