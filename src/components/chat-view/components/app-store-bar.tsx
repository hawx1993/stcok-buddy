import { trackButtonClick } from '../../../shared/analytics';
import styles from './app-store-bar.module.scss';

interface IAppStoreBarProps {
  onOpen(): void;
}

export function AppStoreBar({ onOpen }: IAppStoreBarProps) {
  return (
    <div className={styles['store-bar']}>
      <button
        onClick={() => {
          trackButtonClick('open_store');
          onOpen();
        }}
        type='button'
      >
        ＋
      </button>
      <span>插件</span>
    </div>
  );
}
