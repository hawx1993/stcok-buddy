import { useEffect, useMemo, useState } from 'react';
import type { AppConfig, HoldingPeriod, MarketColorMode, MarketDataStats, MarketDataSyncStatus, ProviderKind, RiskProfile, TradeStyle } from '../../shared/types';
import { getMarketColors, marketColorModes } from '../../shared/market-color';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { useAppStore } from '../../store/app-store';
import styles from './index.module.scss';

type ProviderPreset = {
  id: ProviderKind;
  name: string;
  endpoint: string;
  model: string;
  hint: string;
};

const providers: ProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', endpoint: 'https://api.deepseek.com', model: 'deepseek-chat', hint: '支持 deepseek-chat / deepseek-reasoner；DeepSeek v4 发布后可直接填写官方模型名。' },
  { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o', hint: '兼容 OpenAI Chat Completions。' },
  { id: 'qwen', name: '通义千问', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', hint: 'DashScope OpenAI 兼容模式。' },
  { id: 'baidu', name: '文心一言', endpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat', model: 'ernie-4.0', hint: '如使用非 OpenAI 兼容接口，后续可扩展专用适配器。' },
  { id: 'zhipu', name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus', hint: '智谱 v4 API。' },
  { id: 'moonshot', name: '月之暗面', endpoint: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', hint: 'Moonshot OpenAI 兼容接口。' },
  { id: 'openai-compatible', name: 'OpenAI Compatible', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini', hint: '适用于任意兼容 Chat Completions 的网关或本地模型。' },
  { id: 'custom', name: '自定义 API', endpoint: '', model: '', hint: '填写自定义 Base URL 与模型名称。' },
];

const tradeStyles: Array<{ value: TradeStyle; label: string; desc: string }> = [
  { value: 'value', label: '价值投资', desc: '长期持有' },
  { value: 'trend', label: '趋势交易', desc: '波段操作' },
  { value: 'balanced', label: '均衡型', desc: '两者结合' },
];

const riskProfiles: Array<{ value: RiskProfile; label: string; desc: string }> = [
  { value: 'conservative', label: '保守', desc: '低波动' },
  { value: 'moderate', label: '稳健', desc: '中等风险' },
  { value: 'aggressive', label: '进取', desc: '高弹性' },
];

const holdingPeriods: Array<{ value: HoldingPeriod; label: string }> = [
  { value: 'short', label: '短线（1–7 天）' },
  { value: 'medium', label: '中短线（1–4 周）' },
  { value: 'long', label: '中长线（1–6 个月）' },
  { value: 'very-long', label: '长线（6 月以上）' },
];

export function SettingsModal() {
  const isOpen = useAppStore((state) => state.isSettingsOpen);
  const config = useAppStore((state) => state.config);
  const setConfig = useAppStore((state) => state.setConfig);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const [draft, setDraft] = useState<AppConfig | undefined>(config);
  const [showKey, setShowKey] = useState(false);
  const [toast, setToast] = useState('');
  const [marketStatus, setMarketStatus] = useState<MarketDataSyncStatus>();
  const [marketStats, setMarketStats] = useState<MarketDataStats>();
  const [marketActionPending, setMarketActionPending] = useState(false);

  useEffect(() => setDraft(config), [config]);
  useEffect(() => {
    if (!isOpen) return;
    const api = getStocksenseApi();
    void Promise.all([api.getMarketDataSyncStatus(), api.getMarketDataStats()]).then(([status, stats]) => {
      setMarketStatus(status);
      setMarketStats(stats);
    });
    return api.onMarketDataProgress?.((status) => {
      setMarketStatus(status);
      void api.getMarketDataStats().then(setMarketStats);
    });
  }, [isOpen]);

  const currentProvider = useMemo(
    () => providers.find((item) => item.id === draft?.model.provider) ?? providers[0],
    [draft?.model.provider],
  );

  if (!isOpen || !draft) return null;

  const changeProvider = (provider: ProviderKind) => {
    const preset = providers.find((item) => item.id === provider) ?? providers[0];
    setDraft({
      ...draft,
      model: {
        ...draft.model,
        provider,
        baseUrl: preset.endpoint,
        model: preset.model,
        customModel: preset.model,
      },
    });
  };

  const selectTradeStyle = (tradeStyle: TradeStyle) => setDraft({ ...draft, tradeStyle });
  const selectRiskProfile = (riskProfile: RiskProfile) => setDraft({ ...draft, riskProfile });
  const selectMarketColorMode = (marketColorMode: MarketColorMode) => setDraft({ ...draft, marketColorMode });

  const save = async () => {
    const saved = await getStocksenseApi().setConfig(draft);
    setConfig(saved);
    setToast('设置已保存');
    window.setTimeout(() => {
      setToast('');
      setSettingsOpen(false);
    }, 650);
  };

  const runMarketAction = async (action: 'sync' | 'retry') => {
    setMarketActionPending(true);
    try {
      const api = getStocksenseApi();
      const status = action === 'sync' ? await api.startMarketDataSync() : await api.retryMarketDataFailures();
      setMarketStatus(status);
      setMarketStats(await api.getMarketDataStats());
    } finally {
      setMarketActionPending(false);
    }
  };

  return (
    <div className={`${styles['modal-overlay']} ${styles.open}`} onClick={() => setSettingsOpen(false)}>
      <div className={`${styles.modal} ${styles['settings-system-modal'] ?? ''}`} onClick={(event) => event.stopPropagation()}>
        <div className={styles['modal-header']}>
          <h2>系统设置</h2>
          <button className={styles['modal-close']} onClick={() => setSettingsOpen(false)} type="button">✕</button>
        </div>

        <div className={styles['modal-body']}>
          <div className={styles['settings-section']}>
            <div className={styles['settings-section-title']}>大模型厂商配置</div>
            <div className={styles['settings-row']}>
              <label className={styles.label} htmlFor="llm-provider">选择模型厂商</label>
              <select id="llm-provider" value={draft.model.provider} onChange={(event) => changeProvider(event.target.value as ProviderKind)}>
                {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </div>
            <div className={styles['settings-row']}>
              <label className={styles.label} htmlFor="api-endpoint">API 地址</label>
              <input id="api-endpoint" value={draft.model.baseUrl} onChange={(event) => setDraft({ ...draft, model: { ...draft.model, baseUrl: event.target.value } })} placeholder="https://api.deepseek.com" />
              <div className={styles.hint}>填入对应厂商的 API 端点地址</div>
            </div>
            <div className={styles['settings-row']}>
              <label className={styles.label} htmlFor="api-key">API Key</label>
              <div className={styles['api-key-row']}>
                <input id="api-key" type={showKey ? 'text' : 'password'} value={draft.model.apiKey} onChange={(event) => setDraft({ ...draft, model: { ...draft.model, apiKey: event.target.value } })} placeholder="sk-xxxxxxxxxxxx" />
                <button className={styles['toggle-vis']} onClick={() => setShowKey((value) => !value)} type="button">{showKey ? '🙈' : '👁'}</button>
              </div>
              <div className={styles.hint}>API Key 仅存储在本地设备中，不会上传到 StockBuddy 服务端</div>
            </div>
            <div className={styles['settings-row']}>
              <label className={styles.label} htmlFor="model-name">模型名称（可选）</label>
              <input id="model-name" value={draft.model.customModel ?? draft.model.model} onChange={(event) => setDraft({ ...draft, model: { ...draft.model, customModel: event.target.value, model: event.target.value || currentProvider.model } })} placeholder={currentProvider.model || '自定义模型名称'} />
              <div className={styles.hint}>{currentProvider.hint}</div>
            </div>
          </div>

          <div className={styles['settings-section']}>
            <div className={styles['settings-section-title']}>本地行情数据库</div>
            <div className={styles['market-db-grid']}>
              <StatusItem label="状态" value={marketStatusLabel(marketStatus)} />
              <StatusItem label="最新交易日" value={marketStats?.latestTradeDate ?? marketStatus?.latestLocalTradeDate ?? '--'} />
              <StatusItem label="股票数量" value={marketStats ? marketStats.securityCount.toLocaleString() : '--'} />
              <StatusItem label="日K记录" value={marketStats ? marketStats.dailyBarCount.toLocaleString() : '--'} />
              <StatusItem label="数据库大小" value={marketStats ? formatBytes(marketStats.databaseBytes) : '--'} />
              <StatusItem label="失败股票" value={String(marketStatus?.failedSymbols ?? marketStats?.failedSymbols ?? 0)} />
            </div>
            {marketStatus?.totalSymbols ? (
              <div className={styles['market-db-progress']}>
                <div style={{ width: `${Math.min(100, (marketStatus.processedSymbols / marketStatus.totalSymbols) * 100)}%` }} />
              </div>
            ) : null}
            <div className={styles.hint}>{marketStatus?.message ?? '首次使用会在后台回填最近 10 年 A 股日线，App 可正常使用。'}</div>
            <div className={styles['market-db-actions']}>
              <button type="button" disabled={marketActionPending || marketStatus?.state === 'syncing' || marketStatus?.state === 'initializing'} onClick={() => void runMarketAction('sync')}>立即同步</button>
              <button type="button" disabled={marketActionPending || !(marketStats?.failedSymbols || marketStatus?.failedSymbols)} onClick={() => void runMarketAction('retry')}>重试失败项</button>
            </div>
          </div>

          <div className={styles['settings-section']}>
            <div className={styles['settings-section-title']}>行情颜色</div>
            <div className={styles['settings-row']}>
              <label className={styles.label}>涨跌颜色</label>
              <div className={`${styles['radio-group']} ${styles['market-color-group']}`}>
                {marketColorModes.map((item) => {
                  const colors = getMarketColors(item.value);
                  return (
                    <button key={item.value} className={`${styles['radio-item']} ${styles['market-color-item']} ${(draft.marketColorMode ?? 'red-up-green-down') === item.value ? styles.active : ''}`} onClick={() => selectMarketColorMode(item.value)} type="button">
                      <CandlestickIcon upColor={colors.upColor} downColor={colors.downColor} />
                      <span className={styles['radio-label']}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={styles['settings-section']}>
            <div className={styles['settings-section-title']}>交易模式</div>
            <div className={styles['settings-row']}>
              <label className={styles.label}>交易风格</label>
              <div className={styles['radio-group']}>
                {tradeStyles.map((item) => (
                  <button key={item.value} className={`${styles['radio-item']} ${draft.tradeStyle === item.value ? styles.active : ''}`} onClick={() => selectTradeStyle(item.value)} type="button">
                    <span className={styles['radio-label']}>{item.label}</span>
                    <span className={styles['radio-desc']}>{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles['settings-row']}>
              <label className={styles.label}>风险偏好</label>
              <div className={styles['radio-group']}>
                {riskProfiles.map((item) => (
                  <button key={item.value} className={`${styles['radio-item']} ${draft.riskProfile === item.value ? styles.active : ''}`} onClick={() => selectRiskProfile(item.value)} type="button">
                    <span className={styles['radio-label']}>{item.label}</span>
                    <span className={styles['radio-desc']}>{item.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles['settings-row']}>
              <label className={styles.label} htmlFor="holding-period">持仓周期</label>
              <select id="holding-period" value={draft.holdingPeriod ?? 'medium'} onChange={(event) => setDraft({ ...draft, holdingPeriod: event.target.value as HoldingPeriod })}>
                {holdingPeriods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className={styles['modal-footer']}>
          <button className={styles['btn-cancel']} onClick={() => setSettingsOpen(false)} type="button">取消</button>
          <button className={styles['btn-save']} onClick={save} type="button">保存</button>
        </div>
      </div>
      {toast ? <div className={`${styles.toast} ${styles.show} ${styles.success}`}>{toast}</div> : null}
    </div>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return <div className={styles['market-db-item']}><span>{label}</span><strong>{value}</strong></div>;
}

function marketStatusLabel(status?: MarketDataSyncStatus) {
  return ({ idle: '空闲', checking: '检查中', initializing: '初始化中', syncing: '同步中', completed: '已完成', partial: '部分完成', failed: '失败' } as Record<string, string>)[status?.state ?? 'idle'];
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function CandlestickIcon({ upColor, downColor }: { upColor: string; downColor: string }) {
  return (
    <svg className={styles['market-icon']} viewBox="0 0 34 24" aria-hidden="true">
      <line x1="10" y1="2" x2="10" y2="22" stroke={upColor} strokeWidth="1.5" />
      <rect x="6" y="5" width="8" height="14" rx="1" fill={upColor} />
      <line x1="24" y1="4" x2="24" y2="20" stroke={downColor} strokeWidth="1.5" />
      <rect x="20" y="9" width="8" height="7" rx="1" fill={downColor} />
    </svg>
  );
}
