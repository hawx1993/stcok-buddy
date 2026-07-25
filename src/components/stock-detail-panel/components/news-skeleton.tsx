import { Skeleton } from 'antd';
import styles from '../index.module.scss';

interface INewsSkeletonProps {
  rows: number;
}

export function NewsSkeleton({ rows }: INewsSkeletonProps) {
  return (
    <div className={styles['news-skeleton']}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          active
          paragraph={{ rows: 1 }}
          title={{ width: '72%' }}
          className={styles['news-skeleton-row']}
        />
      ))}
    </div>
  );
}
