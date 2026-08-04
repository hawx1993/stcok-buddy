import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

interface IDeferredDiscoverySectionProps {
  active: boolean;
  activationKey: string;
  rootRef: RefObject<HTMLElement>;
  placeholder: ReactNode;
  children: ReactNode;
  className?: string;
  unmountWhenHidden?: boolean;
  onVisible(): void;
}

export function DeferredDiscoverySection({
  active,
  activationKey,
  rootRef,
  placeholder,
  children,
  className,
  unmountWhenHidden = false,
  onVisible,
}: IDeferredDiscoverySectionProps) {
  const targetRef = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    if (active && !unmountWhenHidden) return;
    const target = targetRef.current;
    const root = rootRef.current;
    if (!target || !root) return;
    if (typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      onVisibleRef.current();
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting);
        setIsVisible(visible);
        if (visible) onVisibleRef.current();
      },
      { root, rootMargin: '0px', threshold: 0.01 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [active, activationKey, rootRef, unmountWhenHidden]);

  const shouldRender = active && (!unmountWhenHidden || isVisible);
  return <div ref={targetRef} className={className}>{shouldRender ? children : placeholder}</div>;
}
