import { Matrix, SingularValueDecomposition } from "ml-matrix";
import { constraintResidual, pointMap } from "./geometry";
import type { Constraint, Point, ResidualInfo, Segment, SolveResult } from "./types";

export const TOL = 1e-6; // mm (perpendicular residual is a normalized dot product)
const MAX_ITER = 80;
const FD_REL = 1e-6;
const FD_MIN = 1e-5;
const TARGET_SCALE = 100; // 100 mm of drag deviation competes with 1 mm of hard residual
const STEP_CAP = 25; // mm per iteration

function fdStep(v: number): number {
  return Math.max(FD_MIN, Math.abs(v) * Math.sqrt(FD_REL));
}

export interface SoftTarget {
  pointId: string;
  x: number;
  y: number;
}

function hardRowCount(constraints: Constraint[]): number {
  return constraints.reduce(
    (k, c) => k + (c.type === "coincident" || c.type === "fixed" ? 2 : 1),
    0,
  );
}

/**
 * Constrained Gauss-Newton with null-space-projected drag follow:
 *  1. minimum-norm step restores hard constraints (SVD pseudoinverse);
 *  2. the soft drag step is projected into the null space of the hard Jacobian,
 *     so following the cursor can never move along a dimension-locking direction.
 * Steps commit only when hard residuals do not regress.
 */
export function solve(
  points: Point[],
  constraints: Constraint[],
  segments: Segment[],
  soft?: SoftTarget,
): SolveResult {
  const sm = new Map(segments.map((s) => [s.id, s]));
  const n = points.length;
  const dim = 2 * n;
  const hardCount = hardRowCount(constraints);
  let cur: Point[] = points.map((p) => ({ ...p }));

  const evalResidual = (pts: Point[]): number[] => {
    const pm = pointMap(pts);
    const r: number[] = [];
    for (const c of constraints) r.push(...constraintResidual(c, pm, sm));
    if (soft) {
      const p = pm.get(soft.pointId);
      if (p) {
        r.push((p.x - soft.x) / TARGET_SCALE, (p.y - soft.y) / TARGET_SCALE);
      }
    }
    return r;
  };

  const hardMaxOf = (r: number[]) => Math.max(0, ...r.slice(0, hardCount).map(Math.abs));
  const softMaxOf = (r: number[]) => Math.max(0, ...r.slice(hardCount).map(Math.abs));

  let prev = evalResidual(cur);
  let hardMax = hardMaxOf(prev);
  const SOFT_TOL = 5e-3; // ~0.5 mm target deviation
  let converged = hardMax <= TOL && (!soft || softMaxOf(prev) <= SOFT_TOL);
  let iterations = 0;

  if (!converged && prev.length > 0) {
    for (iterations = 0; iterations < MAX_ITER; iterations++) {
      const J = numericalJacobian(evalResidual, cur, prev);
      const Jh = new Matrix(J.slice(0, hardCount));

      // If hard constraints are violated, restore them first (no soft follow).
      if (hardMax > TOL) {
        const b = new Matrix(prev.slice(0, hardCount).map((v) => [-v]));
        const hardStep = new SingularValueDecomposition(Jh, { autoTranspose: true })
          .solve(b)
          .to1DArray();
        const candidate = applyStep(cur, hardStep);
        const candRes = evalResidual(candidate);
        const candHard = hardMaxOf(candRes);
        if (candHard < hardMax) {
          cur = candidate;
          prev = candRes;
          hardMax = candHard;
          continue;
        }
        break;
      }

      // Hard constraints satisfied: take a tangent drag step, then re-project
      // back onto the constraint manifold with a few Newton corrections.
      if (soft) {
        const Js = new Matrix(J.slice(hardCount));
        const b = new Matrix(prev.slice(hardCount).map((v) => [-v]));
        const softFull = new SingularValueDecomposition(Js, { autoTranspose: true })
          .solve(b)
          .to1DArray();
        let tangent = projectToNullSpace(softFull, Jh);
        const norm = Math.hypot(...tangent);
        if (norm <= 1e-9) {
          converged = true;
          break;
        }
        if (norm > STEP_CAP) tangent = tangent.map((v) => (v * STEP_CAP) / norm);

        let trial = applyStep(cur, tangent);
        // re-project onto the hard manifold (damped Newton)
        for (let k = 0; k < 20; k++) {
          const hr = evalResidual(trial).slice(0, hardCount);
          if (Math.max(0, ...hr.map(Math.abs)) <= 1e-9) break;
          const JhT = new Matrix(numericalJacobian(evalResidual, trial, evalResidual(trial)).slice(0, hardCount));
          const corr = new SingularValueDecomposition(JhT, { autoTranspose: true })
            .solve(new Matrix(hr.map((v) => [-v])))
            .to1DArray();
          trial = applyStep(trial, corr);
        }
        const candRes = evalResidual(trial);
        const candHard = hardMaxOf(candRes);
        if (candHard <= TOL && softMaxOf(candRes) < softMaxOf(prev) - 1e-12) {
          cur = trial;
          prev = candRes;
          hardMax = candHard;
          if (softMaxOf(candRes) <= SOFT_TOL) {
            converged = true;
            break;
          }
          continue;
        }
      }
      converged = true;
      break;
    }
  }

  const pm = pointMap(cur);
  const residuals: ResidualInfo[] = constraints.map((c) => {
    const vals = constraintResidual(c, pm, sm);
    return { constraintId: c.id, type: c.type, maxAbs: Math.max(0, ...vals.map(Math.abs)) };
  });
  const worst = Math.max(0, ...residuals.map((x) => x.maxAbs));
  const ok = converged && worst <= TOL * 10;

  const { rank, redundantConstraintIds } = rankAnalysis(cur, constraints, sm);
  const localDof = Math.max(0, dim - rank);

  return {
    ok,
    converged,
    positions: cur,
    iterations,
    residuals: residuals.sort((a, b) => b.maxAbs - a.maxAbs),
    localDof,
    redundantConstraintIds,
  };
}

