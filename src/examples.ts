import { addLine, addPoint, emptyDocument } from "./geometry";
import { distanceConstraint, fixedPointConstraint, lineOrientationConstraint } from "./constraints";
import type { SketchDocument } from "./types";

export function createRectangleExample(): SketchDocument {
  const doc = emptyDocument();
  const p0 = addPoint(doc, -50, -30);
  const p1 = addPoint(doc, 50, -30);
  const p2 = addPoint(doc, 50, 30);
  const p3 = addPoint(doc, -50, 30);
  addLine(doc, p0.id, p1.id);
  addLine(doc, p1.id, p2.id);
  addLine(doc, p2.id, p3.id);
  addLine(doc, p3.id, p0.id);
  doc.constraints.push(lineOrientationConstraint("horizontal", Object.values(doc.lines)[0].id));
  doc.constraints.push(lineOrientationConstraint("horizontal", Object.values(doc.lines)[2].id));
  doc.constraints.push(lineOrientationConstraint("vertical", Object.values(doc.lines)[1].id));
  doc.constraints.push(lineOrientationConstraint("vertical", Object.values(doc.lines)[3].id));
  doc.constraints.push(distanceConstraint(p0.id, p1.id, 100));
  doc.constraints.push(distanceConstraint(p1.id, p2.id, 60));
  return doc;
}

export function createRodExample(): SketchDocument {
  const doc = emptyDocument();
  const pivot = addPoint(doc, -55, 0);
  const end = addPoint(doc, 25, 0);
  addLine(doc, pivot.id, end.id);
  doc.constraints.push(distanceConstraint(pivot.id, end.id, 80));
  doc.constraints.push(fixedPointConstraint(pivot.id, pivot.x, pivot.y));
  return doc;
}
