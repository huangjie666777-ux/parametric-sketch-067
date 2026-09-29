import { useState } from "react";
import { Canvas, type Tool } from "./Canvas";
import { ConstraintPanel } from "./ConstraintPanel";
import { useSketch } from "./useSketch";
import { makeRectangle, makeRod } from "../sketch/examples";
import { MAX_POINTS } from "../sketch/model";

export default function App() {
  const ctl = useSketch(makeRectangle());
  const [tool, setTool] = useState<Tool>("select");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const { doc, status, message, canUndo, canRedo } = ctl.state;

  const ok = status?.ok ?? true;

  return (
    <div className="app">
      <header>
        <strong>参数化草图</strong>
        <span className="spacer" />
        <button onClick={() => ctl.loadExample(makeRectangle())}>矩形示例</button>
        <button onClick={() => ctl.loadExample(makeRod())}>定长连杆示例</button>
        <button onClick={ctl.undo} disabled={!canUndo}>撤销</button>
        <button onClick={ctl.redo} disabled={!canRedo}>重做</button>
      </header>
      <div className="body">
        <div className="toolbar">
          <button className={tool === "select" ? "active" : ""} onClick={() => setTool("select")}>选择/拖拽</button>
          <button className={tool === "point" ? "active" : ""} onClick={() => setTool("point")}>加点</button>
          <button className={tool === "segment" ? "active" : ""} onClick={() => setTool("segment")}>连线</button>
          <button disabled={!ctl.selection.points.length && !ctl.selection.segments.length}
            onClick={ctl.removeSelected}>删除选中</button>
          <div className="meta">
            点 {doc.points.length}/{MAX_POINTS} · 线 {doc.segments.length} · 约束 {doc.constraints.length}
          </div>
        </div>
        <Canvas ctl={ctl} tool={tool} highlighted={highlighted} />
        <ConstraintPanel ctl={ctl} highlighted={highlighted} setHighlighted={setHighlighted} />
      </div>
      <footer className={ok ? "status-ok" : "status-bad"}>
        {ok ? "✓ 约束满足" : "⚠ 未收敛/不满足"}
        {" · 剩余局部自由度: "}{status?.localDof ?? "-"}
        {status && status.redundantConstraintIds.length > 0 &&
          ` · 冗余约束 ${status.redundantConstraintIds.length} 条（不计入独立约束）`}
        {message ? ` · ${message}` : ""}
      </footer>
    </div>
  );
}
