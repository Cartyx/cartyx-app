import { useEffect, useRef, useState } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Traps keyboard focus within the referenced container while it is mounted.
 * Returns a ref to attach to the container element.
 *
 * Also captures whatever element had focus just before mount, and restores
 * focus to it on unmount (guarded so it never focuses a detached node) — so
 * closing a dialog returns keyboard users to where they were.
 */
export function useFocusTrap<T extends HTMLElement = HTMLElement>() {
  const containerRef = useRef<T>(null);

  // Captured during render — via a lazy initializer that runs exactly once,
  // on the first render — so it reflects the true opener. Child `autoFocus`
  // is applied during the commit phase, which happens before any passive
  // `useEffect`; capturing here (not in the effect body) beats that race.
  const [opener] = useState<Element | null>(() =>
    typeof document !== 'undefined' ? document.activeElement : null
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus();
      }
    };
  }, [opener]);

  return containerRef;
}
