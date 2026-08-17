import { Check, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  conditionScreenerPresets,
  createConditionScreenerCommand,
  toggleConditionScreenerPreset,
  type TConditionScreenerPresetId,
} from '../../../shared/condition-screener';
import cx from '../../../shared/cx';
import styles from '../index.module.scss';

interface IConditionScreenerPickerProps {
  onCommandChange(command: string): void;
}

export function ConditionScreenerPicker({ onCommandChange }: IConditionScreenerPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPresetIds, setSelectedPresetIds] = useState<TConditionScreenerPresetId[]>([]);

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

  const togglePreset = (presetId: TConditionScreenerPresetId) => {
    const nextPresetIds = toggleConditionScreenerPreset(selectedPresetIds, presetId);
    setSelectedPresetIds(nextPresetIds);
    onCommandChange(createConditionScreenerCommand(nextPresetIds));
  };

  const clearSelection = () => {
    setSelectedPresetIds([]);
    onCommandChange('');
  };

  return (
    <div className={styles['condition-screener-picker']} ref={rootRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup='dialog'
        className={cx(styles['condition-screener-trigger'], selectedPresetIds.length > 0 && styles.active)}
        onClick={() => setIsOpen((current) => !current)}
        type='button'
      >
        <SlidersHorizontal size={14} strokeWidth={1.8} />
        <span>条件选股</span>
        {selectedPresetIds.length ? <em>{selectedPresetIds.length}</em> : null}
      </button>
      {isOpen ? (
        <section aria-label='条件选股预设' className={styles['condition-screener-panel']} role='dialog'>
          <header className={styles['condition-screener-header']}>
            <div>
              <strong>条件选股</strong>
              <span>可组合预设；同一参数以后选条件为准</span>
            </div>
            <button disabled={!selectedPresetIds.length} onClick={clearSelection} type='button'>
              <X size={13} />
              清空
            </button>
          </header>
          <div className={styles['condition-screener-grid']}>
            {conditionScreenerPresets.map((preset) => {
              const isSelected = selectedPresetIds.includes(preset.id);
              return (
                <button
                  aria-pressed={isSelected}
                  className={cx(styles['condition-screener-card'], isSelected && styles.active)}
                  key={preset.id}
                  onClick={() => togglePreset(preset.id)}
                  type='button'
                >
                  <span className={styles['condition-screener-card-title']}>
                    <strong>{preset.title}</strong>
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
        </section>
      ) : null}
    </div>
  );
}
