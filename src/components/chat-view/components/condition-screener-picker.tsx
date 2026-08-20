import {
  ArrowUpDown,
  Banknote,
  BarChart3,
  Check,
  CircleDollarSign,
  Crosshair,
  Landmark,
  Layers,
  ListOrdered,
  Map as MapIcon,
  Percent,
  Repeat2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  conditionScreenerParameters,
  conditionScreenerPresets,
  createConditionScreenerCommand,
  insertConditionScreenerParameter,
  shouldOpenConditionScreenerParameters,
  toggleConditionScreenerPreset,
  type TConditionScreenerParameterId,
  type TConditionScreenerPresetId,
} from '../../../shared/condition-screener';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

interface IConditionScreenerPickerProps {
  value: string;
  onCommandChange(command: string): void;
  onRequestInputFocus?(): void;
}

type TConditionScreenerPanelTab = 'parameters' | 'presets';

const conditionScreenerParticles = [
  'north',
  'east',
  'cursor-a',
  'south',
  'cursor-b',
  'soft',
  'west',
  'cursor-c',
  'upper',
  'ember',
  'cursor-d',
  'lower',
  'tiny',
  'cursor-e',
  'deep',
  'cursor-f',
] as const;

interface IConditionScreenerPointerState {
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  rafId: number | null;
  isLeaving: boolean;
}

const conditionScreenerPointerStates = new WeakMap<HTMLButtonElement, IConditionScreenerPointerState>();

const renderConditionScreenerParticles = () => (
  <span aria-hidden='true' className={styles['condition-screener-particles']}>
    {conditionScreenerParticles.map((particle) => (
      <span className={styles['condition-screener-particle']} key={particle} />
    ))}
  </span>
);

const setConditionScreenerPointerVars = (element: HTMLButtonElement, x: number, y: number) => {
  element.style.setProperty('--condition-screener-pointer-x', `${x.toFixed(1)}px`);
  element.style.setProperty('--condition-screener-pointer-y', `${y.toFixed(1)}px`);
};

const scheduleConditionScreenerPointerFrame = (
  element: HTMLButtonElement,
  state: IConditionScreenerPointerState,
) => {
  if (state.rafId !== null) return;

  const animate = () => {
    state.rafId = null;
    if (!element.isConnected) {
      conditionScreenerPointerStates.delete(element);
      return;
    }

    const deltaX = state.targetX - state.currentX;
    const deltaY = state.targetY - state.currentY;
    if (Math.abs(deltaX) <= 0.35 && Math.abs(deltaY) <= 0.35) {
      state.currentX = state.targetX;
      state.currentY = state.targetY;
      setConditionScreenerPointerVars(element, state.currentX, state.currentY);
      if (state.isLeaving) {
        element.style.removeProperty('--condition-screener-pointer-x');
        element.style.removeProperty('--condition-screener-pointer-y');
        conditionScreenerPointerStates.delete(element);
      }
      return;
    }

    state.currentX += deltaX * 0.16;
    state.currentY += deltaY * 0.16;
    setConditionScreenerPointerVars(element, state.currentX, state.currentY);
    state.rafId = window.requestAnimationFrame(animate);
  };

  state.rafId = window.requestAnimationFrame(animate);
};

const setConditionScreenerParticlePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
  const { clientX, clientY, currentTarget } = event;
  const rect = currentTarget.getBoundingClientRect();
  const targetX = clientX - rect.left;
  const targetY = clientY - rect.top;
  let state = conditionScreenerPointerStates.get(currentTarget);

  if (!state) {
    state = {
      currentX: rect.width / 2,
      currentY: rect.height / 2,
      targetX,
      targetY,
      rafId: null,
      isLeaving: false,
    };
    conditionScreenerPointerStates.set(currentTarget, state);
  }

  state.targetX = targetX;
  state.targetY = targetY;
  state.isLeaving = false;
  scheduleConditionScreenerPointerFrame(currentTarget, state);
};

const resetConditionScreenerParticlePointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
  const { currentTarget } = event;
  const state = conditionScreenerPointerStates.get(currentTarget);
  if (!state) {
    currentTarget.style.removeProperty('--condition-screener-pointer-x');
    currentTarget.style.removeProperty('--condition-screener-pointer-y');
    return;
  }

  const rect = currentTarget.getBoundingClientRect();
  state.targetX = rect.width / 2;
  state.targetY = rect.height / 2;
  state.isLeaving = true;
  scheduleConditionScreenerPointerFrame(currentTarget, state);
};

const parameterIcons: Record<TConditionScreenerParameterId, LucideIcon> = {
  'market-scope': MapIcon,
  'exclude-st': ShieldCheck,
  'total-market-cap': Landmark,
  'circulating-market-cap': CircleDollarSign,
  'turnover-rate': Repeat2,
  amount: Banknote,
  volume: BarChart3,
  'change-percent': TrendingUp,
  'concentration-90': Target,
  'concentration-70': Crosshair,
  'profit-ratio': Percent,
  'leading-boards': Layers,
  sort: ArrowUpDown,
  limit: ListOrdered,
};

const presetIcons: Record<TConditionScreenerPresetId, LucideIcon> = {
  'small-cap-high-turnover': Repeat2,
  'chip-concentration-improving': Target,
  'strong-volume-not-limit-up': TrendingUp,
  'low-position-active': Crosshair,
  'leading-board-stocks': Layers,
};

