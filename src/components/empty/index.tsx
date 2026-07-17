import type { ReactNode } from 'react';
import styles from './index.module.scss';

const logoUrl = `${import.meta.env.BASE_URL}icons/icon.svg`;

export function Empty({ text }: { text: ReactNode }) {
  return (
    <div className={styles.empty}>
      <img className={styles.logo} src={logoUrl} alt='' aria-hidden='true' />
      <div className={styles.text}>{text}</div>
    </div>
  );
}
