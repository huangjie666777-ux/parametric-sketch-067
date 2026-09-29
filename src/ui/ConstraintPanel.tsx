import { useEffect, useState } from "react";
import { describeConstraint } from "../sketch/geometry";
import type { Constraint, Selection, SketchDoc, SolveResult } from "../sketch/types";
import type { SketchController } from "./useSketch";

type CKind = "coincident" | "horizontal" | "vertical" | "perpendicular" | "distance" | "fixed" | null;

function inferKind(sel: Selection): CKind {
  const np = sel.points.length;
  const ns = sel.segments.length;
  if (np === 2 && ns === 0) return "distance"; // 同时提供“点重合”按钮
  if (np === 1 && ns === 0) return "fixed";
  if (np === 0 && ns === 1) return "horizontal"; // 同时提供“竖直”
  if (np === 0 && ns === 2) return "perpendicular";
  return null;
}

export function ConstraintPanel({ ctl, highlighted, setHighlighted }: {
  ctl: SketchController;
  highlighted: string | null;
  setHighlighted: (id: string | null) => void;
}) {
  const { doc, status } = ctl.state;
  const sel = ctl.selection;
  const kind = inferKind(sel);
  const defaultDist = (() => {
    if (sel.points.length === 2) {
      const a = doc.points.find((p) => p.id === sel.points[0]);
      const b = doc.points.find((p) => p.id === sel.points[1]);
      if (a && b) return Math.max(0.001, Math.hypot(a.x - b.x, a.y - b.y));
    }
    return 10;
  })();
  const [dist, setDist] = useState(defaultDist);
  const selKey = sel.points.join(",");
  useEffect(() => {
    setDist(defaultDist);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  const add = (c: Parameters<SketchController["addConstraint"]>[0]) => ctl.addConstraint(c);

  return (
    <div className="panel">
      <h3>约束</h3>
      <div className="sel-info">
        已选点: {sel.points.join(", ") || "—"}<br />
        已选线: {sel.segments.join(", ") || "—"}
      </div>
      <div className="btn-grid">
        <button disabled={!(sel.points.length === 2)} onClick={() => add({
          type: "coincident", points: [sel.points[0], sel.points[1]],
        })}>点重合</button>
        <button disabled={!(sel.segments.length === 1)} onClick={() => add({
          type: "horizontal", segments: [sel.segments[0]],
        })}>线段水平</button>
        <button disabled={!(sel.segments.length === 1)} onClick={() => add({
          type: "vertical", segments: [sel.segments[0]],
        })}>线段竖直</button>
        <button disabled={!(sel.segments.length === 2)} onClick={() => add({
          type: "perpendicular", segments: [sel.segments[0], sel.segments[1]],
        })}>两线垂直</button>
        <button disabled={!(sel.points.length === 1)} onClick={() => {
          const p = doc.points.find((q) => q.id === sel.points[0])!;
          add({ type: "fixed", points: [sel.points[0]], fix: { x: p.x, y: p.y } });
        }}>固定点</button>
      </div>
      <div className="dist-row">
        <button disabled={!(sel.points.length === 2)} onClick={() => add({
          type: "distance", points: [sel.points[0], sel.points[1]], value: Number(dist),
        })}>两点距离</button>
        <input type="number" step="any" value={Number(dist.toFixed(4))}
          onChange={(e) => setDist(Number(e.target.value))} />
        <span>mm</span>
      </div>
      {kind === null && (sel.points.length > 0 || sel.segments.length > 0) && (
        <p className="hint">当前选择组合没有可添加的约束</p>
      )}
      <ConstraintList doc={doc} status={status} ctl={ctl}
        highlighted={highlighted} setHighlighted={setHighlighted} />
    </div>
  );
}

function ConstraintList({ doc, status, ctl, highlighted, setHighlighted }: {
  doc: SketchDoc;
  status: SolveResult | null;
  ctl: SketchController;
  highlighted: string | null;
  setHighlighted: (id: string | null) => void;
}) {
  const residualOf = new Map(status?.residuals.map((r) => [r.constraintId, r.maxAbs]));
  const redundant = new Set(status?.redundantConstraintIds ?? []);
  return (
    <>
      <h3>约束列表（{doc.constraints.length}）</h3>
      <ul className="constraint-list">
        {doc.constraints.map((c) => (
          <ConstraintRow key={c.id} c={c}
            residual={residualOf.get(c.id) ?? 0}
            redundant={redundant.has(c.id)}
            active={highlighted === c.id}
            onHover={setHighlighted}
            onChangeDistance={(v) => ctl.changeDistance(c.id, v)}
            onDelete={() => ctl.removeConstraint(c.id)} />
        ))}
        {doc.constraints.length === 0 && <li className="hint">暂无约束</li>}
      </ul>
    </>
  );
}

function ConstraintRow({ c, residual, redundant, active, onHover, onChangeDistance, onDelete }: {
  c: Constraint;
  residual: number;
  redundant: boolean;
  active: boolean;
  onHover: (id: string | null) => void;
  onChangeDistance: (v: number) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(c.value ?? ""));
  const bad = residual > 1e-5;
  return (
    <li
      className={`constraint-row${active ? " active" : ""}${bad ? " bad" : ""}`}
      onMouseEnter={() => onHover(c.id)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="c-text">{describeConstraint(c)}</span>
      {redundant && <span className="tag" title="与其他约束线性相关，未重复计为独立约束">冗余</span>}
      {bad && <span className="tag tag-bad" title={`残差 ${residual.toExponential(2)}`}>残差</span>}
      {c.type === "distance" && (
        editing ? (
          <input autoFocus type="number" step="any" defaultValue={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              const v = Number(text);
              if (Number.isFinite(v) && v > 0) onChangeDistance(v);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setEditing(false);
            }} />
        ) : (
          <button className="mini" onClick={() => { setText(String(c.value)); setEditing(true); }}>
            {c.value} mm ✎
          </button>
        )
      )}
      <button className="mini del" onClick={onDelete}>删除</button>
    </li>
  );
}
