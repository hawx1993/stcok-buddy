import { useEffect, useMemo, useState } from 'react';
import type { AppConfig, HoldingPeriod, ProviderKind, RiskProfile, TradeStyle } from '../../shared/types';
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

  useEffect(() => setDraft(config), [config]);

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

  const save = async () => {
    const saved = await getStocksenseApi().setConfig(draft);
    setConfig(saved);
    setToast('设置已保存');
    window.setTimeout(() => {
      setToast('');
      setSettingsOpen(false);
    }, 650);
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
