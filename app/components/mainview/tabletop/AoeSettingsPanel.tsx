import { Circle, Cone, Box, Minus, Cylinder } from 'lucide-react';
import { ColorPicker } from '~/components/shared/ColorPicker';
import type { AoeShape } from '~/types/mapAoe';

/** Minimum size/width, in feet — a zero-size template is meaningless. */
export const MIN_AOE_FT = 5;

const SHAPES: { id: AoeShape; icon: typeof Circle; label: string }[] = [
  { id: 'sphere', icon: Circle, label: 'Sphere' },
  { id: 'cone', icon: Cone, label: 'Cone' },
  { id: 'cube', icon: Box, label: 'Cube' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'cylinder', icon: Cylinder, label: 'Cylinder' },
];

interface AoeSettingsPanelProps {
  shape: AoeShape;
  onShape: (s: AoeShape) => void;
  sizeFt: number;
  onSizeFt: (n: number) => void;
  widthFt: number;
  onWidthFt: (n: number) => void;
  color: string;
  onColor: (c: string) => void;
  /** Optional label drawn on the template (e.g. the spell name). */
  label: string;
  onLabel: (s: string) => void;
  onClearAll: () => void;
  /** GM only — the button is hidden entirely when false. */
  canClearAll: boolean;
}

/**
 * Settings content for the Spell AoE tool — pick a shape, size (and width for
 * lines), and color, then click the map to place the template. Hosted inside
 * a shared {@link ToolWindow}. The tool is armed simply by being the active
 * map tool (no separate "place on map" toggle — same pattern as
 * drawing/text/ruler).
 */
export function AoeSettingsPanel({
  shape,
  onShape,
  sizeFt,
  onSizeFt,
  widthFt,
  onWidthFt,
  color,
  onColor,
  label,
  onLabel,
  onClearAll,
  canClearAll,
}: AoeSettingsPanelProps) {
  return (
    <div
      className="w-60"
      data-testid="aoe-settings-panel"
      role="group"
      aria-label="Spell AoE settings"
    >
      <div className="px-3 py-3">
        {/* Shape picker */}
        <span
          id="aoe-shape-label"
          className="mb-2 block font-sans text-[10px] font-semibold tracking-wide text-slate-500"
        >
          Shape
        </span>
        <div className="mb-3 flex gap-1.5" role="group" aria-labelledby="aoe-shape-label">
          {SHAPES.map(({ id, icon: Icon, label }) => {
            const active = id === shape;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onShape(id)}
                aria-pressed={active}
                aria-label={label}
                title={label}
                data-testid={`aoe-shape-${id}`}
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

        {/* Size */}
        <span
          id="aoe-size-label"
          className="mb-2 block font-sans text-[10px] font-semibold tracking-wide text-slate-500"
        >
          Size (ft)
        </span>
        <div className="mb-3 flex items-center gap-2">
          <input
            type="number"
            min={MIN_AOE_FT}
            step={5}
            value={sizeFt}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (!Number.isFinite(n)) return;
              onSizeFt(Math.max(MIN_AOE_FT, n));
            }}
            aria-labelledby="aoe-size-label"
            data-testid="aoe-size-input"
            className="w-20 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 font-mono text-xs text-slate-300 focus:border-blue-500/40 focus:outline-none"
          />
          <span className="font-sans text-[10px] text-slate-500">ft</span>
        </div>

        {/* Width (line only) */}
        {shape === 'line' && (
          <>
            <span
              id="aoe-width-label"
              className="mb-2 block font-sans text-[10px] font-semibold tracking-wide text-slate-500"
            >
              Width (ft)
            </span>
            <div className="mb-3 flex items-center gap-2">
              <input
                type="number"
                min={MIN_AOE_FT}
                step={5}
                value={widthFt}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (!Number.isFinite(n)) return;
                  onWidthFt(Math.max(MIN_AOE_FT, n));
                }}
                aria-labelledby="aoe-width-label"
                data-testid="aoe-width-input"
                className="w-20 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 font-mono text-xs text-slate-300 focus:border-blue-500/40 focus:outline-none"
              />
              <span className="font-sans text-[10px] text-slate-500">ft</span>
            </div>
          </>
        )}

        {/* Color */}
        <ColorPicker label="Color" value={color} onChange={onColor} />

        {/* Optional label (e.g. spell name) — drawn on the template. */}
        <span
          id="aoe-label-label"
          className="mb-2 mt-3 block font-sans text-[10px] font-semibold tracking-wide text-slate-500"
        >
          Label (optional)
        </span>
        <input
          type="text"
          value={label}
          maxLength={60}
          placeholder="e.g. Fireball"
          onChange={(e) => onLabel(e.target.value)}
          aria-labelledby="aoe-label-label"
          data-testid="aoe-label-input"
          className="w-full rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 font-sans text-xs text-slate-300 placeholder:text-slate-600 focus:border-blue-500/40 focus:outline-none"
        />

        {/* Clear all (GM only) */}
        {canClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            data-testid="aoe-clear-all"
            className="mt-3 w-full rounded px-2.5 py-1.5 font-sans text-xs text-red-300 transition-colors bg-white/[0.04] hover:bg-red-500/10 hover:text-red-200"
          >
            Clear all AoE
          </button>
        )}
      </div>

      <p className="border-t border-white/[0.07] px-3 py-2 font-sans text-[10px] leading-snug text-slate-500">
        Click the map to place a template. Cone and Line aim on a second click; other shapes place
        immediately.
      </p>
    </div>
  );
}
