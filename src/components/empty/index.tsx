import type { ReactNode } from 'react';
import styles from './index.module.scss';

export function Empty({ text }: { text: ReactNode }) {
  return (
    <div className={styles.empty}>
      <img className={styles.logo} src="/icons/icon.svg" alt="" aria-hidden="true" />
      <div className={styles.text}>{text}</div>
    </div>
  );
}
