import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { Pencil, Square, Circle, Eraser, GripVertical } from 'lucide-react';
import { ColorPicker } from '~/components/shared/ColorPicker';
import { MIN_STROKE_WIDTH, MAX_STROKE_WIDTH } from '~/types/schemas/mapDrawings';

/** UI shapes offered by the drawing tool. square→rect, circle→ellipse on commit. */
export type DrawShape = 'pencil' | 'square' | 'circle' | 'eraser';

/** Stroke/line-size presets (map-local px) offered by the drawing tool. */
export const STROKE_SIZE_PRESETS = [2, 4, 8, 16, 32] as const;

const SHAPES: { id: DrawShape; icon: typeof Pencil; label: string }[] = [
  { id: 'pencil', icon: Pencil, label: 'Pencil' },
  { id: 'square', icon: Square, label: 'Square' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'eraser', icon: Eraser, label: 'Eraser' },
];

interface DrawingSettingsPanelProps {
  shape: DrawShape;
  onChangeShape: (shape: DrawShape) => void;
  /** Current color (6-digit hex). */
  color: string;
  onChangeColor: (color: string) => void;
  /** Current stroke/line width (map-local px). */
  strokeWidth: number;
  onChangeStrokeWidth: (size: number) => void;
  /** Fill vs. outline (square/circle). */
  filled: boolean;
  onToggleFilled: () => void;
  /** Panel position within the workspace (px). */
  position: { x: number; y: number };
  /** Begin dragging the panel by its header. */
  onHeaderPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Ref to the root element, used by the parent to measure + clamp it. */
  rootRef: RefObject<HTMLDivElement | null>;
}

/**
 * Settings popup for the drawing tool — pick a shape, color, line size, and
 * fill/outline, then draw on the map. Always shown while the drawing tool is
 * active (no close affordance). Draggable by its header and clamped to the
 * workspace so it can never be lost behind the toolbar / off-screen.
 */
export function DrawingSettingsPanel({
  shape,
  onChangeShape,
  color,
  onChangeColor,
  strokeWidth,
  onChangeStrokeWidth,
  filled,
  onToggleFilled,
  position,
  onHeaderPointerDown,
  rootRef,
}: DrawingSettingsPanelProps) {
  const shapeSupportsFill = shape === 'square' || shape === 'circle';
  const isEraser = shape === 'eraser';

  return (
    <div
      ref={rootRef}
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute z-40 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#0D1117]/95 shadow-2xl backdrop-blur-sm"
      style={{ left: position.x, top: position.y }}
      data-testid="drawing-settings-panel"
      role="group"
      aria-label="Drawing settings"
    >
      {/* Header — drag handle */}
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex cursor-move items-center gap-1.5 border-b border-white/[0.07] px-3 py-2"
        data-testid="drawing-settings-panel-header"
      >
        <GripVertical className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
        <Pencil className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-slate-300">
          Draw
        </h2>
      </div>

      <div className="px-3 py-3">
        {/* Shape picker */}
        <span
          id="draw-shape-label"
          className="mb-2 block font-sans text-[10px] font-semibold tracking-wide text-slate-500"
        >
          Shape
        </span>
        <div className="mb-3 flex gap-1.5" role="group" aria-labelledby="draw-shape-label">
          {SHAPES.map(({ id, icon: Icon, label }) => {
            const active = id === shape;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onChangeShape(id)}
                aria-pressed={active}
                aria-label={label}
                title={label}
                data-testid={`draw-shape-${id}`}
                className={[
                  'flex h-9 flex-1 items-center justify-center rounded transition-colors',
                  active
                    ? 'bg-white/15 text-[#60A5FA]'
                    : 'bg-white/[0.04] text-slate-300 hover:bg-white/10',
                ].join(' ')}
              >
                <Icon className="h-4 w-4" />
              </button>
            );
          })}
        </div>

        {/* Stroke / line size */}
        <span
          id="draw-size-label"
          className="mb-2 block font-sans text-[10px] font-semibold tracking-wide text-slate-500"
        >
          {isEraser ? 'Eraser Size' : 'Line Size'}
        </span>
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-labelledby="draw-size-label">
          {STROKE_SIZE_PRESETS.map((size) => {
            const active = size === strokeWidth;
            return (
              <button
                key={size}
                type="button"
                onClick={() => onChangeStrokeWidth(size)}
                aria-pressed={active}
                data-testid={`draw-size-${size}`}
                className={[
                  'rounded px-2 py-1 font-mono text-xs transition-colors',
                  active
                    ? 'bg-white/15 text-[#60A5FA]'
                    : 'bg-white/[0.04] text-slate-300 hover:bg-white/10',
                ].join(' ')}
              >
                {size}
              </button>
            );
          })}
        </div>
        <div className="mb-3 flex items-center gap-2">
          <input
            type="number"
            min={MIN_STROKE_WIDTH}
            max={MAX_STROKE_WIDTH}
            value={strokeWidth}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (!Number.isFinite(n)) return;
              const clamped = Math.max(MIN_STROKE_WIDTH, Math.min(MAX_STROKE_WIDTH, n));
              onChangeStrokeWidth(clamped);
            }}
            aria-label="Line size in pixels"
            data-testid="draw-size-input"
            className="w-20 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 font-mono text-xs text-slate-300 focus:border-blue-500/40 focus:outline-none"
          />
          <span className="font-sans text-[10px] text-slate-500">px</span>
        </div>

        {/* Fill / outline (square + circle only) */}
        {shapeSupportsFill && (
          <button
            type="button"
            onClick={onToggleFilled}
            aria-pressed={filled}
            data-testid="draw-fill-toggle"
            className={[
              'mb-3 flex w-full items-center justify-between rounded px-2.5 py-1.5 font-sans text-xs transition-colors',
              filled
                ? 'bg-white/15 text-[#60A5FA]'
                : 'bg-white/[0.04] text-slate-300 hover:bg-white/10',
            ].join(' ')}
          >
            <span>{filled ? 'Filled' : 'Outline'}</span>
            <span
              className={[
                'h-4 w-4 rounded-sm border-2',
                filled ? 'border-[#60A5FA] bg-[#60A5FA]/60' : 'border-slate-400 bg-transparent',
              ].join(' ')}
              aria-hidden="true"
            />
          </button>
        )}

        {/* Color */}
        {!isEraser && <ColorPicker label="Color" value={color} onChange={onChangeColor} />}
      </div>

      <p className="border-t border-white/[0.07] px-3 py-2 font-sans text-[10px] leading-snug text-slate-500">
        Drag this header to move it. Draw on the map. Use the Pointer tool to select a shape, then
        resize from its corner or press Delete.
      </p>
    </div>
  );
}
