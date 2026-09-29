import { useEffect, useMemo, useState } from "react";
import { createRectangleExample, createRodExample } from "./examples";
import { coincidentConstraint, distanceConstraint, fixedPointConstraint, lineOrientationConstraint, perpendicularConstraint } from "./constraints";
import { SketchCanvas, type ToolMode } from "./SketchCanvas";
import { ConstraintPanel } from "./ConstraintPanel";
import { useSketch } from "./useSketch";
import type { Constraint } from "./types";

export function App() {
  const sketch = useSketch(createRectangleExample());
  const [tool, setTool] = useState<ToolMode>("select");
  const { state } = sketch;
  const selectedConstraint = useMemo(() => state.doc.constraints.find((item) => item.id === state.selectedConstraintId) ?? null, [state.doc.constraints, state.selectedConstraintId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "Delete" || event.key === "Backspace") && tool === "select" && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        sketch.removeSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sketch, tool]);

  const addConstraint = (template: Constraint) => {
    sketch.addConstraint(() => buildConstraint(template), state.selection);
  };

  const buildConstraint = (template: Constraint): Constraint => {
    if (template.type === "coincident") return coincidentConstraint(template.a, template.b);
    if (template.type === "horizontal" || template.type === "vertical") return lineOrientationConstraint(template.type, template.line);
    if (template.type === "perpendicular") return perpendicularConstraint(template.a, template.b);
    if (template.type === "distance") return distanceConstraint(template.a, template.b, template.value);
    return fixedPointConstraint(template.point, template.x, template.y);
  };

  return (
    <div className="app-shell">
      <header>
        <div>
          <h1>二维参数化草图</h1>
          <p>单位 mm · X 向右 · Y 向上 · 缩放不改变尺寸</p>
        </div>
        <div className="toolbar">
          <button className={tool === "select" ? "active" : ""} onClick={() => setTool("select")}>选择/拖动</button>
          <button className={tool === "point" ? "active" : ""} onClick={() => setTool("point")}>创建点</button>
          <button className={tool === "line" ? "active" : ""} onClick={() => setTool("line")}>连线</button>
          <button onClick={sketch.removeSelection} disabled={state.selection.points.length + state.selection.lines.length === 0}>删除选中</button>
          <button onClick={sketch.undo} disabled={!state.canUndo}>撤销</button>
          <button onClick={sketch.redo} disabled={!state.canRedo}>重做</button>
        </div>
      </header>
      <main>
        <div className="canvas-wrap">
          <SketchCanvas
            doc={state.doc}
            tool={tool}
            selection={state.selection}
            selectedConstraint={selectedConstraint}
            onCreatePoint={sketch.createPoint}
            onConnect={sketch.connectPoints}
            onSelectionChange={sketch.setSelection}
            onBeginDrag={sketch.beginDrag}
            onDrag={sketch.dragTo}
            onEndDrag={sketch.endDrag}
            onDeleteLine={sketch.removePointOnly}
          />
          <div className="examples">
            <button onClick={() => sketch.loadExample(createRectangleExample())}>可改宽高矩形</button>
            <button onClick={() => sketch.loadExample(createRodExample())}>定长连杆</button>
          </div>
          <div className={`status ${state.status && !state.status.ok ? "status-error" : ""}`}>{state.message}</div>
        </div>
        <ConstraintPanel
          doc={state.doc}
          selection={state.selection}
          selectedConstraintId={state.selectedConstraintId}
          onAdd={(_label, make) => addConstraint(make())}
          onUpdateDistance={sketch.updateDistance}
          onDelete={sketch.removeConstraint}
          onSelect={sketch.selectConstraint}
        />
      </main>
    </div>
  );
}
