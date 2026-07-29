import { useCallback, useRef } from 'react';

/**
 * Returns onMouseDown handler for a resize handle element.
 * Drag direction: 'e' (east, handle on right edge) or 'w' (west, handle on left edge).
 * During drag, sets `data-resizing` on <html> so CSS can disable transitions.
 */
export function usePanelResize(cssVar: string, min: number, max: number, direction: 'e' | 'w' = 'e') {
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragging.current = true;
      const root = document.documentElement;
      const startX = e.clientX;
      const startWidth = parseInt(getComputedStyle(root).getPropertyValue(cssVar).trim(), 10) || min;
      root.dataset.resizing = 'true';

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = direction === 'e' ? ev.clientX - startX : startX - ev.clientX;
        const next = Math.min(max, Math.max(min, startWidth + delta));
        root.style.setProperty(cssVar, `${next}px`);
      };

      const onMouseUp = () => {
        dragging.current = false;
        delete root.dataset.resizing;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [cssVar, min, max, direction],
  );

  return { onMouseDown };
}
