import { AlertCircle, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { IAppUpdateState } from '../../../shared/types';
import { trackButtonClick } from '../../../shared/analytics';
import styles from '../index.module.scss';

const visibleStatuses = new Set<IAppUpdateState['status']>(['available', 'downloading', 'downloaded', 'error']);
const DOWNLOAD_REMINDER_INTERVAL_MS = 4 * 60 * 60 * 1000;

export function UpdateBanner() {
  const [state, setState] = useState<IAppUpdateState>();
  const [dismissed, setDismissed] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);

  useEffect(() => {
    const api = getStocksenseApi();
    let mounted = true;
    void api.getAppUpdateState().then((nextState) => {
      if (mounted) setState(nextState);
    }).catch(console.error);
    const unsubscribe = api.onAppUpdateStateChanged?.((nextState) => {
      setState(nextState);
      if (nextState.status === 'available' || nextState.status === 'downloaded' || nextState.status === 'error') {
        setPendingAction(false);
        setDismissed(false);
      }
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (!dismissed || state?.status !== 'downloaded') return;
    const reminderTimer = window.setTimeout(() => setDismissed(false), DOWNLOAD_REMINDER_INTERVAL_MS);
    return () => window.clearTimeout(reminderTimer);
  }, [dismissed, state?.status]);

  const progressPercent = Math.round(state?.progress?.percent ?? 0);
  const content = useMemo(() => getUpdateContent(state, progressPercent), [progressPercent, state]);

  if (!state || dismissed || !visibleStatuses.has(state.status)) return null;

  const runPrimaryAction = async () => {
    const api = getStocksenseApi();
    setPendingAction(true);
    try {
      if (state.status === 'available') {
        trackButtonClick('download_app_update');
        setState(await api.downloadAppUpdate());
        return;
      }
      if (state.status === 'downloaded') {
        trackButtonClick('install_app_update');
        await api.installAppUpdate();
        return;
      }
      if (state.status === 'error') {
        trackButtonClick('retry_app_update');
        setState(await api.checkAppUpdate());
      }
    } catch (error) {
      setState({
        ...state,
        status: 'error',
        error: error instanceof Error ? error.message : '更新操作失败',
        message: error instanceof Error ? error.message : '更新操作失败',
      });
    } finally {
      setPendingAction(false);
    }
  };

  const openReleaseNotes = async () => {
    trackButtonClick('open_app_release_notes');
    await getStocksenseApi().openAppReleaseNotes();
  };

  return (
    <div className={styles['update-banner']}>
      <div className={styles['update-banner-header']}>
        <div className={styles['update-title']}>
          {state.status === 'error' ? <AlertCircle size={14} /> : <Download size={14} />}
          <span>{content.title}</span>
        </div>
        <button
          className={styles['update-dismiss']}
          onClick={() => setDismissed(true)}
          type='button'
          aria-label='关闭更新提示'
        >
          ×
        </button>
      </div>
      <div className={styles['update-message']}>{content.message}</div>
      {state.status === 'downloading' ? (
        <div className={styles['update-progress']} aria-label={`下载进度 ${progressPercent}%`}>
          <div style={{ width: `${progressPercent}%` }} />
        </div>
      ) : null}
      <div className={styles['update-actions']}>
        <button className={styles['update-link-btn']} onClick={() => void openReleaseNotes()} type='button'>
          <ExternalLink size={12} />
          更新日志
        </button>
        <button
          className={styles['update-primary-btn']}
          onClick={() => void runPrimaryAction()}
          disabled={state.status === 'downloading' || pendingAction}
          type='button'
        >
          {state.status === 'error' ? <RefreshCw size={12} /> : null}
          {pendingAction ? '处理中…' : content.actionLabel}
        </button>
      </div>
    </div>
  );
}

function getUpdateContent(state: IAppUpdateState | undefined, progressPercent: number) {
  if (state?.status === 'downloading') {
    return { title: `正在下载 ${progressPercent}%`, message: '下载完成后可安装新版本。', actionLabel: `${progressPercent}%` };
  }
  if (state?.status === 'downloaded') {
    return { title: '新版本已下载', message: '点击安装后将退出当前软件并开始安装。', actionLabel: '安装' };
  }
  if (state?.status === 'error') {
    return { title: '更新失败', message: state.error ?? state.message ?? '请稍后重试。', actionLabel: '重试' };
  }
  return {
    title: state?.latestVersion ? `发现新版本 v${state.latestVersion}` : '发现新版本',
    message: '可立即下载更新包，下载期间可继续使用。',
    actionLabel: '立即更新',
  };
}