export function ConditionScreenerPicker({
  value,
  onCommandChange,
  onRequestInputFocus,
}: IConditionScreenerPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const automaticTriggerRef = useRef('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TConditionScreenerPanelTab>('presets');
  const [selectedPresetIds, setSelectedPresetIds] = useState<TConditionScreenerPresetId[]>([]);
  const shouldOpenAutomatically = shouldOpenConditionScreenerParameters(value);

  useEffect(() => {
    if (!shouldOpenAutomatically) {
      automaticTriggerRef.current = '';
      return;
    }
    if (automaticTriggerRef.current === value) return;
    automaticTriggerRef.current = value;
    setActiveTab('parameters');
    setIsOpen(true);
  }, [shouldOpenAutomatically, value]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const requestInputFocus = () => {
    window.requestAnimationFrame(() => onRequestInputFocus?.());
  };

  const selectParameter = (example: string) => {
    onCommandChange(insertConditionScreenerParameter(value, example));
    setIsOpen(false);
    requestInputFocus();
  };

  const togglePreset = (presetId: TConditionScreenerPresetId) => {
    const nextPresetIds = toggleConditionScreenerPreset(selectedPresetIds, presetId);
    setSelectedPresetIds(nextPresetIds);
    onCommandChange(createConditionScreenerCommand(nextPresetIds));
    requestInputFocus();
  };

  const clearSelection = () => {
    setSelectedPresetIds([]);
    onCommandChange('');
    requestInputFocus();
  };

  return (
    <div className={styles['condition-screener-picker']} ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup='dialog'
        className={cx(styles['condition-screener-trigger'], selectedPresetIds.length > 0 && styles.active)}
        onClick={() => {
          setActiveTab('presets');
          setIsOpen((current) => !current);
        }}
        type='button'
      >
        <SlidersHorizontal size={14} strokeWidth={1.8} />
        <span>条件选股</span>
        {selectedPresetIds.length ? <em>{selectedPresetIds.length}</em> : null}
      </button>
      {isOpen ? (
        <section aria-label='条件选股配置' className={styles['condition-screener-panel']} role='dialog'>
          <header className={styles['condition-screener-header']}>
            <div>
              <strong>条件选股</strong>
              <span>输入 -- 可快速打开参数；点击示例会填入输入框</span>
            </div>
            <button
              onClick={
                activeTab === 'presets' && selectedPresetIds.length ? clearSelection : () => setIsOpen(false)
              }
              type='button'
            >
              <X size={13} />
              {activeTab === 'presets' && selectedPresetIds.length ? '清空' : '关闭'}
            </button>
          </header>
          <div className={styles['condition-screener-tabs']} role='tablist' aria-label='条件选股配置方式'>
            <button
              aria-selected={activeTab === 'presets'}
              className={cx(activeTab === 'presets' && styles.active)}
              onClick={() => setActiveTab('presets')}
              role='tab'
              type='button'
            >
              组合预设
            </button>
            <button
              aria-selected={activeTab === 'parameters'}
              className={cx(activeTab === 'parameters' && styles.active)}
              onClick={() => setActiveTab('parameters')}
              role='tab'
              type='button'
            >
              可选参数
            </button>
          </div>
          {activeTab === 'parameters' ? (
            <div className={styles['condition-screener-parameter-grid']} role='tabpanel'>
              {conditionScreenerParameters.map((parameter) => {
                const ParameterIcon = parameterIcons[parameter.id];
                return (
                  <button
                    aria-label={`插入参数：${parameter.name}，示例 ${parameter.example}`}
                    className={styles['condition-screener-parameter-card']}
                    key={parameter.id}
                    onClick={() => selectParameter(parameter.example)}
                    onPointerEnter={setConditionScreenerParticlePointer}
                    onPointerLeave={resetConditionScreenerParticlePointer}
                    onPointerMove={setConditionScreenerParticlePointer}
                    type='button'
                  >
                    {renderConditionScreenerParticles()}
                    <span className={styles['condition-screener-parameter-title']}>
                      <span aria-hidden='true' className={styles['condition-screener-parameter-icon']}>
                        <ParameterIcon size={16} strokeWidth={1.8} />
                      </span>
                      <strong>{parameter.name}</strong>
                    </span>
                    <span className={styles['condition-screener-parameter-description']}>
                      {parameter.description}
                    </span>
                    <code>{parameter.example}</code>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles['condition-screener-grid']} role='tabpanel'>
              {conditionScreenerPresets.map((preset) => {
                const isSelected = selectedPresetIds.includes(preset.id);
                const PresetIcon = presetIcons[preset.id];
                return (
                  <button
                    aria-pressed={isSelected}
                    className={cx(styles['condition-screener-card'], isSelected && styles.active)}
                    key={preset.id}
                    onClick={() => togglePreset(preset.id)}
                    onPointerEnter={setConditionScreenerParticlePointer}
                    onPointerLeave={resetConditionScreenerParticlePointer}
                    onPointerMove={setConditionScreenerParticlePointer}
                    type='button'
                  >
                    {renderConditionScreenerParticles()}
                    <span className={styles['condition-screener-card-title']}>
                      <span className={styles['condition-screener-card-heading']}>
                        <span aria-hidden='true' className={styles['condition-screener-preset-icon']}>
                          <PresetIcon size={16} strokeWidth={1.8} />
                        </span>
                        <strong>{preset.title}</strong>
                      </span>
                      {isSelected ? <Check aria-label='已选中' size={14} strokeWidth={2.2} /> : null}
                    </span>
                    <span className={styles['condition-screener-card-description']}>{preset.description}</span>
                    <span className={styles['condition-screener-criteria']}>
                      {preset.criteria.map((criterion) => (
                        <span key={criterion.key}>{criterion.label}</span>
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
