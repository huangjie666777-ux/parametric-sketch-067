export interface Vec2 {
  x: number;
  y: number;
}

export interface Point {
  id: string;
  x: number;
  y: number;
}

export interface Segment {
  id: string;
  a: string;
  b: string;
}

export type ConstraintType =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "perpendicular"
  | "distance"
  | "fixed";

export interface Constraint {
  id: string;
  type: ConstraintType;
  /** 2 ids for coincident/distance, 1 id for fixed. */
  points?: [string, string] | [string];
  /** 1 id for horizontal/vertical, 2 ids for perpendicular. */
  segments?: [string] | [string, string];
  /** Distance in millimetres (distance constraint). */
  value?: number;
  /** Coordinates locked when a fixed constraint was created. */
  fix?: Vec2;
}

export interface SketchDoc {
  points: Point[];
  segments: Segment[];
  constraints: Constraint[];
  seq: number;
}

export interface Selection {
  points: string[];
  segments: string[];
}

export interface ResidualInfo {
  constraintId: string;
  type: ConstraintType;
  maxAbs: number;
}

export interface SolveResult {
  ok: boolean;
  converged: boolean;
  positions: Point[];
  iterations: number;
  residuals: ResidualInfo[];
  /** Local degrees of freedom: 2 * pointCount - rank(jacobian). */
  localDof: number;
  /** Ids of constraint rows that add no rank (redundant/duplicate). */
  redundantConstraintIds: string[];
}
