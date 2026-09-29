import type { Constraint, LineId, PointId, SketchDocument } from "./types";
import type { Selection } from "./useSketch";

interface Props {
  doc: SketchDocument;
  selection: Selection;
  selectedConstraintId: string | null;
  onAdd: (label: string, make: () => Constraint) => void;
  onUpdateDistance: (id: string, value: number) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string | null) => void;
}

export function ConstraintPanel({ doc, selection, selectedConstraintId, onAdd, onUpdateDistance, onDelete, onSelect }: Props) {
  const selectedPoints = selection.points.filter((id): id is PointId => Boolean(doc.points[id]));
  const selectedLines = selection.lines.filter((id): id is LineId => Boolean(doc.lines[id]));
  const pointLabel = (id: PointId) => `${id.slice(-3)}(${doc.points[id].x.toFixed(1)}, ${doc.points[id].y.toFixed(1)})`;
  const lineLabel = (id: LineId) => {
    const line = doc.lines[id];
    return `${id.slice(-3)}: ${line.a.slice(-3)}→${line.b.slice(-3)}`;
  };

  const addButtons = [
    { label: "两点重合", disabled: selectedPoints.length < 2, make: () => ({ id: "", type: "coincident" as const, a: selectedPoints[0], b: selectedPoints[1] }) },
    { label: "线段水平", disabled: selectedLines.length < 1, make: () => ({ id: "", type: "horizontal" as const, line: selectedLines[0] }) },
    { label: "线段竖直", disabled: selectedLines.length < 1, make: () => ({ id: "", type: "vertical" as const, line: selectedLines[0] }) },
    { label: "两线垂直", disabled: selectedLines.length < 2, make: () => ({ id: "", type: "perpendicular" as const, a: selectedLines[0], b: selectedLines[1] }) },
    { label: "固定点", disabled: selectedPoints.length < 1, make: () => ({ id: "", type: "fixed" as const, point: selectedPoints[0], x: doc.points[selectedPoints[0]].x, y: doc.points[selectedPoints[0]].y }) },
  ];

  return (
    <aside className="panel">
      <section>
        <h2>选中几何</h2>
        <p>点：{selectedPoints.map(pointLabel).join("，") || "无"}</p>
        <p>线：{selectedLines.map(lineLabel).join("，") || "无"}</p>
        <div className="button-grid">
          {addButtons.map((button) => <button key={button.label} disabled={button.disabled} onClick={() => onAdd(button.label, button.make)}>{button.label}</button>)}
          <button disabled={selectedPoints.length < 2} onClick={() => {
            const current = selectedPoints.length === 2 ? Math.hypot(doc.points[selectedPoints[1]].x - doc.points[selectedPoints[0]].x, doc.points[selectedPoints[1]].y - doc.points[selectedPoints[0]].y) : 10;
            const input = window.prompt("两点距离（mm，有限正数）", Math.max(1, current).toFixed(3));
            if (input !== null) onAdd("两点距离", () => ({ id: "", type: "distance", a: selectedPoints[0], b: selectedPoints[1], value: Number(input) }));
          }}>两点距离</button>
        </div>
      </section>
      <section>
        <h2>约束列表</h2>
        <div className="constraint-list">
          {doc.constraints.length === 0 && <p className="muted">尚无约束。</p>}
          {doc.constraints.map((constraint) => {
            const selected = constraint.id === selectedConstraintId;
            return <div key={constraint.id} className={`constraint ${selected ? "selected-constraint" : ""}`} onClick={() => onSelect(selected ? null : constraint.id)}>
              <span>{describeConstraint(constraint, doc)}</span>
              {constraint.type === "distance" ? <input type="number" step="0.1" min="0.000001" defaultValue={constraint.value} key={constraint.value} onClick={(event) => event.stopPropagation()} onChange={(event) => onUpdateDistance(constraint.id, Number(event.target.value))} /> : null}
              <button onClick={(event) => { event.stopPropagation(); onDelete(constraint.id); }}>删除</button>
            </div>;
          })}
        </div>
      </section>
    </aside>
  );
}

function describeConstraint(constraint: Constraint, doc: SketchDocument): string {
  const p = (id: PointId) => `点${id.slice(-3)}`;
  const l = (id: LineId) => `线${id.slice(-3)}`;
  switch (constraint.type) {
    case "coincident": return `${p(constraint.a)} = ${p(constraint.b)}`;
    case "horizontal": return `${l(constraint.line)} 水平`;
    case "vertical": return `${l(constraint.line)} 竖直`;
    case "perpendicular": return `${l(constraint.a)} ⊥ ${l(constraint.b)}`;
    case "distance": return `${p(constraint.a)}↔${p(constraint.b)}`;
    case "fixed": return `${p(constraint.point)} 固定 (${constraint.x.toFixed(2)}, ${constraint.y.toFixed(2)})`;
  }
}
