import { Matrix, SVD } from "ml-matrix";
import { MIN_LINE_LENGTH, validateDocument } from "./geometry";
import type { Constraint, ConstraintResidual, PointId, SketchDocument, SketchLine, SolveResult } from "./types";

export const SOLVER_ABS_TOLERANCE = 1e-6;
export const SOLVER_CONVERGED_RMS = 1e-8;
const MAX_ITERATIONS = 80;
const EPS = 1e-7;

export interface SolveOptions {
  targets?: Partial<Record<PointId, { x: number; y: number; weight?: number }>>;
  stayWeight?: number;
}

interface Evaluation {
  rows: number[];
  details: ConstraintResidual[];
  zeroLengthLines: string[];
}

export function solveSketch(document: SketchDocument, options: SolveOptions = {}): SolveResult {
  const errors = validateDocument(document);
  if (errors.length > 0) {
    return failureResult(document, [], [], 0, 0, errors.map((message) => new Error(message)).join("; "));
  }

  const pointIds = Object.keys(document.points);
  const initial = pointIds.flatMap((id) => [document.points[id].x, document.points[id].y]);
  const original = [...initial];
  let current = [...initial];
  let lastEvaluation = evaluate(document, pointIds, current);
  let iterations = 0;
  let converged = false;

  for (iterations = 0; iterations < MAX_ITERATIONS; iterations += 1) {
    const hardJ = numericalJacobian(document, pointIds, current);
    const soft = buildSoftRows(pointIds, original, current, options);
    const currentHardNorm = norm(lastEvaluation.rows);
    let accepted: number[] | null = null;

  for (const damping of [0, 1e-12, 1e-9, 1e-6, 1e-3, 1, 100]) {
      const rawStep = constrainedStep(hardJ, soft.jacobian, soft.rows, lastEvaluation.rows, current, damping);
      for (const stepScale of [1, 0.5, 0.25, 0.1, 0.03, 0.01]) {
        const candidate = current.map((value, index) => value + rawStep[index] * stepScale);
        if (candidate.some((value) => !Number.isFinite(value))) continue;
        const candidateEvaluation = evaluate(document, pointIds, candidate);
        if (candidateEvaluation.zeroLengthLines.length > 0 && lastEvaluation.zeroLengthLines.length === 0) continue;
        const stepNorm = stepScale * movement(rawStep, current.map(() => 0));
        const quadraticAllowance = currentHardNorm <= SOLVER_ABS_TOLERANCE ? stepNorm ** 2 * 0.02 + SOLVER_CONVERGED_RMS : 0;
        const reductionRequired = currentHardNorm <= SOLVER_ABS_TOLERANCE ? 1 + 1e-8 : 1.01;
        if (norm(candidateEvaluation.rows) <= currentHardNorm * reductionRequired + quadraticAllowance) {
          accepted = candidate;
          lastEvaluation = candidateEvaluation;
          break;
        }
      }
      if (accepted) break;
    }

    if (!accepted) break;
    const stepSize = movement(accepted, current);
    current = accepted;
    if (rmsOf(lastEvaluation.rows) <= SOLVER_CONVERGED_RMS && lastEvaluation.zeroLengthLines.length === 0) {
      converged = true;
      if (stepSize < 1e-9) break;
    }
  }

  const finalHardJ = numericalJacobian(document, pointIds, current);
  const rankInfo = matrixRank(finalHardJ);
  const independentVariables = pointIds.length * 2;
  const equationCount = lastEvaluation.rows.length;
  const residual = rmsOf(lastEvaluation.rows);
  const maxResidual = Math.max(0, ...lastEvaluation.details.map((item) => item.magnitude));
  const ok = converged && maxResidual <= SOLVER_ABS_TOLERANCE && lastEvaluation.zeroLengthLines.length === 0;
  const positions = Object.fromEntries(pointIds.map((id, index) => [id, [current[index * 2], current[index * 2 + 1]]]));

  return {
    ok,
    positions,
    converged,
    residual,
    rank: rankInfo.rank,
    dof: Math.max(0, independentVariables - rankInfo.rank),
    redundantEquations: Math.max(0, equationCount - rankInfo.rank),
    largestResiduals: lastEvaluation.details.slice().sort((a, b) => b.magnitude - a.magnitude).slice(0, 5),
    zeroLengthLines: lastEvaluation.zeroLengthLines,
    iterations,
  };
}

