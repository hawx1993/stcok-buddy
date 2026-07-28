import { message as antdMessage } from 'antd';
import { ArrowLeft, Info } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { useAppStore } from '../../store/app-store';
import type { IDiskInfo, IStorageClearProgress, IStorageStats } from '../../shared/types';
import styles from './index.module.scss';

const HIGH_RISK_KEYS = ['chat', 'config', 'market'];
const STORAGE_KEYS = ['chat', 'config', 'market', 'surge'] as const;

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
  { key: 'chat', title: '清空聊天记录', desc: '删除所有会话和消息，无法恢复。' },
  { key: 'config', title: '清空个股收藏记录', desc: '清空右侧栏个股收藏记录，无法恢复' },
  {
    key: 'market',
    title: '清空本地行情数据库',
    desc: '删除本地日K、交易日历、证券列表、个股快照（价格/市值/PE/PB）和板块缓存。清空后需重新同步，可能耗时较长。',
  },
  {
    key: 'surge',
    title: '清空个股异动历史',
    desc: '清空右侧栏个股异动记录和个股详情最近一周异动记录，可在数据同步弹窗中重新同步',
  },
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
  const [clearProgress, setClearProgress] = useState<IStorageClearProgress | null>(null);
  const [confirmModal, setConfirmModal] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');
  const fetchedRef = useRef(false);
  const removeClearProgressRef = useRef<(() => void) | undefined>();

  useEffect(() => {
    if (!isOpen) {
      fetchedRef.current = false;
      removeClearProgressRef.current?.();
      removeClearProgressRef.current = undefined;
      setClearProgress(null);
      return;
    }
    setChecked(new Set());
    setConfirmModal(false);
    setConfirmInput('');
    setClearProgress(null);

    const api = getStocksenseApi();
    if (api.onStorageClearProgress) {
      removeClearProgressRef.current = api.onStorageClearProgress((progress) => {
        setClearProgress(progress);
      });
    }

    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setRevealed(new Set());
    setStats(undefined);
    setDiskInfo(undefined);

    Promise.all([api.getStorageStats(), api.getDiskInfo().catch(() => undefined)])
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
    if (!hasHighRisk) {
      void executeClear();
      return;
    }
    setConfirmModal(true);
  };

  const executeClear = async () => {
    setClearing(true);
    setClearProgress(null);
    // ponytail: close the confirm modal immediately so the progress bar in the
    // main modal footer is visible and the screen isn't dimmed. Previously the
    // confirm modal stayed open (dimming everything) until clearStorage
    // resolved — when the market clear hung, the dimmed modal made it look
    // like the whole app was frozen with no progress bar.
    setConfirmModal(false);
    setConfirmInput('');
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
      // ponytail: notify the surge panel to reload — clearing the surge history
      // DB empties historical dates, but the panel keeps stale items in memory
      // until it reloads. Today's list is live (remote) and unaffected.
      if (keys.includes('surge')) {
        window.dispatchEvent(new CustomEvent('surge:historyCleared'));
      }
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
            {confirmModal ? (
              <>
                <button
                  className={styles['modal-back']}
                  onClick={() => {
                    setConfirmModal(false);
                    setConfirmInput('');
                  }}
                  type='button'
                >
                  <ArrowLeft size={16} />
                </button>
                <h2>确认清空</h2>
              </>
            ) : (
              <h2>存储空间管理</h2>
            )}
            <button className={styles['modal-close']} onClick={() => setOpen(false)} type='button'>
              ✕
            </button>
          </div>

          <div className={styles['modal-body']}>
            {confirmModal ? (
              <div className={styles['confirm-content']}>
                <div className={styles['confirm-icon']}>
                  <Info size={40} />
                </div>
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
                    onClick={() => {
                      setConfirmModal(false);
                      setConfirmInput('');
                    }}
                    type='button'
                  >
                    取消
                  </button>
                  <button
                    className={styles['btn-confirm']}
                    disabled={confirmInput !== '清空' || clearing}
                    onClick={confirmClear}
                    type='button'
                  >
                    {clearing ? '清空中…' : '确认清空'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* ── disk usage progress bar ── */}
                <div className={styles['disk-section']}>
                  <div className={styles['disk-bar']}>
                    {appBytes > 0 && <div className={styles['disk-bar-app']} style={{ width: `${appWidth}%` }} />}
                    {systemBytes > 0 && (
                      <div className={styles['disk-bar-system']} style={{ width: `${systemWidth}%` }} />
                    )}
                    {freeBytes > 0 && <div className={styles['disk-bar-free']} style={{ flex: 1 }} />}
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
                        <input
                          type='checkbox'
                          className={styles['storage-item-checkbox-input']}
                          checked={checked.has(item.key)}
                          onChange={() => toggleKey(item.key)}
                          disabled={clearing || loading}
                        />
                        <span className={styles['storage-item-checkbox']} aria-hidden='true'>
                          <svg width='10' height='10' viewBox='0 0 10 10' fill='none'>
                            <path
                              d='M1.5 5.5L3.8 7.8L8.5 2.5'
                              stroke='currentColor'
                              strokeWidth='1.5'
                              strokeLinecap='round'
                              strokeLinejoin='round'
                            />
                          </svg>
                        </span>
                        <div className={styles['storage-item-body']}>
                          <div className={styles['storage-item-head']}>
                            <span className={styles['storage-item-title']}>{item.title}</span>
                            {ready ? (
                              <span className={styles['storage-item-size']}>
                                {info ? formatBytes(info.bytes) : '0 B'}
                              </span>
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
              </>
            )}
          </div>

          {!confirmModal && (
            <div className={styles['modal-footer']}>
              {clearing && clearProgress && (
                <div className={styles['clear-progress']}>
                  <div className={styles['clear-progress-text']}>
                    {clearProgress.message}
                    {clearProgress.total > 1 && `（${clearProgress.processed}/${clearProgress.total}）`}
                  </div>
                  <div className={styles['clear-progress-bar']}>
                    <div
                      className={styles['clear-progress-fill']}
                      style={{
                        width: `${clearProgress.total > 0 ? Math.min(100, Math.max(3, Math.round(((clearProgress.processed + (clearProgress.fraction ?? 0)) / clearProgress.total) * 100))) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {clearing && !clearProgress && (
                <div className={styles['clear-progress']}>
                  <div className={styles['clear-progress-text']}>正在启动清理…</div>
                  <div className={styles['clear-progress-bar']}>
                    <div className={styles['clear-progress-fill-indeterminate']} />
                  </div>
                </div>
              )}
              <button className={styles['btn-cancel']} onClick={() => setOpen(false)} type='button'>
                取消
              </button>
              <button
                className={styles['btn-clear']}
                disabled={checked.size === 0 || clearing || loading}
                onClick={handleClear}
                type='button'
              >
                {clearing ? '清空中…' : '清空选中数据'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
