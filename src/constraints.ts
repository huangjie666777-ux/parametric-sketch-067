import { finiteNumber } from "./geometry";
import { nextId } from "./identity";
import type { Constraint, LineId, PointId } from "./types";

export function coincidentConstraint(a: PointId, b: PointId): Constraint {
  if (a === b) throw new Error("两个不同的点才能重合");
  return { id: nextId("c"), type: "coincident", a, b };
}

export function lineOrientationConstraint(type: "horizontal" | "vertical", line: LineId): Constraint {
  return { id: nextId("c"), type, line };
}

export function perpendicularConstraint(a: LineId, b: LineId): Constraint {
  if (a === b) throw new Error("请选择两条不同线段");
  return { id: nextId("c"), type: "perpendicular", a, b };
}

export function distanceConstraint(a: PointId, b: PointId, value: number): Constraint {
  if (a === b) throw new Error("两个不同的点才能设置距离");
  if (!finiteNumber(value) || value <= 0) throw new Error("距离必须是有限正数");
  return { id: nextId("c"), type: "distance", a, b, value };
}

export function fixedPointConstraint(point: PointId, x: number, y: number): Constraint {
  if (!finiteNumber(x) || !finiteNumber(y)) throw new Error("固定坐标必须是有限数值");
  return { id: nextId("c"), type: "fixed", point, x, y };
}

export function hasEquivalentConstraint(constraints: Constraint[], candidate: Constraint): boolean {
  return constraints.some((existing) => {
    if (existing.type !== candidate.type) return false;
    if (existing.type === "coincident" && candidate.type === "coincident") {
      return samePair(existing.a, existing.b, candidate.a, candidate.b);
    }
    if (existing.type === "perpendicular" && candidate.type === "perpendicular") {
      return samePair(existing.a, existing.b, candidate.a, candidate.b);
    }
    if (existing.type === "horizontal" || existing.type === "vertical") return existing.type === candidate.type && existing.line === candidate.line;
    if (existing.type === "distance" && candidate.type === "distance") return samePair(existing.a, existing.b, candidate.a, candidate.b);
    return existing.type === "fixed" && candidate.type === "fixed" && existing.point === candidate.point;
  });
}

function samePair(a: string, b: string, c: string, d: string): boolean {
  return (a === c && b === d) || (a === d && b === c);
}
