import { addConstraint, addPoint, addSegment, emptyDoc } from "./model";
import type { SketchDoc } from "./types";

/** Rectangle: p1 bottom-left fixed; width/height are editable distance constraints. */
export function makeRectangle(width = 60, height = 40): SketchDoc {
  const doc = emptyDoc();
  const p1 = addPoint(doc, 0, 0);
  const p2 = addPoint(doc, width, 0);
  const p3 = addPoint(doc, width, height);
  const p4 = addPoint(doc, 0, height);
  const s1 = addSegment(doc, p1, p2);
  const s2 = addSegment(doc, p2, p3);
  const s3 = addSegment(doc, p3, p4);
  const s4 = addSegment(doc, p4, p1);
  void s1; void s2; void s3; void s4;
  addConstraint(doc, { type: "fixed", points: [p1], fix: { x: 0, y: 0 } });
  addConstraint(doc, { type: "horizontal", segments: [doc.segments[0].id] });
  addConstraint(doc, { type: "horizontal", segments: [doc.segments[2].id] });
  addConstraint(doc, { type: "vertical", segments: [doc.segments[1].id] });
  addConstraint(doc, { type: "vertical", segments: [doc.segments[3].id] });
  addConstraint(doc, { type: "distance", points: [p1, p2], value: width });
  addConstraint(doc, { type: "distance", points: [p2, p3], value: height });
  return doc;
}

/** Fixed-length connecting rod: left end fixed, right end draggable at fixed radius. */
export function makeRod(length = 80): SketchDoc {
  const doc = emptyDoc();
  const p1 = addPoint(doc, -40, 0);
  const p2 = addPoint(doc, -40 + length, 0);
  addSegment(doc, p1, p2);
  addConstraint(doc, { type: "fixed", points: [p1], fix: { x: -40, y: 0 } });
  addConstraint(doc, { type: "distance", points: [p1, p2], value: length });
  return doc;
}
