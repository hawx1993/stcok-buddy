import { CheckCircle, XCircle } from 'lucide-react';
import type { IAppUpdateState } from '../../../shared/types';
import styles from '../index.module.scss';

export function VersionUpdateStatusCard({ state }: { state?: IAppUpdateState }) {
  const content = getUpdateStatusContent(state);
  const progressPercent = Math.round(state?.progress?.percent ?? 0);
  return (
    <div className={`${styles['update-status-card']} ${styles[`update-status-${content.tone}`]}`}>
      <div className={styles['update-status-title']}>
        {content.tone === 'error' ? <XCircle size={15} /> : <CheckCircle size={15} />}
        <span>{content.title}</span>
      </div>
      {content.message ? <div className={styles['update-status-message']}>{content.message}</div> : null}
      {state?.status === 'downloading' ? (
        <div className={styles['update-download-progress']} aria-label={`下载进度 ${progressPercent}%`}>
          <div style={{ width: `${progressPercent}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function getUpdateStatusContent(state?: IAppUpdateState) {
  if (!state) return { tone: 'idle', title: '尚未读取更新状态', message: '打开设置后会读取当前版本信息。' };
  if (state.status === 'checking') return { tone: 'info', title: '正在检查更新…', message: state.message };
  if (state.status === 'available') {
    return { tone: 'warning', title: `发现新版本：${state.currentVersion} → ${state.latestVersion ?? '--'}`, message: state.message };
  }
  if (state.status === 'downloading') {
    const progress = state.progress;
    const percent = Math.round(progress?.percent ?? 0);
    const message = progress ? `${formatBytes(progress.transferred)} / ${formatBytes(progress.total)}，${formatBytes(progress.bytesPerSecond)}/s` : state.message;
    return { tone: 'warning', title: `正在下载更新… ${percent}%`, message };
  }
  if (state.status === 'downloaded') return { tone: 'success', title: '新版本已下载', message: state.message ?? '点击安装后将退出当前软件并开始安装。' };
  if (state.status === 'not-available') return { tone: 'success', title: '已是最新版本', message: state.latestVersion ? `当前版本：${state.currentVersion}` : state.message };
  if (state.status === 'error') return { tone: 'error', title: '无法检查 GUI 更新', message: state.error ?? state.message ?? '请稍后重试，或打开下载页手动下载。' };
  return { tone: 'idle', title: `当前版本：${state.currentVersion}`, message: '可手动检查 GUI 新版本。' };
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
