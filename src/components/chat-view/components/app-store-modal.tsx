import type { StoreItem } from '../../../shared/types';
import styles from './app-store-modal.module.scss';

interface IAppStoreModalProps {
  items: StoreItem[];
  installed: string[];
  onInstall(id: string): Promise<void>;
  onUninstall(id: string): Promise<void>;
  onClose(): void;
}

export function AppStoreModal({ onClose }: IAppStoreModalProps) {
  return (
    <div className={styles['store-overlay']} onClick={onClose}>
      <div className={styles['store-modal']} onClick={(event) => event.stopPropagation()}>
        <div className={styles['store-header']}>
          <h2>应用商店</h2>
          <button onClick={onClose} type='button'>
            ✕
          </button>
        </div>
        <div className={styles['store-list']}>
          <div className={styles['store-empty']}>待开发，敬请期待</div>
        </div>
      </div>
    </div>
  );
}
