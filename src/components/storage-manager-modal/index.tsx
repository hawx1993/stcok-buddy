import { Checkbox, message as antdMessage, Modal } from 'antd';
import { Info } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { useAppStore } from '../../store/app-store';
import type { IDiskInfo, IStorageStats } from '../../shared/types';
import styles from './index.module.scss';

const HIGH_RISK_KEYS = ['chat', 'config', 'market'];
const STORAGE_KEYS = ['chat', 'config', 'quotes', 'market', 'surge'] as const;

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function pctStr(numerator: number, denominator: number) {
  if (!denominator) return '0.00%';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

function barWidth(numerator: number, denominator: number) {
  if (!denominator || !numerator) return 0;
  return Math.max(2, (numerator / denominator) * 100); // ponydev: min 2% so tiny segments are visible
}

const storageItems = [
  { key: 'chat',   title: '清空聊天记录',      desc: '删除所有会话和消息，无法恢复。' },
  { key: 'config', title: '清空应用配置和收藏',  desc: '重置主题、模型配置、收藏股票、新闻偏好、Store 安装状态等。' },
  { key: 'quotes', title: '清空最新行情缓存',    desc: '删除本地最新行情快照，应用会重新拉取真实行情。' },
  { key: 'market', title: '清空本地行情数据库',  desc: '删除本地日 K、交易日历、股票基础信息、同步任务和板块缓存。清空后需要重新同步，可能耗时较长。' },
  { key: 'surge',  title: '清空异动/热点历史',  desc: '删除历史热点、异动记录。' },
] as const;

export function StorageManagerModal() {
  const isOpen = useAppStore((state) => state.isStorageManagerOpen);
  const setOpen = useAppStore((state) => state.setStorageManagerOpen);
  const [stats, setStats] = useState<IStorageStats>();
  const [diskInfo, setDiskInfo] = useState<IDiskInfo>();
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [clearing, setClearing] = useState(false);
  const [confirmModal, setConfirmModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      fetchedRef.current = false;
      return;
    }
    setChecked(new Set());
    setConfirmModal(false);
    setConfirmInput('');
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setRevealed(new Set());
    setStats(undefined);
    setDiskInfo(undefined);

    const api = getStocksenseApi();
    Promise.all([
      api.getStorageStats(),
      api.getDiskInfo().catch(() => undefined),
    ])
      .then(([result, disk]) => {
        setStats(result);
        if (disk) setDiskInfo(disk);
        let delay = 0;
        for (const key of STORAGE_KEYS) {
          setTimeout(() => setRevealed((prev) => new Set(prev).add(key)), delay);
          delay += 120;
        }
        setTimeout(() => setLoading(false), delay);
      })
      .catch(() => {
        antdMessage.error('获取存储空间信息失败');
        setLoading(false);
      });
  }, [isOpen]);

  const hasHighRisk = useMemo(() => {
    for (const key of checked) if (HIGH_RISK_KEYS.includes(key)) return true;
    return false;
  }, [checked]);

  const toggleKey = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleClear = () => {
    if (!hasHighRisk) { void executeClear(); return; }
    setConfirmModal(true);
  };

  const executeClear = async () => {
    setClearing(true);
    try {
      const keys = [...checked];
      const api = getStocksenseApi();
      const [nextStats, nextDisk] = await Promise.all([
        api.clearStorage(keys),
        api.getDiskInfo().catch(() => undefined),
      ]);
      if (nextStats) {
        setStats(nextStats);
        setRevealed(new Set(STORAGE_KEYS));
      }
      if (nextDisk) setDiskInfo(nextDisk);
      setChecked(new Set());
      antdMessage.success('已清空选中数据');
    } catch (error) {
      antdMessage.error(error instanceof Error ? error.message : '清空数据失败');
    } finally {
      setClearing(false);
      setConfirmModal(false);
      setConfirmInput('');
    }
  };

  const confirmClear = () => {
    if (confirmInput !== '清空') return;
    void executeClear();
  };

  if (!isOpen) return null;

  const appBytes = diskInfo?.usedByAppBytes ?? 0;
  const totalBytes = diskInfo?.totalBytes ?? 0;
  const freeBytes = diskInfo?.freeBytes ?? 0;
  const systemBytes = Math.max(0, totalBytes - freeBytes - appBytes);

  const appWidth = barWidth(appBytes, totalBytes);
  const systemWidth = barWidth(systemBytes, totalBytes);

  return (
    <>
      <div className={`${styles['modal-overlay']} ${styles.open}`} onClick={() => setOpen(false)}>
        <div className={styles.modal} onClick={(event) => event.stopPropagation()}>
          <div className={styles['modal-header']}>
            <h2>存储空间管理</h2>
            <button className={styles['modal-close']} onClick={() => setOpen(false)} type="button">✕</button>
          </div>

          <div className={styles['modal-body']}>
            {/* ── disk usage progress bar ── */}
            <div className={styles['disk-section']}>
              <div className={styles['disk-bar']}>
                {appBytes > 0 && (
                  <div className={styles['disk-bar-app']} style={{ width: `${appWidth}%` }} />
                )}
                {systemBytes > 0 && (
                  <div className={styles['disk-bar-system']} style={{ width: `${systemWidth}%` }} />
                )}
                {freeBytes > 0 && (
                  <div className={styles['disk-bar-free']} style={{ flex: 1 }} />
                )}
              </div>
              <div className={styles['disk-legend']}>
                <span className={styles['disk-legend-item']}>
                  <i className={styles['disk-dot-app']} />
                  StockBuddy {formatBytes(appBytes)} {pctStr(appBytes, totalBytes)}
                </span>
                <span className={styles['disk-legend-item']}>
                  <i className={styles['disk-dot-system']} />
                  系统 {formatBytes(systemBytes)} {pctStr(systemBytes, totalBytes)}
                </span>
                <span className={styles['disk-legend-item']}>
                  <i className={styles['disk-dot-free']} />
                  可用 {formatBytes(freeBytes)} {pctStr(freeBytes, totalBytes)}
                </span>
              </div>
            </div>

            {/* ── storage item list ── */}
            <div className={styles['storage-list']}>
              {storageItems.map((item) => {
                const info = stats?.[item.key];
                const ready = revealed.has(item.key);
                return (
                  <label key={item.key} className={styles['storage-item']}>
                    <Checkbox
                      checked={checked.has(item.key)}
                      onChange={() => toggleKey(item.key)}
                      disabled={clearing || loading}
                    />
                    <div className={styles['storage-item-body']}>
                      <div className={styles['storage-item-head']}>
                        <span className={styles['storage-item-title']}>{item.title}</span>
                        {ready ? (
                          <span className={styles['storage-item-size']}>{info ? formatBytes(info.bytes) : '0 B'}</span>
                        ) : (
                          <span className={styles['size-calculating']}>计算中…</span>
                        )}
                      </div>
                      <div className={styles['storage-item-desc']}>{item.desc}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          <div className={styles['modal-footer']}>
            <button className={styles['btn-cancel']} onClick={() => setOpen(false)} type="button">取消</button>
            <button
              className={styles['btn-clear']}
              disabled={checked.size === 0 || clearing || loading}
              onClick={handleClear}
              type="button"
            >
              {clearing ? '清空中…' : '清空选中数据'}
            </button>
          </div>
        </div>
      </div>

      <Modal
        centered
        className={styles['confirm-modal']}
        footer={null}
        open={confirmModal}
        onCancel={() => { setConfirmModal(false); setConfirmInput(''); }}
        width={400}
      >
        <div className={styles['confirm-content']}>
          <div className={styles['confirm-icon']}><Info size={40} /></div>
          <h3>此操作不可恢复</h3>
          <p>请输入「清空」确认操作</p>
          <input
            className={styles['confirm-input']}
            value={confirmInput}
            onChange={(event) => setConfirmInput(event.target.value)}
            placeholder='请输入"清空"'
            autoFocus
          />
          <div className={styles['confirm-actions']}>
            <button
              className={styles['btn-cancel']}
              onClick={() => { setConfirmModal(false); setConfirmInput(''); }}
              type="button"
            >
              取消
            </button>
            <button
              className={styles['btn-confirm']}
              disabled={confirmInput !== '清空' || clearing}
              onClick={confirmClear}
              type="button"
            >
              {clearing ? '清空中…' : '确认清空'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
