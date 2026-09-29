import type { Constraint, Point, Segment, Vec2 } from "./types";

export const EPS = 1e-9;

export function v(x: number, y: number): Vec2 {
  return { x, y };
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pointMap(points: Point[]): Map<string, Point> {
  return new Map(points.map((p) => [p.id, p]));
}

export class GeometryError extends Error {}

/** Per-constraint residual rows. Length is 1 or 2; values in mm where geometric. */
export function constraintResidual(
  c: Constraint,
  pm: Map<string, Point>,
  sm: Map<string, Segment>,
): number[] {
  const needPoint = (id: string): Point => {
    const p = pm.get(id);
    if (!p) throw new GeometryError(`未知点引用: ${id}`);
    return p;
  };
  const needSeg = (id: string): Segment => {
    const s = sm.get(id);
    if (!s) throw new GeometryError(`未知线段引用: ${id}`);
    return s;
  };
  const segVec = (id: string): Vec2 => {
    const s = needSeg(id);
    const a = needPoint(s.a);
    const b = needPoint(s.b);
    return { x: b.x - a.x, y: b.y - a.y };
  };
  switch (c.type) {
    case "coincident": {
      const [a, b] = c.points!;
      const pa = needPoint(a!);
      const pb = needPoint(b!);
      return [pa.x - pb.x, pa.y - pb.y];
    }
    case "horizontal": {
      const d = segVec(c.segments![0]!);
      return [d.y];
    }
    case "vertical": {
      const d = segVec(c.segments![0]!);
      return [d.x];
    }
    case "perpendicular": {
      const d1 = segVec(c.segments![0]!);
      const d2 = segVec(c.segments![1]!);
      const n1 = Math.hypot(d1.x, d1.y);
      const n2 = Math.hypot(d2.x, d2.y);
      // Zero-length segment: invalid configuration, push a unit-scale residual.
      if (n1 < 1e-7 || n2 < 1e-7) return [1];
      return [(d1.x * d2.x + d1.y * d2.y) / (n1 * n2)];
    }
    case "distance": {
      const [a, b] = c.points!;
      const pa = needPoint(a!);
      const pb = needPoint(b!);
      const d = dist(pa, pb);
      if (d < 1e-9) {
        // Undefined direction: use a smooth surrogate that still has gradient.
        return [-(c.value ?? 0), 0];
      }
      return [d - (c.value ?? 0)];
    }
    case "fixed": {
      const p = needPoint(c.points![0]);
      return [p.x - (c.fix?.x ?? p.x), p.y - (c.fix?.y ?? p.y)];
    }
  }
}

export function describeConstraint(c: Constraint): string {
  const segText = c.segments?.join("、") ?? "";
  const ptText = c.points?.join("、") ?? "";
  switch (c.type) {
    case "coincident":
      return `点重合 ${ptText}`;
    case "horizontal":
      return `水平 ${segText}`;
    case "vertical":
      return `竖直 ${segText}`;
    case "perpendicular":
      return `垂直 ${segText}`;
    case "distance":
      return `距离 ${ptText} = ${c.value} mm`;
    case "fixed":
      return `固定 ${ptText} (${c.fix?.x.toFixed(2)}, ${c.fix?.y.toFixed(2)})`;
  }
}