function failureResult(
  document: SketchDocument,
  details: ConstraintResidual[],
  zeroLengthLines: string[],
  iterations: number,
  rank: number,
  _message: string,
): SolveResult {
  return {
    ok: false,
    positions: Object.fromEntries(Object.values(document.points).map((p) => [p.id, [p.x, p.y]])),
    converged: false,
    residual: details.length ? Math.max(...details.map((d) => d.magnitude)) : Number.POSITIVE_INFINITY,
    rank,
    dof: Math.max(0, Object.keys(document.points).length * 2 - rank),
    redundantEquations: 0,
    largestResiduals: details,
    zeroLengthLines,
    iterations,
  };
}

function evaluate(document: SketchDocument, pointIds: PointId[], x: number[]): Evaluation {
  const points = Object.fromEntries(pointIds.map((id, index) => [id, { id, x: x[index * 2], y: x[index * 2 + 1] }]));
  const rows: number[] = [];
  const details: ConstraintResidual[] = [];
  const zeroLengthLines: string[] = [];

  const point = (id: PointId) => points[id];
  const line = (id: string) => document.lines[id];
  const vector = (l: SketchLine) => { const a = point(l.a); const b = point(l.b); return { dx: b.x - a.x, dy: b.y - a.y, length: Math.hypot(b.x - a.x, b.y - a.y) }; };
  const add = (constraint: Constraint, values: number[]) => {
    rows.push(...values);
    details.push({ constraintId: constraint.id, type: constraint.type, values, magnitude: Math.max(...values.map((v) => Math.abs(v)), 0) });
  };

  for (const l of Object.values(document.lines)) {
    if (vector(l).length < MIN_LINE_LENGTH) zeroLengthLines.push(l.id);
  }

  for (const constraint of document.constraints) {
    if (constraint.type === "coincident") {
      const a = point(constraint.a); const b = point(constraint.b);
      add(constraint, [b.x - a.x, b.y - a.y]);
    } else if (constraint.type === "distance") {
      const a = point(constraint.a); const b = point(constraint.b);
      add(constraint, [Math.hypot(b.x - a.x, b.y - a.y) - constraint.value]);
    } else if (constraint.type === "fixed") {
      const p = point(constraint.point);
      add(constraint, [p.x - constraint.x, p.y - constraint.y]);
    } else if (constraint.type === "horizontal" || constraint.type === "vertical") {
      const v = vector(line(constraint.line));
      add(constraint, [constraint.type === "horizontal" ? v.dy : v.dx]);
    } else if (constraint.type === "perpendicular") {
      const u = vector(line(constraint.a)); const v = vector(line(constraint.b));
      const residual = u.length < MIN_LINE_LENGTH || v.length < MIN_LINE_LENGTH ? 0 : (u.dx * v.dx + u.dy * v.dy) / (u.length * v.length);
      add(constraint, [residual]);
    }
  }

  return { rows, details, zeroLengthLines };
}

function numericalJacobian(document: SketchDocument, pointIds: PointId[], x: number[]): number[][] {
  const indexOf = new Map(pointIds.map((id, index) => [id, index]));
  const jacobian: number[][] = [];
  const point = (id: PointId) => ({ x: x[indexOf.get(id)! * 2], y: x[indexOf.get(id)! * 2 + 1] });
  const empty = () => Array.from({ length: x.length }, () => 0);
  const addScalar = (row: number[], pointId: PointId, dx: number, dy: number) => {
    const index = indexOf.get(pointId)!;
    row[index * 2] += dx;
    row[index * 2 + 1] += dy;
  };

  for (const constraint of document.constraints) {
    if (constraint.type === "coincident") {
      const dx = empty(); const dy = empty();
      addScalar(dx, constraint.a, -1, 0); addScalar(dx, constraint.b, 1, 0);
      addScalar(dy, constraint.a, 0, -1); addScalar(dy, constraint.b, 0, 1);
      jacobian.push(dx, dy);
    } else if (constraint.type === "distance") {
      const a = point(constraint.a); const b = point(constraint.b);
      const dx = b.x - a.x; const dy = b.y - a.y;
      const length = Math.max(Math.hypot(dx, dy), 1e-12);
      const row = empty();
      addScalar(row, constraint.a, -dx / length, -dy / length);
      addScalar(row, constraint.b, dx / length, dy / length);
      jacobian.push(row);
    } else if (constraint.type === "fixed") {
      const dx = empty(); const dy = empty();
      addScalar(dx, constraint.point, 1, 0);
      addScalar(dy, constraint.point, 0, 1);
      jacobian.push(dx, dy);
    } else if (constraint.type === "horizontal" || constraint.type === "vertical") {
      const line = document.lines[constraint.line];
      const row = empty();
      if (constraint.type === "horizontal") {
        addScalar(row, line.a, 0, -1);
        addScalar(row, line.b, 0, 1);
      } else {
        addScalar(row, line.a, -1, 0);
        addScalar(row, line.b, 1, 0);
      }
      jacobian.push(row);
    } else if (constraint.type === "perpendicular") {
      const la = document.lines[constraint.a]; const lb = document.lines[constraint.b];
      const aa = point(la.a); const ab = point(la.b); const ba = point(lb.a); const bb = point(lb.b);
      const ux = ab.x - aa.x; const uy = ab.y - aa.y; const lu = Math.max(Math.hypot(ux, uy), MIN_LINE_LENGTH);
      const vx = bb.x - ba.x; const vy = bb.y - ba.y; const lv = Math.max(Math.hypot(vx, vy), MIN_LINE_LENGTH);
      const dot = ux * vx + uy * vy;
      const gux = vx / (lu * lv) - ux * dot / (lu ** 3 * lv);
      const guy = vy / (lu * lv) - uy * dot / (lu ** 3 * lv);
      const gvx = ux / (lu * lv) - vx * dot / (lu * lv ** 3);
      const gvy = uy / (lu * lv) - vy * dot / (lu * lv ** 3);
      const row = empty();
      addScalar(row, la.a, -gux, -guy);
      addScalar(row, la.b, gux, guy);
      addScalar(row, lb.a, -gvx, -gvy);
      addScalar(row, lb.b, gvx, gvy);
      jacobian.push(row);
    }
  }
  return jacobian;
}

