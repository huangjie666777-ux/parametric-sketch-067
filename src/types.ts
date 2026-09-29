export type PointId = string;
export type LineId = string;
export type ConstraintId = string;

export interface SketchPoint {
  id: PointId;
  x: number;
  y: number;
}

export interface SketchLine {
  id: LineId;
  a: PointId;
  b: PointId;
}

export type Constraint =
  | { id: ConstraintId; type: "coincident"; a: PointId; b: PointId }
  | { id: ConstraintId; type: "horizontal"; line: LineId }
  | { id: ConstraintId; type: "vertical"; line: LineId }
  | { id: ConstraintId; type: "perpendicular"; a: LineId; b: LineId }
  | { id: ConstraintId; type: "distance"; a: PointId; b: PointId; value: number }
  | { id: ConstraintId; type: "fixed"; point: PointId; x: number; y: number };

export interface SketchDocument {
  points: Record<PointId, SketchPoint>;
  lines: Record<LineId, SketchLine>;
  constraints: Constraint[];
}

export interface ConstraintResidual {
  constraintId: ConstraintId;
  type: Constraint["type"];
  values: number[];
  magnitude: number;
}

export interface SolveResult {
  ok: boolean;
  positions: Record<PointId, number[]>;
  converged: boolean;
  residual: number;
  rank: number;
  dof: number;
  redundantEquations: number;
  largestResiduals: ConstraintResidual[];
  zeroLengthLines: string[];
  iterations: number;
}
