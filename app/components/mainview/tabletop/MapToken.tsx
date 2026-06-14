import {
  useState,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { MoreVertical, Eye, EyeOff, Trash2 } from 'lucide-react';
import type { MapTokenData } from '~/types/mapToken';

interface MapTokenProps {
  token: MapTokenData;
  imageOffsetX: number;
  imageOffsetY: number;
  effectiveScale: number;
  pixelsPerSquare: number;
  canMove: boolean;
  isGM: boolean;
  isSelected: boolean;
  /** `additive` is true when shift/ctrl/cmd is held (multi-select). */
  onSelect: (additive: boolean) => void;
  onBeginDrag: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onContextMenu: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onToggleLabel: () => void;
  onRemove: () => void;
}

/**
 * MapToken — a single positioned token on the active map.
 *
 * The token's center is stored in IMAGE-PIXEL coords. Its DOM-pixel diameter
 * is derived from the map's pixelsPerSquare × sizeSquares × the current
 * zoom (effectiveScale). The avatar is the source entity's picture if set,
 * otherwise a letter-fallback on the entity's color.
 */
export function MapToken({
  token,
  imageOffsetX,
  imageOffsetY,
  effectiveScale,
  pixelsPerSquare,
  canMove,
  isGM,
  isSelected,
  onSelect,
  onBeginDrag,
  onContextMenu,
  onToggleLabel,
  onRemove,
}: MapTokenProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  // Token size in image-pixels = sizeSquares × pixelsPerSquare. Then convert
  // to DOM-pixels via effectiveScale.
  const sizeImagePx = Math.max(1, token.sizeSquares) * Math.max(1, pixelsPerSquare);
  const sizeDom = sizeImagePx * effectiveScale;
  const halfDom = sizeDom / 2;

  const centerDomX = imageOffsetX + token.x * effectiveScale;
  const centerDomY = imageOffsetY + token.y * effectiveScale;

  const initial = (token.label || '?').trim().charAt(0).toUpperCase() || '?';

  // Players and characters show only their first name on the map to keep
  // labels compact; the full name stays in the avatar's aria-label/tooltip.
  // Monster tokens (Phase 3) keep their full multi-word name.
  const displayLabel =
    token.sourceCollection === 'player' || token.sourceCollection === 'character'
      ? token.label.trim().split(/\s+/)[0] || token.label
      : token.label;

  return (
    <div
      className="absolute"
      style={{
        left: centerDomX - halfDom,
        top: centerDomY - halfDom,
        width: sizeDom,
        // Reserve a little vertical room for the label below the avatar.
        height: sizeDom + 18,
      }}
      data-testid="map-token"
      data-token-id={token.id}
    >
      {/* Avatar */}
      <div
        role="button"
        tabIndex={0}
        onPointerDown={(e) => {
          // Always select on press; if movable, the same press also kicks
          // off a drag. A pure click (no movement) leaves only the selection.
          // Shift/ctrl/cmd extends the selection (multi-select).
          if (e.button === 0) {
            e.stopPropagation();
            onSelect(e.shiftKey || e.metaKey || e.ctrlKey);
          }
          if (canMove) onBeginDrag(e);
        }}
        onContextMenu={onContextMenu}
        className={[
          'relative flex items-center justify-center overflow-hidden rounded-full border-[3px] shadow-lg',
          canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
          token.hiddenFromPlayers ? 'opacity-70' : '',
          isSelected
            ? 'ring-4 ring-amber-300/90 ring-offset-2 ring-offset-black/40'
            : token.hiddenFromPlayers
              ? 'ring-2 ring-dashed ring-rose-400/60'
              : '',
        ].join(' ')}
        style={{
          width: sizeDom,
          height: sizeDom,
          borderColor: token.color,
        }}
        aria-label={token.label}
        aria-pressed={isSelected}
      >
        {token.imageUrl ? (
          <img
            src={token.imageUrl}
            alt={token.label}
            draggable={false}
            className="pointer-events-none h-full w-full object-cover"
            style={{ maxWidth: 'none', maxHeight: 'none' }}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-white"
            style={{
              backgroundColor: token.color,
              fontSize: Math.max(10, sizeDom * 0.45),
              fontWeight: 700,
              lineHeight: 1,
            }}
          >
            {initial}
          </div>
        )}

        {/* GM-only floating action button */}
        {isGM && sizeDom >= 28 && (
          <button
            type="button"
            aria-label="Token actions"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="absolute right-0 top-0 flex h-5 w-5 -translate-y-1/3 translate-x-1/3 items-center justify-center rounded-full bg-black/80 text-slate-200 opacity-0 transition-opacity hover:bg-black hover:text-white focus:opacity-100 group-hover:opacity-100"
            style={{ opacity: menuOpen ? 1 : undefined }}
          >
            <MoreVertical className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Label */}
      {token.labelVisible && token.label && (
        <div
          className="pointer-events-none absolute left-1/2 mt-0.5 -translate-x-1/2 whitespace-nowrap rounded bg-black/70 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-white shadow"
          style={{ top: sizeDom }}
          title={token.label}
        >
          {displayLabel}
        </div>
      )}

      {/* GM action menu */}
      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-10 cursor-default"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMenuOpen(false)}
          />
          <div
            role="menu"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute z-20 w-44 overflow-hidden rounded border border-white/10 bg-[#080A12] shadow-xl"
            style={{ left: sizeDom + 6, top: 0 }}
          >
            <MenuItem
              icon={
                token.labelVisible ? (
                  <EyeOff className="h-3.5 w-3.5" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )
              }
              label={token.labelVisible ? 'Hide name' : 'Show name'}
              onClick={() => {
                setMenuOpen(false);
                onToggleLabel();
              }}
            />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label="Remove token"
              danger
              onClick={() => {
                setMenuOpen(false);
                onRemove();
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={[
        'flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-xs transition-colors hover:bg-white/[0.05]',
        danger ? 'text-rose-300 hover:text-rose-200' : 'text-slate-200',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  );
}
