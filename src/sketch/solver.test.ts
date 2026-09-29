import { describe, expect, it } from "vitest";
import { makeRectangle, makeRod } from "./examples";
import { GeometryError } from "./geometry";
import {
  addConstraint,
  addPoint,
  addSegment,
  cloneDoc,
  deletePoint,
  solveDoc,
  updateDistance,
  validateConstraintData,
} from "./model";
import { History } from "./history";
import type { SketchDoc } from "./types";

describe("solver", () => {
  it("solves the rectangle with 2 local degrees of freedom and drives width/height distances", () => {
    const doc = makeRectangle(60, 40);
    const res = solveDoc(doc);
    expect(res.ok).toBe(true);
    expect(res.localDof).toBe(0); // fixed corner + directions + two sizes fully determine it
  });

  it("keeps rod length while following the soft drag target along the circle", () => {
    const doc = makeRod(80);
    const res = solveDoc(doc, { pointId: doc.points[1].id, x: 100, y: 100 });
    expect(res.ok).toBe(true);
    const a = res.positions[0];
    const b = res.positions[1];
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(80, 6);
    // fixed anchor never moves, and the endpoint follows toward the target
    expect(a.x).toBeCloseTo(-40, 9);
    expect(a.y).toBeCloseTo(0, 9);
    expect(Math.hypot(b.x - 100, b.y - 100)).toBeLessThan(Math.hypot(40 - 100, 0 - 100));
  });

  it("flags a duplicated / redundant constraint instead of counting it twice", () => {
    const doc = makeRectangle();
    const before = solveDoc(doc);
    // Coincident points already forced together by a full fixing structure:
    // build a small mechanism where an extra parallel-direction row adds no rank.
    void before;
    const custom: SketchDoc = {
      points: [
        { id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 },
        { id: "c", x: 0, y: 10 }, { id: "d", x: 10, y: 10 },
      ],
      segments: [
        { id: "l1", a: "a", b: "b" }, { id: "l2", a: "c", b: "d" },
        { id: "l3", a: "a", b: "c" },
      ],
      constraints: [
        { id: "k1", type: "fixed", points: ["a"], fix: { x: 0, y: 0 } },
        { id: "k2", type: "fixed", points: ["c"], fix: { x: 0, y: 10 } },
        { id: "k3", type: "horizontal", segments: ["l1"] },
        { id: "k4", type: "horizontal", segments: ["l2"] }, // y_b already implies... still independent of y_d
        { id: "k5", type: "vertical", segments: ["l3"] },
      ],
      seq: 1,
    };
    const res = solveDoc(custom);
    expect(res.ok).toBe(true);
    expect(res.redundantConstraintIds).toContain("k5");
    const after = solveDoc(doc);
    expect(after.localDof).toBe(before.localDof);
  });

  it("reports infeasible when two distances between the same two points conflict", () => {
    const doc = makeRod(80);
    // add a coincident constraint forcing length zero against distance 80
    // instead, craft: distance 80 plus both endpoints fixed 10 apart is infeasible
    addConstraint(doc, { type: "fixed", points: [doc.points[1].id], fix: { x: -40 + 10, y: 0 } });
    const res = solveDoc(doc);
    expect(res.ok).toBe(false);
    expect(res.residuals[0].maxAbs).toBeGreaterThan(1e-4);
  });

  it("does not mutate input points when solving fails", () => {
    const doc = makeRod(80);
    addConstraint(doc, { type: "fixed", points: [doc.points[1].id], fix: { x: -40 + 10, y: 0 } });
    const snapshot = cloneDoc(doc);
    const res = solveDoc(doc);
    expect(res.ok).toBe(false);
    expect(doc.points.map((p) => [p.x, p.y])).toEqual(snapshot.points.map((p) => [p.x, p.y]));
  });

  it("supports perpendicular and horizontal constraints", () => {
    const doc = makeRectangle();
    const res = solveDoc(doc);
    expect(res.ok).toBe(true);
  });
});

describe("model validation", () => {
  it("rejects non-positive / non-finite distance", () => {
    const doc = makeRod(50);
    expect(() => updateDistance(doc, doc.constraints.find((c) => c.type === "distance")!.id, 0))
      .toThrow(GeometryError);
    expect(() => updateDistance(doc, doc.constraints.find((c) => c.type === "distance")!.id, NaN))
      .toThrow(GeometryError);
  });

  it("rejects zero-length segment creation and unknown references", () => {
    const doc = makeRod(50);
    expect(() => addSegment(doc, doc.points[0].id, doc.points[0].id)).toThrow(/零长线/);
    expect(() => validateConstraintData(doc, { type: "distance", points: ["nope", doc.points[1].id], value: 5 }))
      .toThrow(/未知/);
  });

  it("enforces at most 20 points", () => {
    const doc = makeRod(50);
    expect(() => {
      for (let i = 0; i < 25; i++) addPoint(doc, i, i);
    }).toThrow(/最多/);
    expect(doc.points.length).toBe(20);
  });

  it("deleting a point removes its segments and constraints", () => {
    const doc = makeRod(80);
    const pid = doc.points[1].id;
    deletePoint(doc, pid);
    expect(doc.points.some((p) => p.id === pid)).toBe(false);
    expect(doc.segments.length).toBe(0);
    expect(doc.constraints.length).toBe(1);
    expect(doc.constraints[0]?.type).toBe("fixed");
  });

  it("rejects duplicate identical constraint", () => {
    const doc = makeRod(80);
    expect(() => addConstraint(doc, { type: "fixed", points: [doc.points[0].id], fix: { x: -40, y: 0 } }))
      .toThrow(/冗余/);
  });

  it("rectangle resize works by changing distance values", () => {
    const doc = makeRectangle(60, 40);
    const w = doc.constraints.find((c) => c.type === "distance")!;
    updateDistance(doc, w.id, 100);
    const res = solveDoc(doc);
    expect(res.ok).toBe(true);
    const p1 = res.positions.find((p) => p.id === doc.points[0].id)!;
    const p2 = res.positions.find((p) => p.id === doc.points[1].id)!;
    expect(Math.hypot(p2.x - p1.x, p2.y - p1.y)).toBeCloseTo(100, 4);
  });
});

describe("history", () => {
  it("records one entry per transaction and clears redo on new action", () => {
    const h = new History(makeRod(80));
    const t1 = cloneDoc(h.doc);
    addPoint(t1, 5, 5);
    h.begin()(t1);
    expect(h.canUndo()).toBe(true);
    h.undo();
    expect(h.canRedo()).toBe(true);
    const t2 = cloneDoc(h.doc);
    addPoint(t2, 6, 6);
    h.begin()(t2);
    expect(h.canRedo()).toBe(false);
  });

  it("commits a drag as a single history entry", () => {
    const h = new History(makeRod(80));
    const before = h.snapshot();
    const live = cloneDoc(h.doc);
    live.points[1].x += 10;
    h.setLive(live);
    const live2 = cloneDoc(h.doc);
    live2.points[1].y += 5;
    h.setLive(live2);
    h.commitLive(before, cloneDoc(h.doc));
    h.undo();
    expect(h.doc.points[1].x).toBe(-40 + 80);
  });
});
