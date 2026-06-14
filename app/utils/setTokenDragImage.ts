import type { DragEvent as ReactDragEvent } from 'react';

/**
 * Set a small token-style preview as the HTML5 drag image so dragging a
 * player/character card out of the wiki shows a compact circular token
 * instead of the entire card. Mirrors the look of a MapToken (avatar in
 * a colored ring; letter fallback when no picture is set).
 *
 * Caller passes the dragstart event. The preview is appended to the body
 * for a single tick — long enough for the browser to snapshot it — then
 * cleaned up automatically.
 */
export function setTokenDragImage(
  e: ReactDragEvent<HTMLElement>,
  opts: {
    /** Optional avatar/picture URL. */
    pictureUrl?: string | null;
    /** Letter fallback rendered when there is no picture. */
    initial: string;
    /** Border + fallback background color (CSS hex). */
    color: string;
  }
): void {
  const SIZE = 48;
  const preview = document.createElement('div');
  preview.style.position = 'fixed';
  preview.style.top = '-10000px';
  preview.style.left = '-10000px';
  preview.style.width = `${SIZE}px`;
  preview.style.height = `${SIZE}px`;
  preview.style.borderRadius = '50%';
  preview.style.border = `3px solid ${opts.color}`;
  preview.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
  preview.style.overflow = 'hidden';
  preview.style.display = 'flex';
  preview.style.alignItems = 'center';
  preview.style.justifyContent = 'center';
  preview.style.backgroundColor = opts.pictureUrl ? '#0D1117' : opts.color;
  preview.style.pointerEvents = 'none';

  if (opts.pictureUrl) {
    const img = document.createElement('img');
    img.src = opts.pictureUrl;
    img.alt = '';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    img.draggable = false;
    preview.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.textContent = opts.initial.toUpperCase().charAt(0) || '?';
    span.style.color = '#fff';
    span.style.fontSize = '20px';
    span.style.fontWeight = '700';
    span.style.fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    preview.appendChild(span);
  }

  document.body.appendChild(preview);
  // Offset so the cursor sits at the center of the preview.
  e.dataTransfer.setDragImage(preview, SIZE / 2, SIZE / 2);

  // Clean up on the next tick — the browser has already taken the snapshot.
  setTimeout(() => {
    if (preview.parentNode) preview.parentNode.removeChild(preview);
  }, 0);
}
