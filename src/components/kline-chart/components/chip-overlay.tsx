import type { KlinePoint, ChipDistribution } from '../../../shared/types';
import styles from '../index.module.scss';

export function ChipOverlay({ chips, data }: { chips: ChipDistribution; data: KlinePoint[] }) {
  if (!chips.points.length || !data.length) return null;
  const high = Math.max(...data.map((item) => item.high)) * 1.02;
  const low = Math.min(...data.map((item) => item.low)) * 0.98;
  const range = high - low || 1;
  const maxWeight = Math.max(...chips.points.map((point) => point.weight), 1);
  return (
    <div className={styles.chips}>
      {chips.points.map((point) => {
        const top = ((high - point.price) / range) * 100;
        if (top < 0 || top > 100) return null;
        return (
          <span
            key={`${point.price}-${point.weight}`}
            className={(point.profit ?? 0) >= 0.5 ? styles.profit : styles.loss}
            style={{ top: `${top}%`, width: `${Math.max(2, (point.weight / maxWeight) * 100)}%` }}
          />
        );
      })}
    </div>
  );
}
