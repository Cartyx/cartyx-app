import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { MapTextData } from '~/types/mapText';

interface MapTextLayerProps {
  /** Whether text is shown (per-viewer toggle + Spell FX / Drawing layer). */
  visible: boolean;
  texts: MapTextData[];
  /** Text tool active → text is draggable/selectable/editable. */
  textActive: boolean;
  canModify: (t: MapTextData) => boolean;
  selectedTextId: string | null;
  effectiveScale: number;
  imageOffsetX: number;
  imageOffsetY: number;
  onBeginDrag: (t: MapTextData, e: ReactPointerEvent<HTMLButtonElement>) => void;
  onOpenEdit: (t: MapTextData) => void;
  /** The in-progress text editor (create or edit). */
  draft: { x: number; y: number; editingId?: string } | null;
  draftValue: string;
  onDraftChange: (value: string) => void;
  onCommit: (value: string) => void;
  onCancel: () => void;
  /** Owned by the parent so it can focus the input on the next frame. */
  inputRef: RefObject<HTMLInputElement | null>;
  draftColor: string;
  draftFontSize: number;
}

/**
 * Renders the shared map-text layer: the placed text labels (display-only
 * unless the text tool is active and the viewer may modify them) plus the
 * in-progress text editor input. The draft state, commit/cancel logic, and the
 * focus effect live in ActiveMapStage and are wired here via props + the
 * forwarded input ref.
 */
export function MapTextLayer({
  visible,
  texts,
  textActive,
  canModify,
  selectedTextId,
  effectiveScale,
  imageOffsetX,
  imageOffsetY,
  onBeginDrag,
  onOpenEdit,
  draft,
  draftValue,
  onDraftChange,
  onCommit,
  onCancel,
  inputRef,
  draftColor,
  draftFontSize,
}: MapTextLayerProps) {
  return (
    <>
      {visible &&
        texts.map((t) => {
          if (draft?.editingId === t.id) return null;
          const selected = selectedTextId === t.id;
          const interactive = textActive && canModify(t);
          return (
            <button
              key={t.id}
              type="button"
              data-testid="map-text"
              data-text-id={t.id}
              onPointerDown={(e) => {
                if (!interactive) return;
                onBeginDrag(t, e);
              }}
              onDoubleClick={(e) => {
                if (!interactive) return;
                e.stopPropagation();
                e.preventDefault();
                onOpenEdit(t);
              }}
              className={[
                'absolute z-30 m-0 max-w-[40vw] whitespace-pre-wrap break-words border-0 bg-transparent p-0 text-left font-sans font-semibold leading-tight',
                interactive
                  ? 'cursor-move outline-offset-2 hover:outline hover:outline-2 hover:outline-[#60A5FA]/70'
                  : 'pointer-events-none',
                selected ? 'rounded outline outline-2 outline-offset-2 outline-[#60A5FA]' : '',
              ].join(' ')}
              style={{
                left: imageOffsetX + t.x * effectiveScale,
                top: imageOffsetY + t.y * effectiveScale,
                color: t.color,
                fontSize: t.fontSize * effectiveScale,
                textShadow:
                  '0 1px 2px rgba(0,0,0,0.9), 0 -1px 2px rgba(0,0,0,0.9), 1px 0 2px rgba(0,0,0,0.9), -1px 0 2px rgba(0,0,0,0.9)',
              }}
            >
              {t.text}
            </button>
          );
        })}

      {/* In-progress text editor (text tool). */}
      {textActive && draft && (
        <input
          ref={inputRef}
          data-testid="map-text-input"
          value={draftValue}
          onChange={(e) => onDraftChange(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit(draftValue);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          onBlur={(e) => onCommit(e.currentTarget.value)}
          placeholder="Type…"
          className="absolute z-40 rounded border border-[#60A5FA] bg-black/70 px-1 font-sans font-semibold outline-none"
          style={{
            left: imageOffsetX + draft.x * effectiveScale,
            top: imageOffsetY + draft.y * effectiveScale,
            color: draftColor,
            fontSize: draftFontSize * effectiveScale,
            minWidth: 90,
          }}
        />
      )}
    </>
  );
}
