import { useState } from 'react';
import type { IHotStockHint } from './hot-stock-hints';
import { SlashCommandMenu } from './slash-command-menu';
import { useHotStockHints } from './use-hot-stock-hints';
import styles from '../index.module.scss';

export type TSlashItem = {
  id: string;
  section: string;
  label: string;
  command: string;
  description: string;
  argPlaceholder: string;
};

export function QuickEntry({
  conversationId,
  onSubmit,
  slashItems,
}: {
  conversationId?: string;
  onSubmit(text: string): void;
  slashItems: TSlashItem[];
}) {
  const [value, setValue] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const { hints, loading, refresh } = useHotStockHints(conversationId);
  const slashOpen = value.startsWith('/') && !value.includes(' ');
  const selectSlashItem = (item = slashItems[selectedSlashIndex]) => {
    if (item) setValue(`${item.command} `);
  };
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
            d='M60 150 Q 95 110, 130 120 T 200 90 T 270 100 T 340 70 L 360 150 Z'
            fill='rgba(59,130,246,0.08)'
          />
          <path
            className={styles['qe-trend']}
            d='M60 150 Q 95 110, 130 120 T 200 90 T 270 100 T 340 70'
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
        </svg>
      </div>
      <div className={styles['qe-title']}>开始新的投研分析</div>
      <div className={styles['qe-sub']}>输入A股股票名称或代码，AI 将为你深度解读</div>
      <div className={styles['qe-search-box']}>
        {slashOpen ? (
          <SlashCommandMenu slashItems={slashItems} selectedIndex={selectedSlashIndex} onSelect={selectSlashItem} />
        ) : null}
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
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
            if (event.key === 'Enter') onSubmit(value);
          }}
          placeholder='例如：/综合投研报告 中公教育、000858……'
          autoFocus
        />
        <button onClick={() => onSubmit(value)} type='button'>
          开始分析
        </button>
      </div>
      <HintList hints={hints} loading={loading} onRefresh={refresh} onSelect={(hint) => setValue(hint.code)} />
    </div>
  );
}

function HintList({
  hints,
  loading,
  onRefresh,
  onSelect,
}: {
  hints: IHotStockHint[];
  loading: boolean;
  onRefresh(): void;
  onSelect(hint: IHotStockHint): void;
}) {
  if (loading)
    return (
      <div className={styles['qe-hints']}>
        <span className={styles['qe-hints-status']}>正在获取真实热点推荐…</span>
      </div>
    );
  if (!hints.length)
    return (
      <div className={styles['qe-hints']}>
        <span className={styles['qe-hints-status']}>暂无真实热点推荐</span>
      </div>
    );
  return (
    <div className={styles['qe-hints']}>
      {hints.map((hint) => (
        <button key={hint.code} className={styles['qe-hint']} onClick={() => onSelect(hint)} type='button'>
          {hint.name}（{hint.code}）{hint.label ? ` · ${hint.label}` : ''}
        </button>
      ))}
      <button className={styles['qe-hints-refresh']} onClick={onRefresh} type='button'>
        换一组
      </button>
    </div>
  );
}
