import { useEffect, useState } from 'react';
import type { IStockTimelinePoint } from '../../../shared/types';
import { getStockComputeWorker } from '../../../workers/stock-compute-client';
import type { IFavoriteTimelinePath } from '../../../workers/stock-compute-types';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

interface IFavoriteTimelineBgProps {
  points: IStockTimelinePoint[] | undefined;
  isUp: boolean;
}

const VIEWBOX_WIDTH = 240;
const VIEWBOX_HEIGHT = 72;

export function FavoriteTimelineBg({ points, isUp }: IFavoriteTimelineBgProps) {
  const [path, setPath] = useState<IFavoriteTimelinePath>();

  useEffect(() => {
    let alive = true;
    getStockComputeWorker()
      .buildFavoriteTimelinePath(points)
      .then((next) => {
        if (alive) setPath(next);
      })
      .catch((error: unknown) => {
        console.error('[favorite-timeline] worker build path failed', error);
        if (alive) setPath(undefined);
      });
    return () => {
      alive = false;
    };
  }, [points]);

  if (!path) return null;

  return (
    <svg
      className={cx(styles['favorite-timeline-bg'], isUp ? styles.up : styles.down)}
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      preserveAspectRatio='none'
      aria-hidden='true'
      focusable='false'
    >
      <path d={path.area} className={styles['favorite-timeline-area']} />
      <path d={path.line} className={styles['favorite-timeline-line']} />
    </svg>
  );
}
