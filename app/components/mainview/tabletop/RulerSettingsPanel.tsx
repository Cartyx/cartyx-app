import { Ruler, X } from 'lucide-react';
import { ColorPicker } from '~/components/shared/ColorPicker';

interface RulerSettingsPanelProps {
  /** Current measurement line color (6-digit hex). */
  color: string;
  /** Persist a new measurement line color. */
  onChangeColor: (color: string) => void;
  /** Hide the panel (the ruler tool stays active). */
  onClose: () => void;
}

/**
 * Settings popup for the measurement (ruler) tool. Mirrors {@link LayersPanel}:
 * it's rendered while the ruler tool is active and stays out of the stage's
 * pointer flow. Lets the user pick the measurement line color, which persists
 * on their user record.
 */
export function RulerSettingsPanel({ color, onChangeColor, onClose }: RulerSettingsPanelProps) {
  return (
    <div
      // Stop pointer events from reaching the stage (which would drop an anchor).
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-3 top-3 z-40 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#0D1117]/95 shadow-2xl backdrop-blur-sm"
      data-testid="ruler-settings-panel"
      role="group"
      aria-label="Measurement settings"
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Ruler className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-slate-300">
            Measurement
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close measurement settings"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Color picker */}
      <div className="px-3 py-3">
        <div className="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-4 w-4 flex-shrink-0 rounded-full border border-white/20"
            style={{ backgroundColor: color }}
            data-testid="ruler-color-swatch"
          />
          <span className="font-mono text-[11px] text-slate-400" data-testid="ruler-color-value">
            {color}
          </span>
        </div>
        <ColorPicker label="Line Color" value={color} onChange={onChangeColor} />
      </div>

      {/* Footer help text */}
      <p className="border-t border-white/[0.07] px-3 py-2 font-sans text-[10px] leading-snug text-slate-500">
        Click the map to drop an anchor, or click two tokens to measure between them.
      </p>
    </div>
  );
}
