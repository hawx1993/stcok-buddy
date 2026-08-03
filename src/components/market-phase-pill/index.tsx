import { useEffect, useState } from 'react';
import cx from '../../shared/cx';
import { getAshareMarketPhase } from '../../shared/market-time';
import type { IAshareMarketPhase } from '../../shared/market-time';
import styles from './index.module.scss';

interface IMarketPhasePillProps {
  active?: boolean;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  label?: string;
  onClick?: () => void;
  onPhaseChange?: (phase: IAshareMarketPhase) => void;
  title?: string;
}

export function MarketPhasePill({
  active,
  ariaLabel,
  className,
  disabled,
  label,
  onClick,
  onPhaseChange,
  title,
}: IMarketPhasePillProps) {
  const [marketPhase, setMarketPhase] = useState(() => getAshareMarketPhase(new Date()));
  const isActive = active ?? marketPhase.isTrading;
  const content = label ?? marketPhase.label;
  const classNames = cx(
    styles.phasePill,
    !isActive && styles.phasePillInactive,
    onClick && styles.phasePillInteractive,
    className,
  );

  useEffect(() => {
    onPhaseChange?.(marketPhase);
  }, [marketPhase, onPhaseChange]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMarketPhase(getAshareMarketPhase(new Date()));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const body = (
    <>
      <span className={cx(styles.liveDot, !isActive && styles.liveDotInactive)} />
      {content}
    </>
  );

  if (onClick) {
    return (
      <button
        aria-label={ariaLabel}
        className={classNames}
        disabled={disabled}
        onClick={onClick}
        title={title ?? marketPhase.label}
        type='button'
      >
        {body}
      </button>
    );
  }

  return (
    <span className={classNames} title={title ?? marketPhase.label}>
      {body}
    </span>
  );
}
