import { Type } from 'lucide-react';
import { ColorPicker } from '~/components/shared/ColorPicker';

/** Font-size presets (map-local px) offered by the text tool. */
export const TEXT_SIZE_PRESETS = [12, 16, 24, 36, 48] as const;

interface TextSettingsPanelProps {
  /** Current text color (6-digit hex). */
  color: string;
  onChangeColor: (color: string) => void;
  /** Current font size (map-local px). */
  fontSize: number;
  onChangeFontSize: (size: number) => void;
}

/**
 * Settings popup for the text tool — pick a font size and color, then click
 * the map to write. Always shown while the text tool is active (no close
 * affordance) so the controls are available whenever text can be edited.
 */
export function TextSettingsPanel({
  color,
  onChangeColor,
  fontSize,
  onChangeFontSize,
}: TextSettingsPanelProps) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-3 top-3 z-40 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#0D1117]/95 shadow-2xl backdrop-blur-sm"
      data-testid="text-settings-panel"
      role="group"
      aria-label="Text settings"
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-3 py-2">
        <Type className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
        <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-slate-300">
          Text
        </h2>
      </div>

      <div className="px-3 py-3">
        {/* Font size */}
        <span
          id="text-size-label"
          className="mb-2 block font-sans text-[10px] font-semibold tracking-wide text-slate-500"
        >
          Font Size
        </span>
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-labelledby="text-size-label">
          {TEXT_SIZE_PRESETS.map((size) => {
            const active = size === fontSize;
            return (
              <button
                key={size}
                type="button"
                onClick={() => onChangeFontSize(size)}
                aria-pressed={active}
                data-testid={`text-size-${size}`}
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

        {/* Color */}
        <ColorPicker label="Color" value={color} onChange={onChangeColor} />
      </div>

      <p className="border-t border-white/[0.07] px-3 py-2 font-sans text-[10px] leading-snug text-slate-500">
        Click the map to write. Click text to select it, then press Delete to remove it.
      </p>
    </div>
  );
}