function numericalJacobian(
  evalResidual: (pts: Point[]) => number[],
  pts: Point[],
  base: number[],
): number[][] {
  const J: number[][] = base.map(() => new Array(2 * pts.length).fill(0));
  for (let i = 0; i < pts.length; i++) {
    for (const coord of [0, 1] as const) {
      const trial = pts.map((p) => ({ ...p }));
      const delta = fdStep(coord === 0 ? trial[i]!.x : trial[i]!.y);
      if (coord === 0) trial[i]!.x += delta;
      else trial[i]!.y += delta;
      const rp = evalResidual(trial);
      for (let k = 0; k < rp.length; k++) {
        J[k]![2 * i + coord] = (rp[k]! - base[k]!) / delta;
      }
    }
  }
  return J;
}

function applyStep(pts: Point[], dx: number[]): Point[] {
  return pts.map((p, i) => ({
    ...p,
    x: p.x + dx[2 * i]!,
    y: p.y + dx[2 * i + 1]!,
  }));
}

/** Project v into the null space of A: v_null = (I - A^+ A) v. */
function projectToNullSpace(v: number[], A: Matrix): number[] {
  const pinv = new SingularValueDecomposition(A, { autoTranspose: true }).inverse();
  const vCol = new Matrix(v.map((x) => [x]));
  const projected = pinv.mmul(A).mmul(vCol);
  return v.map((x, i) => x - projected.get(i, 0));
}

/** Greedy constraint-block rank: independent blocks raise the SVD rank. */
function rankAnalysis(
  pts: Point[],
  constraints: Constraint[],
  sm: Map<string, Segment>,
): { rank: number; redundantConstraintIds: string[] } {
  const dim = 2 * pts.length;
  const pm = pointMap(pts);
  let active: number[][] = [];
  let rank = 0;
  const redundantConstraintIds: string[] = [];
  for (const c of constraints) {
    let vals: number[];
    try {
      vals = constraintResidual(c, pm, sm);
    } catch {
      redundantConstraintIds.push(c.id);
      continue;
    }
    const block: number[][] = [];
    for (let row = 0; row < vals.length; row++) {
      const grad = new Array(dim).fill(0);
      const base = vals[row]!;
      for (let i = 0; i < pts.length; i++) {
        for (const coord of [0, 1] as const) {
          const trial = pts.map((p) => ({ ...p }));
          const delta = fdStep(coord === 0 ? trial[i]!.x : trial[i]!.y);
          if (coord === 0) trial[i]!.x += delta;
          else trial[i]!.y += delta;
          const v2 = constraintResidual(c, pointMap(trial), sm)[row]!;
          grad[2 * i + coord] = (v2 - base) / delta;
        }
      }
      block.push(grad);
    }
    const newRank = numericRank(active.concat(block));
    if (newRank > rank) {
      rank = newRank;
      active = active.concat(block);
    } else {
      redundantConstraintIds.push(c.id);
    }
  }
  return { rank, redundantConstraintIds };
}

export function numericRank(rows: number[][]): number {
  if (rows.length === 0) return 0;
  const svd = new SingularValueDecomposition(new Matrix(rows), { autoTranspose: true });
  const s = svd.diagonal.map(Math.abs);
  const sMax = Math.max(...s, 1e-300);
  return s.filter((v) => v > sMax * 1e-9).length;
}
