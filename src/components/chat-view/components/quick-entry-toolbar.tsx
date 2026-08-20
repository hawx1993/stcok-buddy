import { AppStoreBar } from './app-store-bar';
import styles from '../index.module.scss';

interface IQuickEntryToolbarProps {
  activeModelName: string;
  onOpenStore(): void;
  onOpenModelSettings(): void;
  onSubmit(): void;
}

export function QuickEntryToolbar({
  activeModelName,
  onOpenStore,
  onOpenModelSettings,
  onSubmit,
}: IQuickEntryToolbarProps) {
  return (
    <div className={styles['composer-toolbar']}>
      <AppStoreBar onOpen={onOpenStore} />
      <div className={styles['composer-actions']}>
        <button
          className={styles['model-pill']}
          onClick={onOpenModelSettings}
          type='button'
          aria-label={`当前模型：${activeModelName}。打开模型设置`}
          title={`当前模型：${activeModelName}。点击打开模型设置`}
        >
          <span className={styles['model-pill-label']}>模型</span>
          <span className={styles['model-pill-name']}>{activeModelName}</span>
        </button>
        <button
          className={styles['send-btn']}
          onClick={onSubmit}
          type='button'
          aria-label='发送'
          title='发送'
        >
          ➤
        </button>
      </div>
    </div>
  );
}
