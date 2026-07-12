import { ColorPicker } from '~/components/shared/ColorPicker';
import { MIN_MAP_TEXT_FONT_SIZE, MAX_MAP_TEXT_FONT_SIZE } from '~/types/schemas/mapTexts';

/** Font-size presets (map-local px) offered by the text tool. */
export const TEXT_SIZE_PRESETS = [12, 16, 24, 36, 48, 72, 96, 128] as const;

interface TextSettingsPanelProps {
  /** Current text color (6-digit hex). */
  color: string;
  onChangeColor: (color: string) => void;
  /** Current font size (map-local px). */
  fontSize: number;
  onChangeFontSize: (size: number) => void;
}

/**
 * Settings content for the text tool — pick a font size and color, then click
 * the map to write. Hosted inside a shared {@link ToolWindow}.
 */
export function TextSettingsPanel({
  color,
  onChangeColor,
  fontSize,
  onChangeFontSize,
}: TextSettingsPanelProps) {
  return (
    <div className="w-60" data-testid="text-settings-panel" role="group" aria-label="Text settings">
      <div className="px-3 py-3">
        {/* Font size */}
        <span
          id="text-size-label"
          className="mb-2 block font-sans text-[10px] font-semibold tracking-wide text-slate-500"
        >
          Font Size
        </span>
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-labelledby="text-size-label">
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
        {/* Exact size — supports values larger than the presets for big maps. */}
        <div className="mb-3 flex items-center gap-2">
          <input
            type="number"
            min={MIN_MAP_TEXT_FONT_SIZE}
            max={MAX_MAP_TEXT_FONT_SIZE}
            value={fontSize}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              if (!Number.isFinite(n)) return;
              const clamped = Math.max(MIN_MAP_TEXT_FONT_SIZE, Math.min(MAX_MAP_TEXT_FONT_SIZE, n));
              onChangeFontSize(clamped);
            }}
            aria-label="Font size in pixels"
            data-testid="text-size-input"
            className="w-20 rounded-lg border border-white/[0.1] bg-white/[0.04] px-2 py-1.5 font-mono text-xs text-slate-300 focus:border-blue-500/40 focus:outline-none"
          />
          <span className="font-sans text-[10px] text-slate-500">px</span>
        </div>

        {/* Color */}
        <ColorPicker label="Color" value={color} onChange={onChangeColor} />
      </div>

      <p className="border-t border-white/[0.07] px-3 py-2 font-sans text-[10px] leading-snug text-slate-500">
        Click the map to write; click text to select, then change its size/color or press Delete.
      </p>
    </div>
  );
}
