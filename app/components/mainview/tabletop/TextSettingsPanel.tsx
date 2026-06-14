import { Type, X } from 'lucide-react';
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
  /** Hide the panel (the text tool stays active). */
  onClose: () => void;
}

/**
 * Settings popup for the text tool — pick a font size and color, then click
 * the map to write. Mirrors {@link RulerSettingsPanel}: rendered while the tool
 * is active, out of the stage's pointer flow, with a close affordance.
 */
export function TextSettingsPanel({
  color,
  onChangeColor,
  fontSize,
  onChangeFontSize,
  onClose,
}: TextSettingsPanelProps) {
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-3 top-3 z-40 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#0D1117]/95 shadow-2xl backdrop-blur-sm"
      data-testid="text-settings-panel"
      role="group"
      aria-label="Text settings"
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Type className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-slate-300">
            Text
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close text settings"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
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
