import { Eye, EyeOff, X, Layers } from 'lucide-react';
import { MAP_LAYERS, type MapLayerId, type TokenLayerId } from '~/types/mapLayer';

interface LayersPanelProps {
  activeLayer: MapLayerId;
  hiddenLayers: Set<MapLayerId>;
  tokenCounts: Record<TokenLayerId, number>;
  onSelectLayer: (id: MapLayerId) => void;
  onToggleLayer: (id: MapLayerId) => void;
  onClose: () => void;
}

/**
 * LayersPanel — GM-only popup (opened from the toolbar's Layer tool) for
 * choosing the active working layer and toggling each layer's visibility on
 * the GM's own screen. Layers are listed highest → lowest, matching how they
 * stack on the map.
 */
export function LayersPanel({
  activeLayer,
  hiddenLayers,
  tokenCounts,
  onSelectLayer,
  onToggleLayer,
  onClose,
}: LayersPanelProps) {
  return (
    <div
      // Stop pointer events from reaching the stage (which would pan/deselect).
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute left-3 top-3 z-40 w-60 overflow-hidden rounded-lg border border-white/10 bg-[#0D1117]/95 shadow-2xl backdrop-blur-sm"
      data-testid="layers-panel"
      role="group"
      aria-label="Map layers"
    >
      <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
          <h2 className="font-sans text-xs font-bold uppercase tracking-widest text-slate-300">
            Layers
          </h2>
        </div>
        <button
          type="button"
          aria-label="Close layers panel"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <ul className="py-1">
        {MAP_LAYERS.map((layer) => {
          const isActive = layer.id === activeLayer;
          const isHidden = hiddenLayers.has(layer.id);
          const count =
            layer.id === 'public' || layer.id === 'gm-private' ? tokenCounts[layer.id] : undefined;
          return (
            <li key={layer.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onSelectLayer(layer.id)}
                aria-pressed={isActive}
                title={layer.placeholder ? 'Drawing tools coming soon' : undefined}
                className={[
                  'flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 pr-1 text-left transition-colors',
                  isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]',
                ].join(' ')}
                data-testid={`layer-row-${layer.id}`}
              >
                {/* Active indicator */}
                <span
                  aria-hidden="true"
                  className={[
                    'h-1.5 w-1.5 flex-shrink-0 rounded-full',
                    isActive ? 'bg-[#60A5FA]' : 'bg-transparent',
                  ].join(' ')}
                />
                <span
                  className={[
                    'truncate font-sans text-xs',
                    isHidden ? 'text-slate-500' : isActive ? 'text-slate-100' : 'text-slate-300',
                  ].join(' ')}
                >
                  {layer.label}
                </span>
                {count !== undefined && (
                  <span className="ml-auto rounded bg-white/[0.06] px-1.5 font-mono text-[10px] text-slate-400">
                    {count}
                  </span>
                )}
                {layer.placeholder && (
                  <span
                    className={`${count !== undefined ? '' : 'ml-auto'} rounded bg-white/[0.04] px-1.5 font-sans text-[9px] uppercase tracking-wide text-slate-500`}
                  >
                    soon
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={isHidden ? `Show ${layer.label}` : `Hide ${layer.label}`}
                aria-pressed={!isHidden}
                onClick={() => onToggleLayer(layer.id)}
                className="mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-400 hover:bg-white/10 hover:text-slate-200"
                data-testid={`layer-visibility-${layer.id}`}
              >
                {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-white/[0.07] px-3 py-2 font-sans text-[10px] leading-snug text-slate-500">
        Select tokens, then right-click to move them between Public and GM-Private.
      </p>
    </div>
  );
}
