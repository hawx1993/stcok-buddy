import { useState } from 'react';
import type { StoreCategory, StoreItem } from '../../../shared/types';
import styles from './app-store-modal.module.scss';

const storeTabs: Array<{ id: StoreCategory; label: string }> = [
  { id: 'commands', label: 'Commands' },
  { id: 'skills', label: 'Skills' },
  { id: 'sub-agents', label: '子代理' },
];

interface IAppStoreModalProps {
  items: StoreItem[];
  installed: string[];
  onInstall(id: string): Promise<void>;
  onUninstall(id: string): Promise<void>;
  onClose(): void;
}

export function AppStoreModal({ items, installed, onInstall, onUninstall, onClose }: IAppStoreModalProps) {
  const [activeTab, setActiveTab] = useState<StoreCategory>('commands');
  const tabItems = items.filter((item) => item.category === activeTab);

  return (
    <div className={styles['store-overlay']} onClick={onClose}>
      <div className={styles['store-modal']} onClick={(event) => event.stopPropagation()}>
        <div className={styles['store-header']}>
          <h2>应用商店</h2>
          <button onClick={onClose} type='button'>
            ✕
          </button>
        </div>
        <div className={styles['store-tabs']}>
          {storeTabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? styles.active : ''}
              onClick={() => setActiveTab(tab.id)}
              type='button'
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles['store-list']}>
          {tabItems.length ? (
            tabItems.map((item) => {
              const isInstalled = installed.includes(item.id);
              return (
                <div className={styles['store-item']} key={item.id}>
                  <div>
                    <div className={styles['store-item-title']}>{item.name}</div>
                    <div className={styles['store-item-desc']}>{item.description}</div>
                  </div>
                  <button
                    className={isInstalled ? styles['store-uninstall'] : ''}
                    onClick={() => void (isInstalled ? onUninstall(item.id) : onInstall(item.id))}
                    type='button'
                  >
                    {isInstalled ? '卸载' : '安装'}
                  </button>
                </div>
              );
            })
          ) : (
            <div className={styles['store-empty']}>暂无可安装内容</div>
          )}
        </div>
      </div>
    </div>
  );
}
