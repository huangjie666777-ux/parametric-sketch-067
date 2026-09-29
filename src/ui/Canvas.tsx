import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SketchController } from "./useSketch";

export type Tool = "select" | "point" | "segment";

interface View {
  scale: number; // pixels per mm
  ox: number; // screen px of world origin
  oy: number;
}

const POINT_R = 5;

export function Canvas({ ctl, tool, highlighted }: {
  ctl: SketchController;
  tool: Tool;
  highlighted: string | null;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ scale: 4, ox: 300, oy: 300 });
  const [pendingPoint, setPendingPoint] = useState<string | null>(null);
  useEffect(() => {
    setPendingPoint(null);
  }, [tool]);
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const dragRef = useRef<{ id: string } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const { doc } = ctl.state;
  const sel = ctl.selection;

  const toScreen = useCallback((x: number, y: number) => ({
    x: view.ox + x * view.scale,
    y: view.oy - y * view.scale,
  }), [view]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return { x: (sx - view.ox) / view.scale, y: (view.oy - sy) / view.scale };
  }, [view]);

  const pm = useMemo(() => new Map(doc.points.map((p) => [p.id, p])), [doc.points]);

  const isFixed = useCallback((id: string) =>
    doc.constraints.some((c) => c.type === "fixed" && c.points?.[0] === id), [doc.constraints]);

  const selectPoint = useCallback((id: string, additive: boolean) => {
    setSelection((s) => {
      const points = additive
        ? s.points.includes(id) ? s.points.filter((x) => x !== id) : [...s.points, id]
        : [id];
      return { points, segments: additive ? s.segments : [] };
    });
  }, []);

  const { setSelection } = ctl;

  const selectSegment = useCallback((id: string, additive: boolean) => {
    setSelection((s) => ({
      points: additive ? s.points : [],
      segments: additive
        ? s.segments.includes(id) ? s.segments.filter((x) => x !== id) : [...s.segments, id]
        : [id],
    }));
  }, [setSelection]);

  const onPointerDown = (e: React.PointerEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panRef.current = { x: e.clientX, y: e.clientY, ox: view.ox, oy: view.oy };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    const hitId = hitTest(w);
    if (tool === "point") {
      ctl.addPoint(w.x, w.y);
      return;
    }
    if (tool === "segment") {
      if (hitId) {
        if (!pendingPoint) {
          setPendingPoint(hitId);
        } else if (hitId !== pendingPoint) {
          ctl.addSegment(pendingPoint, hitId);
          setPendingPoint(null);
        }
      }
      return;
    }
    // select tool
    if (hitId) {
      if (sel.points.includes(hitId)) {
        if (!e.shiftKey && !isFixed(hitId)) dragRef.current = { id: hitId };
      } else {
        selectPoint(hitId, e.shiftKey);
        if (!e.shiftKey && !isFixed(hitId)) dragRef.current = { id: hitId };
      }
    } else {
      const segId = hitSegment(w);
      if (segId) selectSegment(segId, e.shiftKey);
      else if (!e.shiftKey) setSelection({ points: [], segments: [] });
    }
  };

  const hitTest = (w: { x: number; y: number }): string | null => {
    const tol = (POINT_R + 3) / view.scale;
    let best: string | null = null;
    let bestD = tol;
    for (const p of doc.points) {
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d < bestD) { bestD = d; best = p.id; }
    }
    return best;
  };

  const hitSegment = (w: { x: number; y: number }): string | null => {
    const tol = 6 / view.scale;
    for (const s of doc.segments) {
      const a = pm.get(s.a);
      const b = pm.get(s.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-12) continue;
      let t = ((w.x - a.x) * dx + (w.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      if (Math.hypot(px - w.x, py - w.y) < tol) return s.id;
    }
    return null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const p = panRef.current;
      setView((v) => ({ ...v, ox: p.ox + (e.clientX - p.x), oy: p.oy + (e.clientY - p.y) }));
      return;
    }
    if (dragRef.current) {
      const w = toWorld(e.clientX, e.clientY);
      ctl.dragMove(dragRef.current.id, w.x, w.y);
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    setHover(hitTest(w));
  };

  const endInteraction = () => {
    if (dragRef.current) {
      ctl.dragEnd();
      dragRef.current = null;
    }
    panRef.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setView((v) => {
      const scale = Math.min(200, Math.max(0.1, v.scale * factor));
      const k = scale / v.scale;
      // keep the world point under the cursor fixed
      return { scale, ox: sx - (sx - v.ox) * k, oy: sy - (sy - v.oy) * k };
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        setPendingPoint(null);
        setSelection({ points: [], segments: [] });
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && (sel.points.length || sel.segments.length)) {
        ctl.removeSelected();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) ctl.redo(); else ctl.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        ctl.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ctl, sel]);

  const { hp: hiPoints, hs: hiSegs } = useMemo(() => {
    const hp = new Set<string>();
    const hs = new Set<string>();
    if (highlighted) {
      const c = doc.constraints.find((q) => q.id === highlighted);
      c?.points?.forEach((id) => hp.add(id));
      c?.segments?.forEach((id) => hs.add(id));
    }
    return { hp, hs };
  }, [doc.constraints, highlighted]);

  return (
    <svg
      ref={svgRef}
      className="canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerLeave={endInteraction}
      onWheel={onWheel}
      style={{ cursor: tool === "point" ? "crosshair" : hover || dragRef.current ? "move" : "default", touchAction: "none" }}
    >
      <Grid view={view} />
      {doc.segments.map((s) => {
        const a = pm.get(s.a);
        const b = pm.get(s.b);
        if (!a || !b) return null;
        const pa = toScreen(a.x, a.y);
        const pb = toScreen(b.x, b.y);
        const on = sel.segments.includes(s.id);
        const hot = hiSegs.has(s.id);
        return (
          <line key={s.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            className={`seg${on ? " seg-sel" : ""}${hot ? " seg-hot" : ""}`} data-id={s.id} />
        );
      })}
      {doc.points.map((p) => {
        const q = toScreen(p.x, p.y);
        const on = sel.points.includes(p.id);
        const fixed = isFixed(p.id);
        const hot = hiPoints.has(p.id);
        return (
          <g key={p.id}>
            <circle cx={q.x} cy={q.y} r={POINT_R + 2}
              className={`point-hit${on ? " hit-sel" : ""}${hot ? " hit-hot" : ""}`} />
            <circle cx={q.x} cy={q.y} r={POINT_R}
              className={fixed ? "point point-fixed" : on ? "point point-sel" : "point"} />
            <text x={q.x + 8} y={q.y - 8} className="point-label">{p.id}</text>
            {fixed && <text x={q.x} y={q.y + 3} textAnchor="middle" className="fix-mark">×</text>}
          </g>
        );
      })}
      {pendingPoint && (() => {
        const p = pm.get(pendingPoint);
        if (!p) return null;
        const q = toScreen(p.x, p.y);
        return <circle cx={q.x} cy={q.y} r={POINT_R + 5} className="pending" />;
      })()}
    </svg>
  );
}

function Grid({ view }: { view: View }) {
  const size = 1000;
  const step = view.scale >= 4 ? 10 : view.scale >= 1 ? 50 : 200;
  const lines = [];
  for (let x = -size; x <= size; x += step) {
    const a = view.ox + x * view.scale;
    lines.push(<line key={`v${x}`} x1={a} y1={0} x2={a} y2={2000} className="grid-line" />);
  }
  for (let y = -size; y <= size; y += step) {
    const b = view.oy - y * view.scale;
    lines.push(<line key={`h${y}`} x1={0} y1={b} x2={2000} y2={b} className="grid-line" />);
  }
  const o = { x: view.ox, y: view.oy };
  return (
    <g>
      {lines}
      <line x1={0} y1={o.y} x2={2000} y2={o.y} className="axis" />
      <line x1={o.x} y1={0} x2={o.x} y2={2000} className="axis" />
    </g>
  );
}
