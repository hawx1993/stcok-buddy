import { RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { IHotStockHint } from './hot-stock-hints';
import { SlashCommandMenu } from './slash-command-menu';
import { useHotStockHints } from './use-hot-stock-hints';
import { useRotatingQuickEntryPrompt } from './use-rotating-quick-entry-prompt';
import { isConditionScreenerCommand } from '../../../shared/condition-screener';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import type { MarketSearchResult } from '../../../shared/types';
import { ConditionScreenerPicker } from './condition-screener-picker';
import { QuickEntrySearchSuggestions } from './quick-entry-search-suggestions';
import { QuickEntryToolbar } from './quick-entry-toolbar';
import { WhaleLogo } from './whale-logo';
import styles from '../index.module.scss';

export type TSlashItem = {
  id: string;
  section: string;
  label: string;
  command: string;
  description: string;
  argPlaceholder: string;
};

export const QUICK_ENTRY_TREND_PATH = 'M60 150 Q 95 110, 130 120 T 200 90 T 270 100 T 340 70';
export const QUICK_ENTRY_WHALE_SIZE = { width: 30, height: 25 } as const;
export const QUICK_ENTRY_WHALE_MOTION = {
  durationSeconds: 5.29,
  sprintStartPoint: 0.707,
  sprintStartTime: 0.828,
} as const;

export function getQuickEntrySearchKeyword(input: string) {
  const trimmed = input.trim();
  if (isConditionScreenerCommand(input)) return '';
  if (!trimmed.startsWith('/')) return trimmed;
  const commandWithArg = /^\/\S+\s+(.+)$/.exec(input);
  return commandWithArg?.[1]?.trim() ?? '';
}

export function getQuickEntryValueAfterSearchSelection(input: string, selectedValue: string) {
  const command = /^(\/\S+)\s+/.exec(input)?.[1];
  return command ? `${command} ${selectedValue}` : selectedValue;
}

export function QuickEntry({
  activeModelName,
  conversationId,
  onOpenStore,
  onOpenModelSettings,
  onSubmit,
  slashItems,
}: {
  activeModelName: string;
  conversationId?: string;
  onOpenStore(): void;
  onOpenModelSettings(): void;
  onSubmit(text: string): void;
  slashItems: TSlashItem[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionAnchorRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSearchValue, setSelectedSearchValue] = useState('');
  const [suggestions, setSuggestions] = useState<MarketSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string>();
  const { hints, loading, error, isPreviousTradeDay, tradeDate, refresh } = useHotStockHints(conversationId);
  const quickEntryPrompt = useRotatingQuickEntryPrompt();
  const slashOpen = value.startsWith('/') && !value.includes(' ');
  const activeCommand = slashItems.find((item) => value.startsWith(`${item.command} `));
  const commandArg = activeCommand ? value.slice(activeCommand.command.length + 1) : '';
  const searchKeyword = getQuickEntrySearchKeyword(value);
  const hasSearchInput = Boolean(searchKeyword) && searchKeyword !== selectedSearchValue;
  const hasConditionScreenerInput = isConditionScreenerCommand(value);
  const canShowSuggestions = !slashOpen && hasSearchInput && !hasConditionScreenerInput;

  const selectSlashItem = (item = slashItems[selectedSlashIndex]) => {
    if (!item) return;
    setValue(`${item.command} `);
    setSelectedSearchValue('');
  };

  const selectSearchResult = (item: MarketSearchResult) => {
    const nextSearchValue = item.kind === 'board' ? item.name : item.code;
    setValue(getQuickEntryValueAfterSearchSelection(value, nextSearchValue));
    setSelectedSearchValue(nextSearchValue);
    setSuggestions([]);
    setDebouncedSearch('');
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const submit = () => {
    const text = value.trim();
    if (text) onSubmit(text);
  };

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(slashOpen || !hasSearchInput || hasConditionScreenerInput ? '' : searchKeyword),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [hasConditionScreenerInput, hasSearchInput, searchKeyword, slashOpen]);

  useEffect(() => {
    let alive = true;
    if (!debouncedSearch) {
      setSuggestions([]);
      setSearchError(undefined);
      setSearching(false);
      return () => {
        alive = false;
      };
    }

    setSearching(true);
    setSearchError(undefined);
    getStocksenseApi()
      .searchStocks(debouncedSearch)
      .then((items) => {
        if (alive) setSuggestions(items);
      })
      .catch((requestError: unknown) => {
        if (!alive) return;
        setSuggestions([]);
        setSearchError(requestError instanceof Error ? requestError.message : '搜索暂不可用');
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [debouncedSearch]);

  return (
    <div className={styles['quick-entry']} data-quickentry>
      <div className={styles['qe-hero']} aria-hidden='true'>
        <svg viewBox='0 0 420 200' xmlns='http://www.w3.org/2000/svg'>
          <rect width='420' height='200' fill='var(--bg)' rx='8' />
          <g stroke='var(--surface)' strokeWidth='0.5' opacity='0.75'>
            <line x1='40' y1='30' x2='380' y2='30' />
            <line x1='40' y1='60' x2='380' y2='60' />
            <line x1='40' y1='90' x2='380' y2='90' />
            <line x1='40' y1='120' x2='380' y2='120' />
            <line x1='40' y1='150' x2='380' y2='150' />
            <line x1='108' y1='30' x2='108' y2='150' />
            <line x1='176' y1='30' x2='176' y2='150' />
            <line x1='244' y1='30' x2='244' y2='150' />
            <line x1='312' y1='30' x2='312' y2='150' />
          </g>
          <path
            className={styles['qe-wave']}
            d={`${QUICK_ENTRY_TREND_PATH} L 360 150 Z`}
            fill='rgba(59,130,246,0.08)'
          />
          <path
            className={styles['qe-trend']}
            d={QUICK_ENTRY_TREND_PATH}
            stroke='var(--accent)'
            strokeWidth='2'
            fill='none'
            strokeLinecap='round'
          />
          {[80, 140, 200, 260, 320].map((x, index) => (
            <g key={x} transform={`translate(${x},${index % 2 ? 112 : 82})`}>
              <g className={styles['qe-candle']} style={{ animationDelay: `${index * -0.35}s` }}>
                <line
                  x1='6'
                  y1='0'
                  x2='6'
                  y2='40'
                  stroke={index % 2 ? 'var(--danger)' : 'var(--success)'}
                  strokeWidth='1.5'
                />
                <rect
                  x='1'
                  y='10'
                  width='10'
                  height='20'
                  fill={index % 2 ? 'var(--danger)' : 'var(--success)'}
                  rx='1'
                />
              </g>
            </g>
          ))}
          <line x1='40' y1='150' x2='380' y2='150' stroke='var(--border)' strokeWidth='1' />
          <g className={styles['qe-whale-sprint']}>
            <g transform='translate(-15 -30)'>
              <WhaleLogo width={QUICK_ENTRY_WHALE_SIZE.width} height={QUICK_ENTRY_WHALE_SIZE.height} />
            </g>
            <animateMotion
              calcMode='linear'
              dur={`${QUICK_ENTRY_WHALE_MOTION.durationSeconds}s`}
              keyPoints={`0;${QUICK_ENTRY_WHALE_MOTION.sprintStartPoint};1`}
              keyTimes={`0;${QUICK_ENTRY_WHALE_MOTION.sprintStartTime};1`}
              path={QUICK_ENTRY_TREND_PATH}
              repeatCount='indefinite'
              rotate='auto'
            />
            <animate
              attributeName='opacity'
              dur={`${QUICK_ENTRY_WHALE_MOTION.durationSeconds}s`}
              keyTimes='0;0.04;0.92;1'
              repeatCount='indefinite'
              values='0;1;1;0'
            />
          </g>
        </svg>
      </div>
      <div className={styles['qe-title']}>开始新的投研分析</div>
      <div className={styles['qe-sub']}>{quickEntryPrompt}</div>
      <div className={styles['qe-entry-controls']}>
        <div className={styles['composer-stack']}>
          {slashOpen ? (
            <SlashCommandMenu slashItems={slashItems} selectedIndex={selectedSlashIndex} onSelect={selectSlashItem} />
          ) : null}
          <div className={styles['composer-shell']}>
            <ConditionScreenerPicker
              value={value}
              onCommandChange={(command) => {
                setValue(command);
                setSelectedSearchValue('');
                setSuggestions([]);
                setDebouncedSearch('');
              }}
              onRequestInputFocus={() => inputRef.current?.focus()}
            />
            <div className={styles['qe-composer-input']}>
              <div ref={suggestionAnchorRef} className={styles['input-row']}>
                {activeCommand ? (
                  <div className={styles['command-input-wrap']}>
                    <button
                      className='command-chip'
                      title={activeCommand.description}
                      onClick={() => setValue('/')}
                      type='button'
                    >
                      <span className='slash-icon'>/</span>
                      {activeCommand.command}
                    </button>
                    <input
                      ref={inputRef}
                      value={commandArg}
                      onChange={(event) => {
                        setValue(`${activeCommand.command} ${event.target.value}`);
                        setSelectedSearchValue('');
                      }}
                      onKeyDown={(event) => {
                        if ((event.key === 'Backspace' || event.key === 'Delete') && !commandArg) {
                          event.preventDefault();
                          setValue('');
                          return;
                        }
                        if (event.key === 'Enter') submit();
                      }}
                      placeholder={activeCommand.argPlaceholder}
                      autoFocus
                    />
                  </div>
                ) : (
                  <input
                    ref={inputRef}
                    value={value}
                    onChange={(event) => {
                      setValue(event.target.value);
                      setSelectedSearchValue('');
                    }}
                    onKeyDown={(event) => {
                      if (slashOpen && event.key === 'Enter') {
                        event.preventDefault();
                        selectSlashItem();
                        return;
                      }
                      if (slashOpen && event.key === 'ArrowDown') {
                        event.preventDefault();
                        setSelectedSlashIndex((current) => Math.min(current + 1, slashItems.length - 1));
                        return;
                      }
                      if (slashOpen && event.key === 'ArrowUp') {
                        event.preventDefault();
                        setSelectedSlashIndex((current) => Math.max(current - 1, 0));
                        return;
                      }
                      if (event.key === 'Escape') {
                        setSuggestions([]);
                        setSearchError(undefined);
                        return;
                      }
                      if (event.key === 'Enter') submit();
                    }}
                    placeholder='输入 / 打开命令，或直接输入A股股票名称/代码'
                    autoFocus
                  />
                )}
              </div>
              <QuickEntrySearchSuggestions
                anchorRef={suggestionAnchorRef}
                debouncedSearch={debouncedSearch}
                error={searchError}
                isOpen={canShowSuggestions}
                onSelect={selectSearchResult}
                searching={searching}
                suggestions={suggestions}
              />
            </div>
            <QuickEntryToolbar
              activeModelName={activeModelName}
              onOpenStore={onOpenStore}
              onOpenModelSettings={onOpenModelSettings}
              onSubmit={submit}
            />
          </div>
        </div>
      </div>
      <HintList
        hints={hints}
        loading={loading}
        error={error}
        isPreviousTradeDay={isPreviousTradeDay}
        tradeDate={tradeDate}
        onRefresh={refresh}
        onSelect={(hint) => {
          setValue(hint.code);
          setSelectedSearchValue(hint.code);
          window.requestAnimationFrame(() => inputRef.current?.focus());
        }}
      />
    </div>
  );
}

function HintList({
  hints,
  loading,
  error,
  isPreviousTradeDay,
  tradeDate,
  onRefresh,
  onSelect,
}: {
  hints: IHotStockHint[];
  loading: boolean;
  error?: string;
  isPreviousTradeDay: boolean;
  tradeDate?: string;
  onRefresh(): void;
  onSelect(hint: IHotStockHint): void;
}) {
  if (loading) {
    return (
      <div className={styles['qe-hints']}>
        <span className={styles['qe-hints-status']}>正在加载今日热点…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className={styles['qe-hints']}>
        <span className={styles['qe-hints-status']}>热点数据暂不可用</span>
      </div>
    );
  }
  if (!hints.length) {
    return (
      <div className={styles['qe-hints']}>
        <span className={styles['qe-hints-status']}>
          {isPreviousTradeDay ? `上一交易日暂无热点数据（${tradeDate ?? '--'}）` : '今日暂无热点数据'}
        </span>
      </div>
    );
  }
  return (
    <div className={styles['qe-hints']}>
      <span className={styles['qe-hints-status']}>
        {isPreviousTradeDay && tradeDate ? `上一交易日热点（${tradeDate}）` : '今日热点'}
      </span>
      {hints.map((hint) => (
        <button key={hint.code} className={styles['qe-hint']} onClick={() => onSelect(hint)} type='button'>
          {hint.name}（{hint.code}）{hint.label ? ` · ${hint.label}` : ''}
        </button>
      ))}
      <button className={styles['qe-hints-refresh']} onClick={onRefresh} type='button'>
        <RefreshCw size={12} />
        换一组
      </button>
    </div>
  );
}