function buildSoftRows(pointIds: PointId[], original: number[], current: number[], options: SolveOptions) {
  const rows: number[] = [];
  const jacobian: number[][] = [];
  if (options.targets) {
    for (const [id, target] of Object.entries(options.targets)) {
      const index = pointIds.indexOf(id);
      if (index < 0 || !target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) continue;
      const weight = Math.sqrt(Math.max(0, target.weight ?? 0.02));
      rows.push(weight * (current[index * 2] - target.x), weight * (current[index * 2 + 1] - target.y));
      jacobian.push(Array.from({ length: current.length }, (_, j) => (j === index * 2 ? weight : 0)));
      jacobian.push(Array.from({ length: current.length }, (_, j) => (j === index * 2 + 1 ? weight : 0)));
    }
  }
  return { rows, jacobian };
}

function constrainedStep(hardJ: number[][], softJ: number[][], softResidual: number[], hardResidual: number[], current: number[], damping: number): number[] {
  if (hardJ.length === 0) {
    const softGoal = softJ.length === 0
      ? current.map(() => 0)
      : new Matrix(softJ).transpose().mmul(Matrix.columnVector(softResidual.map((value) => -value))).to1DArray();
    return softGoal;
  }
  const j = new Matrix(hardJ);
  const n = current.length;
  const identity = Matrix.eye(n, n);
  const jj = j.mmul(j.transpose());
  for (let i = 0; i < jj.rows; i += 1) jj.set(i, i, jj.get(i, i) + damping);
  const jjSvd = new SVD(jj, { autoTranspose: true });
  const jT = j.transpose();
  const jjtInverse = jjSvd.inverse();
  const projector = identity.sub(jT.mmul(jjtInverse).mmul(j));
  const softUnconstrained = softJ.length === 0
    ? current.map(() => 0)
    : new Matrix(softJ).transpose().mmul(Matrix.columnVector(softResidual.map((value) => -value))).to1DArray();
  const tangentStep = projector.mmul(Matrix.columnVector(softUnconstrained));
  const correction = jT.mmul(jjtInverse).mmul(Matrix.columnVector(hardResidual.map((value) => -value)));
  const delta = tangentStep.add(correction).to1DArray();
  return delta;
}

function matrixRank(values: number[][]): { rank: number } {
  if (values.length === 0) return { rank: 0 };
  const svd = new SVD(new Matrix(values), { autoTranspose: true });
  const singular = svd.diagonal;
  const threshold = Math.max(values.length, values[0]?.length ?? 0) * (singular[0] ?? 0) * 1e-9;
  return { rank: singular.filter((value) => Math.abs(value) > threshold).length };
}

function norm(values: number[]): number {
  return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
}

function rmsOf(values: number[]): number {
  return values.length === 0 ? 0 : norm(values) / Math.sqrt(values.length);
}

function movement(a: number[], b: number[]): number {
  return Math.max(...a.map((value, index) => Math.abs(value - b[index])), 0);
}
