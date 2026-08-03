import { Modal, message as antdMessage } from 'antd';
import { useEffect, useState } from 'react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { IAppRuntimeInfo } from '../../shared/types';
import { useAppUiStore } from '../../store/app-store';
import { WhaleLogo } from '../chat-view/components/whale-logo';
import styles from './index.module.scss';

const defaultRuntimeInfo: IAppRuntimeInfo = {
  version: '--',
  electronVersion: '--',
  chromeVersion: '--',
  nodeVersion: '--',
};

export function AboutModal() {
  const isOpen = useAppUiStore((state) => state.isAboutOpen);
  const setAboutOpen = useAppUiStore((state) => state.setAboutOpen);
  const [runtimeInfo, setRuntimeInfo] = useState<IAppRuntimeInfo>(defaultRuntimeInfo);

  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    void getStocksenseApi()
      .getAppRuntimeInfo()
      .then((info) => {
        if (mounted) setRuntimeInfo(info);
      })
      .catch((error) => {
        if (!mounted) return;
        antdMessage.error(error instanceof Error ? error.message : '读取应用版本信息失败');
        setRuntimeInfo(defaultRuntimeInfo);
      });
    return () => {
      mounted = false;
    };
  }, [isOpen]);

  return (
    <Modal
      centered
      className={styles['about-modal']}
      footer={null}
      open={isOpen}
      onCancel={() => setAboutOpen(false)}
      width={568}
    >
      <div className={styles.content}>
        <div className={styles['whale-stage']} aria-label='StockBuddy 动态鲸鱼 Logo' role='img'>
          <div className={styles.whale}>
            <WhaleLogo width={124} height={94} />
            <span className={styles['whale-splash']}>
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
          </div>
        </div>
        <h2>StockBuddy</h2>
        <div className={styles.versions}>
          <div>版本: {runtimeInfo.version}</div>
          <div>Electron: {runtimeInfo.electronVersion}</div>
          <div>Chrome: {runtimeInfo.chromeVersion}</div>
          <div>Node.js: {runtimeInfo.nodeVersion}</div>
        </div>
        <p className={styles.description}>
          面向 A 股投研的 Electron 桌面 AI Agent，支持实时行情、K线、资金流、筹码分布、新闻公告和多维度个股分析。
          <a
            href='https://github.com/hawx1993/stcok-buddy'
            target='_blank'
            rel='noopener noreferrer'
            className={styles.link}
          >
            https://github.com/hawx1993/stcok-buddy
          </a>
        </p>
      </div>
    </Modal>
  );
}
