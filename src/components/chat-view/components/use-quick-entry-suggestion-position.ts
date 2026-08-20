import { useLayoutEffect, useState, type RefObject } from 'react';

export type TQuickEntrySuggestionPlacement = 'above' | 'below';

export interface IQuickEntrySuggestionPosition {
  maxHeight: number;
  placement: TQuickEntrySuggestionPlacement;
}

interface IQuickEntrySuggestionPositionInput {
  anchorBottom: number;
  anchorTop: number;
  viewportHeight: number;
}

const PANEL_OFFSET = 8;
const PREFERRED_MAX_HEIGHT = 260;
const REQUIRED_BOTTOM_GAP = 20;
const MIN_PREFERRED_HEIGHT = 160;

export function resolveQuickEntrySuggestionPosition({
  anchorBottom,
  anchorTop,
  viewportHeight,
}: IQuickEntrySuggestionPositionInput): IQuickEntrySuggestionPosition {
  const belowHeight = Math.max(0, viewportHeight - anchorBottom - PANEL_OFFSET - REQUIRED_BOTTOM_GAP);
  const aboveHeight = Math.max(0, anchorTop - PANEL_OFFSET - REQUIRED_BOTTOM_GAP);
  const placement: TQuickEntrySuggestionPlacement =
    belowHeight >= MIN_PREFERRED_HEIGHT || belowHeight >= aboveHeight ? 'below' : 'above';
  const availableHeight = placement === 'below' ? belowHeight : aboveHeight;

  return { placement, maxHeight: Math.min(PREFERRED_MAX_HEIGHT, availableHeight) };
}

export function useQuickEntrySuggestionPosition(anchorRef: RefObject<HTMLElement | null>, isOpen: boolean) {
  const [position, setPosition] = useState<IQuickEntrySuggestionPosition>({
    placement: 'below',
    maxHeight: PREFERRED_MAX_HEIGHT,
  });

  useLayoutEffect(() => {
    if (!isOpen) return;
    const anchor = anchorRef.current;
    if (!anchor) return;

    const updatePosition = () => {
      const { top, bottom } = anchor.getBoundingClientRect();
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      setPosition(resolveQuickEntrySuggestionPosition({ anchorTop: top, anchorBottom: bottom, viewportHeight }));
    };

    updatePosition();
    const observer = new ResizeObserver(updatePosition);
    observer.observe(anchor);
    window.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('resize', updatePosition);
    window.visualViewport?.addEventListener('scroll', updatePosition);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('resize', updatePosition);
      window.visualViewport?.removeEventListener('scroll', updatePosition);
    };
  }, [anchorRef, isOpen]);

  return position;
}
