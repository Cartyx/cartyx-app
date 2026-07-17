import { ColorPicker } from '~/components/shared/ColorPicker';

interface RulerSettingsPanelProps {
  /** Current measurement line color (6-digit hex). */
  color: string;
  /** Persist a new measurement line color. */
  onChangeColor: (color: string) => void;
}

/**
 * Settings content for the measurement (ruler) tool — hosted inside a shared
 * {@link ToolWindow}. Lets the user pick the measurement line color, which
 * persists on their user record.
 */
export function RulerSettingsPanel({ color, onChangeColor }: RulerSettingsPanelProps) {
  return (
    <div
      className="w-60"
      data-testid="ruler-settings-panel"
      role="group"
      aria-label="Measurement settings"
    >
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
