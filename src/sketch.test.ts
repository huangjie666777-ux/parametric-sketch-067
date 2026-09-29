import { describe, expect, it } from "vitest";
import { addLine, addPoint, deletePoint, emptyDocument, validateDocument } from "./geometry";
import { coincidentConstraint, distanceConstraint, fixedPointConstraint, lineOrientationConstraint } from "./constraints";
import { createRectangleExample } from "./examples";
import { DocumentHistory } from "./history";
import { solveSketch } from "./solver";
import type { Constraint } from "./types";

describe("constraint solver", () => {
  it("resizes a rectangle while preserving orthogonal relations", () => {
    const doc = createRectangleExample();
    const width = doc.constraints.find((constraint): constraint is Extract<Constraint, { type: "distance" }> => constraint.type === "distance" && constraint.value === 100)!;
    const height = doc.constraints.find((constraint): constraint is Extract<Constraint, { type: "distance" }> => constraint.type === "distance" && constraint.value === 60)!;
    width.value = 130;
    height.value = 75;
    const result = solveSketch(doc);
    expect(result.ok).toBe(true);
    expect(result.dof).toBe(2);
    expect(result.redundantEquations).toBe(0);
    const points = Object.fromEntries(Object.entries(result.positions).map(([id, [x, y]]) => [id, { x, y }]));
    const lines = Object.values(doc.lines).map((line) => [points[line.a], points[line.b]] as const);
    expect(Math.abs(lines[0][0].y - lines[0][1].y)).toBeLessThan(1e-5);
    expect(Math.abs(lines[1][0].x - lines[1][1].x)).toBeLessThan(1e-5);
    expect(Math.hypot(lines[0][1].x - lines[0][0].x, lines[0][1].y - lines[0][0].y)).toBeCloseTo(130, 5);
    expect(Math.hypot(lines[1][1].x - lines[1][0].x, lines[1][1].y - lines[1][0].y)).toBeCloseTo(75, 5);
  });

  it("treats the mouse as a soft target and preserves a fixed pivot and rod length", () => {
    const doc = emptyDocument();
    const pivot = addPoint(doc, 0, 0);
    const end = addPoint(doc, 80, 0);
    addLine(doc, pivot.id, end.id);
    doc.constraints.push(distanceConstraint(pivot.id, end.id, 80), fixedPointConstraint(pivot.id, 0, 0));
    const result = solveSketch(doc, { targets: { [end.id]: { x: 100, y: 10, weight: 0.08 } } });
    expect(result.ok).toBe(true);
    const [px, py] = result.positions[pivot.id];
    const [ex, ey] = result.positions[end.id];
    expect(Math.hypot(px, py)).toBeLessThan(1e-6);
    expect(Math.hypot(ex - px, ey - py)).toBeCloseTo(80, 5);
    expect(ex).toBeGreaterThan(79);
  });

  it("reports rank and local degrees of freedom for a coincident point pair", () => {
    const doc = emptyDocument();
    const a = addPoint(doc, 0, 0);
    const b = addPoint(doc, 3, 4);
    doc.constraints.push(coincidentConstraint(a.id, b.id));
    const result = solveSketch(doc);
    expect(result.ok).toBe(true);
    expect(result.rank).toBe(2);
    expect(result.dof).toBe(2);
  });

  it("rejects invalid reference and non-positive distance", () => {
    const doc = emptyDocument();
    const a = addPoint(doc, 0, 0);
    const b = addPoint(doc, 1, 0);
    doc.constraints.push(distanceConstraint(a.id, b.id, 1));
    const bad = { ...distanceConstraint(a.id, b.id, 1), b: "missing" };
    doc.constraints.push(bad);
    expect(validateDocument(doc).join(";")).toContain("不存在的点");
    expect(() => distanceConstraint(a.id, b.id, 0)).toThrow("有限正数");
  });

  it("rejects a zero-length line at creation", () => {
    const doc = emptyDocument();
    const a = addPoint(doc, 1, 1);
    expect(() => addLine(doc, a.id, a.id)).toThrow("零长线");
  });
});

describe("document editing", () => {
  it("deletes connected lines and constraints with a point and supports undo", () => {
    const doc = emptyDocument();
    const a = addPoint(doc, 0, 0);
    const b = addPoint(doc, 10, 0);
    addLine(doc, a.id, b.id);
    doc.constraints.push(distanceConstraint(a.id, b.id, 10));
    const history = new DocumentHistory(doc);
    const next = history.current;
    deletePoint(next, a.id);
    expect(Object.keys(next.points)).toHaveLength(1);
    expect(Object.keys(next.lines)).toHaveLength(0);
    expect(next.constraints).toHaveLength(0);
    history.commit(next);
    const undone = history.undo();
    expect(Object.keys(undone.points)).toHaveLength(2);
    expect(Object.keys(undone.lines)).toHaveLength(1);
    expect(undone.constraints).toHaveLength(1);
    expect(history.canRedo).toBe(true);
  });

  it("removes line orientation constraints when deleting the line", () => {
    const doc = emptyDocument();
    const a = addPoint(doc, 0, 0);
    const b = addPoint(doc, 10, 0);
    const line = addLine(doc, a.id, b.id);
    doc.constraints.push(lineOrientationConstraint("horizontal", line.id));
    expect(solveSketch(doc).ok).toBe(true);
    deletePoint(doc, b.id);
    expect(doc.constraints).toHaveLength(0);
    expect(validateDocument(doc)).toEqual([]);
  });
});
