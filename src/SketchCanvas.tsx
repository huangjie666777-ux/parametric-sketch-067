import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type { Constraint, LineId, SketchDocument } from "./types";
import type { Selection } from "./useSketch";

export type ToolMode = "select" | "point" | "line";

interface View {
  scale: number;
  panX: number;
  panY: number;
}

interface Props {
  doc: SketchDocument;
  tool: ToolMode;
  selection: Selection;
  selectedConstraint: Constraint | null;
  onCreatePoint: (x: number, y: number) => void;
  onConnect: (a: string, b: string) => void;
  onSelectionChange: (selection: Selection) => void;
  onBeginDrag: (id: string) => boolean;
  onDrag: (id: string, x: number, y: number) => void;
  onEndDrag: () => void;
  onDeleteLine: (id: LineId) => void;
}

function constraintGeometry(constraint: Constraint | null): { points: string[]; lines: string[] } {
  if (!constraint) return { points: [], lines: [] };
  if (constraint.type === "coincident" || constraint.type === "distance") return { points: [constraint.a, constraint.b], lines: [] };
  if (constraint.type === "fixed") return { points: [constraint.point], lines: [] };
  if (constraint.type === "horizontal" || constraint.type === "vertical") return { points: [], lines: [constraint.line] };
  return { points: [], lines: [constraint.a, constraint.b] };
}

export function SketchCanvas({ doc, tool, selection, selectedConstraint, onCreatePoint, onConnect, onSelectionChange, onBeginDrag, onDrag, onEndDrag, onDeleteLine }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ scale: 3, panX: 0, panY: 0 });
  const [pendingLinePoint, setPendingLinePoint] = useState<string | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const draggingRef = useRef<{ id: string; moved: boolean } | null>(null);
  const highlighted = useMemo(() => constraintGeometry(selectedConstraint), [selectedConstraint]);

  const toWorld = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - rect.width / 2 - view.panX) / view.scale,
      y: (rect.height / 2 - (clientY - rect.top) + view.panY) / view.scale,
    };
  }, [view]);

  const transform = `translate(${view.panX} ${view.panY}) scale(${view.scale} ${-view.scale}) translate(${-0.5} ${-0.5})`;

  const handleWheel = (event: ReactWheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((previous) => ({ ...previous, scale: Math.min(20, Math.max(0.2, previous.scale * factor)) }));
  };

  const handleBackgroundPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.shiftKey) {
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setPanning({ x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY });
      return;
    }
    if (tool !== "select") return;
    setPendingLinePoint(null);
    onSelectionChange({ points: [], lines: [] });
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panning) {
      setView((previous) => ({ ...previous, panX: panning.panX + event.clientX - panning.x, panY: panning.panY - (event.clientY - panning.y) }));
      return;
    }
    const drag = draggingRef.current;
    if (!drag) return;
    drag.moved = true;
    const world = toWorld(event.clientX, event.clientY);
    onDrag(drag.id, world.x, world.y);
  };

  const handlePointerUp = () => {
    if (draggingRef.current) onEndDrag();
    draggingRef.current = null;
    setPanning(null);
  };

  const handleCanvasClick = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget || panning || draggingRef.current) return;
    if (tool === "point") {
      const world = toWorld(event.clientX, event.clientY);
      onCreatePoint(world.x, world.y);
    }
  };

  const selectPoint = (id: string, additive: boolean) => {
    if (tool === "point") return;
    if (tool === "line") {
      if (!pendingLinePoint) {
        setPendingLinePoint(id);
        onSelectionChange({ points: [id], lines: [] });
      } else if (pendingLinePoint !== id) {
        onConnect(pendingLinePoint, id);
        setPendingLinePoint(null);
      }
      return;
    }
    const points = additive ? unique([...selection.points, id]) : [id];
    onSelectionChange({ points, lines: additive ? selection.lines : [] });
  };

  const selectLine = (id: string, additive: boolean) => {
    if (tool !== "select") return;
    const lines = additive ? unique([...selection.lines, id]) : [id];
    onSelectionChange({ points: additive ? selection.points : [], lines });
  };

  const startDrag = (event: ReactPointerEvent<SVGGElement>, id: string) => {
    if (tool !== "select" || event.button !== 0) return;
    event.stopPropagation();
    if (!onBeginDrag(id)) return;
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    draggingRef.current = { id, moved: false };
  };

  return (
    <svg
      ref={svgRef}
      className="canvas"
      onWheel={handleWheel}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClickCapture={handleCanvasClick}
    >
      <rect x="0" y="0" width="100%" height="100%" fill="#fbfdff" />
      <g transform={transform}>
              <g>
                {Array.from({ length: 41 }, (_, index) => index - 20).map((value) => (
                  <g key={value} stroke={value === 0 ? "#94a3b8" : "#e5e7eb"} strokeWidth={value === 0 ? 0.15 : 0.05}>
                    <line x1={value * 10} y1={-200} x2={value * 10} y2={200} />
                    <line x1={-200} y1={value * 10} x2={200} y2={value * 10} />
                  </g>
                ))}
              </g>
        {Object.values(doc.lines).map((line) => {
          const a = doc.points[line.a];
          const b = doc.points[line.b];
          const active = selection.lines.includes(line.id) || highlighted.lines.includes(line.id);
          return (
            <g key={line.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active ? "#2563eb" : "#0f172a"} strokeWidth={active ? 1.2 : 0.7} strokeLinecap="round" onClick={(event) => { event.stopPropagation(); selectLine(line.id, event.shiftKey); }} />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={5} onClick={(event) => { event.stopPropagation(); selectLine(line.id, event.shiftKey); }} />
            </g>
          );
        })}
        {Object.values(doc.points).map((point) => {
          const active = selection.points.includes(point.id) || highlighted.points.includes(point.id) || pendingLinePoint === point.id;
          return (
            <g key={point.id} transform={`translate(${point.x} ${point.y})`} className="point-hit" onPointerDown={(event) => startDrag(event, point.id)} onClick={(event) => { event.stopPropagation(); selectPoint(point.id, event.shiftKey); }}>
              <circle r={2.4} className={`point ${active ? "point-active" : ""}`} />
              <text x={4} y={-4} transform="scale(1 -1)" className="point-label">{point.id.slice(-3)}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
