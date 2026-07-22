import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import gsap from 'gsap';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { AnalysisProgress } from './components/analysis-progress';
import { WhaleLogo } from './components/whale-logo';
import { ThinkingBanner, AnalysisThinkingBanner, ProcessedBanner } from './components/thinking-components';
import { formatMessageTime } from './components/message-utils';
import { createThinkingSteps, setBuiltInSlashItems, isGreeting } from './components/thinking-steps';
import { ResultCard } from './components/result-card';
import { renderCommandInText, renderMarkdownContent } from './components/markdown';
import type { BoardDetail, ChatMessage, StockDetail, StoreCategory, StoreItem } from '../../shared/types';
import { useAppStore } from '../../store/app-store';
import { track, trackButtonClick } from '../../shared/analytics';
import styles from './index.module.scss';
import cx from '../../shared/cx';

const builtInSlashItems = [
  {
    id: 'comprehensive-report',
    section: 'Commands',
    label: '综合投研报告',
    command: '/综合投研报告',
    description: '调用五个子 Agent，生成完整综合投资报告',
    argPlaceholder: '[输入股票代码或股票名称]',
  },
  {
    id: 'news-announcements',
    section: 'Commands',
    label: '新闻公告',
    command: '/新闻公告',
    description: '拉取指定个股最近的新闻和公告',
    argPlaceholder: '[输入股票代码或名称]',
  },
  {
    id: 'theme-attribution',
    section: 'Commands',
    label: '题材归因',
    command: '/题材归因',
    description: '今天哪些股票走强，主要是什么题材',
    argPlaceholder: '直接发送即可',
  },
  {
    id: 'daily-lhb',
    section: 'Commands',
    label: '全市场龙虎榜',
    command: '/全市场龙虎榜',
    description: '今天龙虎榜哪些票净买入最多',
    argPlaceholder: '直接发送即可',
  },
  {
    id: 'technical-agent',
    section: 'Sub Agents',
    label: '技术面分析agent',
    command: '/技术面分析',
    description: '仅调用技术面Agent 分析股票',
    argPlaceholder: '[请输入股票代码或名称]',
  },
  {
    id: 'fundamental-agent',
    section: 'Sub Agents',
    label: '基本面分析agent',
    command: '/基本面分析',
    description: '仅调用基本面Agent 分析股票',
    argPlaceholder: '[请输入股票代码或名称]',
  },
  {
    id: 'capital-agent',
    section: 'Sub Agents',
    label: '资金面分析agent',
    command: '/资金面分析',
    description: '仅调用资金面Agent 分析股票',
    argPlaceholder: '[请输入股票代码或名称]',
  },
  {
    id: 'sentiment-agent',
    section: 'Sub Agents',
    label: '情绪面分析agent',
    command: '/情绪面分析',
    description: '仅调用情绪面Agent 分析股票',
    argPlaceholder: '[请输入股票代码或名称]',
  },
  {
    id: 'chip-agent',
    section: 'Sub Agents',
    label: '筹码分析agent',
    command: '/筹码分析',
    description: '分析个股当前的筹码结构、主力控盘情况以及未来走势',
    argPlaceholder: '[输入股票代码或名称]',
  },
] satisfies SlashItem[];

type SlashItem = {
  id: string;
  section: string;
  label: string;
  command: string;
  description: string;
  argPlaceholder: string;
};
const storeTabs: Array<{ id: StoreCategory; label: string }> = [
  { id: 'commands', label: 'Commands' },
  { id: 'skills', label: 'Skills' },
  { id: 'sub-agents', label: '子代理' },
];

setBuiltInSlashItems(builtInSlashItems);

export function ChatView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [storeOpen, setStoreOpen] = useState(false);
  const activeRequestRef = useRef<string>();
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [installedStoreItems, setInstalledStoreItems] = useState<string[]>([]);
  const messages = useAppStore((state) => state.messages);
  const [now, setNow] = useState(Date.now());
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const isSending = useAppStore((state) => state.isSending);
  const addMessage = useAppStore((state) => state.addMessage);
  const replaceLastAssistant = useAppStore((state) => state.replaceLastAssistant);
  const finalizeLastAssistant = useAppStore((state) => state.finalizeLastAssistant);
  const appendToLastAssistant = useAppStore((state) => state.appendToLastAssistant);
  const applyRunEventToLastAssistant = useAppStore((state) => state.applyRunEventToLastAssistant);
  const setSending = useAppStore((state) => state.setSending);
  const rememberStockKline = useAppStore((state) => state.rememberStockKline);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const setSelectedBoard = useAppStore((state) => state.setSelectedBoard);
  const selectedBoard = useAppStore((state) => state.selectedBoard);
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openBoardPanel = useAppStore((state) => state.openBoardPanel);
  const slashItems = useMemo(
    () => [
      ...builtInSlashItems,
      ...storeItems.filter((item) => installedStoreItems.includes(item.id) && item.command).map(storeItemToSlashItem),
    ],
    [installedStoreItems, storeItems],
  );

  useEffect(() => {
    const api = getStocksenseApi();
    void Promise.all([api.listStoreItems(), api.listInstalledStoreItems()])
      .then(([items, installed]) => {
        setStoreItems(items);
        setInstalledStoreItems(installed);
      })
      .catch(console.error);
  }, []);

  const installStoreCommand = async (id: string) => {
    trackButtonClick('install_store_item', { item_id: id });
    const installed = await getStocksenseApi().installStoreItem(id);
    setInstalledStoreItems(installed);
    antdMessage.success('安装成功');
  };

  const uninstallStoreCommand = async (id: string) => {
    trackButtonClick('uninstall_store_item', { item_id: id });
    const installed = await getStocksenseApi().uninstallStoreItem(id);
    setInstalledStoreItems(installed);
    antdMessage.success('已卸载');
  };

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-msg]', { opacity: 0, y: 12, stagger: 0.06, duration: 0.3, ease: 'power2.out' });
      gsap.from('[data-card]', { opacity: 0, y: 8, scale: 0.98, stagger: 0.05, duration: 0.3, delay: 0.15 });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  useLayoutEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const openStockDetail = async (stock: Pick<StockDetail, 'code' | 'name'>) => {
    trackButtonClick('open_stock_detail', { code: stock.code, name: stock.name });
    const kline = findMessageKline(messages, stock.code);
    openRightPanel();
    setSelectedStock({ ...stock, kline } as StockDetail);
    try {
      const detail = await getStocksenseApi().getStockDetail(stock.code);
      setSelectedStock({ ...detail, kline: kline?.length ? kline : detail.kline });
    } catch {
      setSelectedStock({ ...stock, kline } as StockDetail);
    }
  };

  const openBoardDetail = async (board: Pick<BoardDetail, 'code' | 'name'>) => {
    trackButtonClick('open_board_detail', { code: board.code, name: board.name });
    openBoardPanel();
    if (selectedBoard?.code !== board.code) setSelectedBoard(board as BoardDetail);
    try {
      setSelectedBoard(await getStocksenseApi().getBoardDetail(board.code, false, board.name));
    } catch {
      if (selectedBoard?.code !== board.code) setSelectedBoard(board as BoardDetail);
    }
  };

  const slashOpen = input.startsWith('/') && !input.includes(' ');
  const activeCommand = slashItems.find((item) => input.startsWith(`${item.command} `));
  const commandArg = activeCommand ? input.slice(activeCommand.command.length + 1) : '';
  const selectSlashItem = (item = slashItems[selectedSlashIndex]) => {
    if (item) {
      trackButtonClick('select_slash_command', { command: item.command });
      setInput(`${item.command} `);
    }
  };

  const stopThinking = () => {
    trackButtonClick('stop_thinking');
    activeRequestRef.current = undefined;
    replaceLastAssistant({
      id: `assistant-stopped-${Date.now()}`,
      role: 'assistant',
      content: '已暂停思考。',
      createdAt: new Date().toISOString(),
    });
    setSending(false);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || isSending) return;
    setInput('');
    const command = text.startsWith('/') ? text.split(/\s+/, 1)[0] : undefined;
    trackButtonClick('send_chat', { command, message_length: text.length, has_stock_code: /\d{6}/.test(text) });
    track('stock_query_entered', {
      query_kind: /^\d{6}$/.test(text) ? 'code' : command ? 'command' : 'text',
      command,
      has_stock_code: /\d{6}/.test(text),
    });
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    addMessage(userMessage);
    if (isGreeting(text)) {
      const assistantMessage: ChatMessage = {
        id: `assistant-greeting-${Date.now()}`,
        role: 'assistant',
        content:
          '你好！我是 StockBuddy。本条是本地欢迎语，不会调用大模型厂商。若要测试模型配置，请在系统设置中保存并完成模型连接校验；也可以直接输入股票代码或投研命令开始分析。',
        createdAt: new Date().toISOString(),
      };
      addMessage(assistantMessage);
      const api = getStocksenseApi();
      await api.saveMessage(activeConversationId ?? 'conv-1', userMessage);
      await api.saveMessage(activeConversationId ?? 'conv-1', assistantMessage);
      api.listConversations().then(useAppStore.getState().setConversations).catch(console.error);
      return;
    }

    setSending(true);
    addMessage({
      id: `assistant-thinking-${Date.now()}`,
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      thinking: { startedAt: new Date().toISOString(), steps: createThinkingSteps(text) },
    });
    const requestId = `chat-${Date.now()}`;
    const api = getStocksenseApi();
    try {
      activeRequestRef.current = requestId;
      await api.testModelConfig(await api.getConfig());
    } catch (error) {
      replaceLastAssistant({
        id: `assistant-error-${Date.now()}`,
        role: 'assistant',
        content: error instanceof Error ? error.message : '模型配置校验失败，请检查 API 配置。',
        createdAt: new Date().toISOString(),
      });
      activeRequestRef.current = undefined;
      setSending(false);
      return;
    }
    let offToken: (() => void) | undefined;
    try {
      offToken = api.onChatToken?.((event) => {
        if (event.requestId !== requestId || activeRequestRef.current !== requestId) return;
        if (event.runEvent) applyRunEventToLastAssistant(event.runEvent);
        if (event.token) appendToLastAssistant(event.token);
      });
      const response = await api.sendChat({
        conversationId: activeConversationId ?? 'conv-1',
        message: text,
        requestId,
      });
      if (activeRequestRef.current !== requestId) return;
      finalizeLastAssistant(response.message);
      const stock = response.events.find((event) => event.stock)?.stock;
      if (stock) {
        const resultStock = response.message.result?.stocks?.find((item) => item.code === stock.code);
        const chartData =
          response.message.result?.chart?.type === 'kline' ? response.message.result.chart.data : undefined;
        rememberStockKline(stock.code, chartData);
        openRightPanel();
        setSelectedStock({ ...stock, ...resultStock, kline: chartData });
      }
      api.listConversations().then(useAppStore.getState().setConversations).catch(console.error);
    } catch (error) {
      if (activeRequestRef.current !== requestId) return;
      replaceLastAssistant({
        id: `assistant-error-${Date.now()}`,
        role: 'assistant',
        content: error instanceof Error ? error.message : '请求失败，请稍后重试。',
        createdAt: new Date().toISOString(),
      });
    } finally {
      offToken?.();
      if (activeRequestRef.current === requestId) activeRequestRef.current = undefined;
      setSending(false);
    }
  };

  useEffect(() => {
    const handleReport = (event: Event) => {
      const code = (event as CustomEvent<string>).detail;
      if (code) void send(`/综合投研报告 ${code}`);
    };
    window.addEventListener('stocksense:send-report', handleReport);
    const pending = (window as typeof window & { __stocksensePendingReport?: string }).__stocksensePendingReport;
    if (pending) {
      delete (window as typeof window & { __stocksensePendingReport?: string }).__stocksensePendingReport;
      void send(`/综合投研报告 ${pending}`);
    }
    return () => window.removeEventListener('stocksense:send-report', handleReport);
  });

  return (
    <div className={styles['chat-wrap']} ref={rootRef}>
      <div className={styles['chat-messages']} ref={listRef}>
        {messages.length === 0 ? (
          <QuickEntry onSubmit={send} slashItems={slashItems} />
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              now={now}
              slashItems={slashItems}
              onStockClick={openStockDetail}
              onBoardClick={openBoardDetail}
            />
          ))
        )}
      </div>
      {messages.length ? (
        <div className={styles['chat-input']}>
          {slashOpen ? (
            <SlashCommandMenu slashItems={slashItems} selectedIndex={selectedSlashIndex} onSelect={selectSlashItem} />
          ) : null}
          <div className={styles['composer-shell']}>
            <div className={styles['input-row']}>
              {activeCommand ? (
                <div className={styles['command-input-wrap']}>
                  <button
                    className='command-chip'
                    title={activeCommand.description}
                    onClick={() => setInput('/')}
                    type='button'
                  >
                    <span className='slash-icon'>/</span>
                    {activeCommand.command}
                  </button>
                  <input
                    value={commandArg}
                    onChange={(event) => setInput(`${activeCommand.command} ${event.target.value}`)}
                    onKeyDown={(event) => {
                      if ((event.key === 'Backspace' || event.key === 'Delete') && !commandArg) {
                        event.preventDefault();
                        setInput('');
                        return;
                      }
                      if (event.key === 'Enter') void send();
                    }}
                    placeholder={activeCommand.argPlaceholder}
                    autoFocus
                  />
                </div>
              ) : (
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (slashOpen && event.key === 'Enter') {
                      event.preventDefault();
                      selectSlashItem();
                      return;
                    }
                    if (slashOpen && event.key === 'ArrowDown') {
                      event.preventDefault();
                      setSelectedSlashIndex((value) => Math.min(value + 1, slashItems.length - 1));
                      return;
                    }
                    if (slashOpen && event.key === 'ArrowUp') {
                      event.preventDefault();
                      setSelectedSlashIndex((value) => Math.max(value - 1, 0));
                      return;
                    }
                    if (event.key === 'Enter') void send();
                  }}
                  placeholder='输入 / 打开命令，或直接输入A股股票名称/代码'
                />
              )}
            </div>
            <div className={styles['composer-toolbar']}>
              <AppStoreBar onOpen={() => setStoreOpen(true)} />
              <div className={styles['composer-actions']}>
                <span className={styles['model-pill']}>StockBuddy</span>
                <button
                  className={cx(styles['send-btn'], isSending && styles.sending)}
                  onClick={isSending ? stopThinking : () => void send()}
                  type='button'
                  aria-label={isSending ? '暂停思考' : '发送'}
                  title={isSending ? '暂停思考' : '发送'}
                >
                  {isSending ? <span className={styles['pause-icon']} /> : '➤'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {storeOpen ? (
        <AppStoreModal
          items={storeItems}
          installed={installedStoreItems}
          onInstall={installStoreCommand}
          onUninstall={uninstallStoreCommand}
          onClose={() => setStoreOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AppStoreBar({ onOpen }: { onOpen(): void }) {
  return (
    <div className={styles['store-bar']}>
      <button
        onClick={() => {
          trackButtonClick('open_store');
          onOpen();
        }}
        type='button'
      >
        ＋
      </button>
      <span>插件</span>
    </div>
  );
}

function AppStoreModal({
  items,
  installed,
  onInstall,
  onUninstall,
  onClose,
}: {
  items: StoreItem[];
  installed: string[];
  onInstall(id: string): Promise<void>;
  onUninstall(id: string): Promise<void>;
  onClose(): void;
}) {
  const [activeTab, setActiveTab] = useState<StoreCategory>('commands');
  const tabItems = items.filter((item) => item.category === activeTab);
  return (
    <div className={styles['store-overlay']} onClick={onClose}>
      <div className={styles['store-modal']} onClick={(event) => event.stopPropagation()}>
        <div className={styles['store-header']}>
          <h2>应用商店</h2>
          <button onClick={onClose} type='button'>
            ✕
          </button>
        </div>
        <div className={styles['store-tabs']}>
          {storeTabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? styles.active : ''}
              onClick={() => setActiveTab(tab.id)}
              type='button'
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles['store-list']}>
          {tabItems.length ? (
            tabItems.map((item) => {
              const isInstalled = installed.includes(item.id);
              return (
                <div className={styles['store-item']} key={item.id}>
                  <div>
                    <div className={styles['store-item-title']}>{item.name}</div>
                    <div className={styles['store-item-desc']}>{item.description}</div>
                  </div>
                  <button
                    className={isInstalled ? styles['store-uninstall'] : ''}
                    onClick={() => void (isInstalled ? onUninstall(item.id) : onInstall(item.id))}
                    type='button'
                  >
                    {isInstalled ? '卸载' : '安装'}
                  </button>
                </div>
              );
            })
          ) : (
            <div className={styles['store-empty']}>暂无可安装内容</div>
          )}
        </div>
      </div>
    </div>
  );
}

function storeItemToSlashItem(item: StoreItem): SlashItem {
  return {
    id: item.id,
    section: item.section,
    label: item.name,
    command: item.command!,
    description: item.description,
    argPlaceholder: item.argPlaceholder ?? '[请输入参数]',
  };
}

function SlashCommandMenu({
  slashItems,
  selectedIndex,
  onSelect,
}: {
  slashItems: SlashItem[];
  selectedIndex: number;
  onSelect(item?: SlashItem): void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  const sections = Array.from(new Set(slashItems.map((item) => item.section)));

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  return (
    <div className={styles['slash-menu']}>
      {sections.map((section) => (
        <div key={section}>
          <div className={styles['slash-section']}>{section}</div>
          {slashItems.map((item, index) =>
            item.section === section ? (
              <button
                ref={index === selectedIndex ? activeRef : undefined}
                className={cx(styles['slash-item'], index === selectedIndex && styles.active)}
                key={item.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(item);
                }}
                type='button'
              >
                <span className='slash-icon'>/</span>
                <span className={styles['slash-copy']}>
                  <span className={styles['slash-label']}>{item.label}</span>
                  <span className={styles['slash-desc']}>{item.description}</span>
                </span>
                <span className={styles['slash-meta']}>
                  <span>{item.section === 'Commands' ? '命令' : '全局'}</span>
                  <code>{item.command}</code>
                </span>
              </button>
            ) : null,
          )}
        </div>
      ))}
    </div>
  );
}

function QuickEntry({ onSubmit, slashItems }: { onSubmit(text: string): void; slashItems: SlashItem[] }) {
  const [value, setValue] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const examples = ['五粮液', '贵州茅台', '宁德时代', '招商银行', '比亚迪'];
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
      <div className={styles['qe-hints']}>
        {examples.map((example) => (
          <button key={example} className={styles['qe-hint']} onClick={() => setValue(example)} type='button'>
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  now,
  slashItems,
  onStockClick,
  onBoardClick,
}: {
  message: ChatMessage;
  now: number;
  slashItems: SlashItem[];
  onStockClick(stock: StockDetail): void;
  onBoardClick(board: Pick<BoardDetail, 'code' | 'name'>): void;
}) {
  const copySelectedMessage = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (message.role !== 'user') return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || !selection?.anchorNode || !event.currentTarget.contains(selection.anchorNode)) return;
    await navigator.clipboard.writeText(text);
    antdMessage.success('复制成功');
  };

  const openLinkedStock = (event: React.MouseEvent<HTMLDivElement>) => {
    const boardLink = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-board-code]');
    if (boardLink) {
      event.preventDefault();
      onBoardClick({
        code: boardLink.dataset.boardCode!,
        name: boardLink.dataset.boardName ?? boardLink.textContent ?? boardLink.dataset.boardCode!,
      });
      return;
    }
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-stock-code]');
    if (!link) return;
    event.preventDefault();
    onStockClick({
      code: link.dataset.stockCode!,
      name: link.dataset.stockName ?? link.textContent ?? link.dataset.stockCode!,
    });
  };

  return (
    <div
      className={cx(
        styles.msg,
        'msg',
        message.role === 'user' ? styles.user : styles.agent,
        message.role === 'user' ? 'user' : 'agent',
      )}
      data-msg
    >
      <div className={styles['msg-avatar']} data-avatar>
        {message.role === 'user' ? (
          '我'
        ) : (
          <span className={cx(styles.whale, message.thinking && styles.busy)} aria-label='AI 鲸鱼头像' role='img'>
            <WhaleLogo />
            <span className={styles['whale-splash']}>
              <span />
              <span />
              <span />
              <span />
              <span />
            </span>
          </span>
        )}
      </div>
      <div className={styles['msg-body']} data-msgbody>
        {message.thinking ? (
          message.runEvents?.length ? <AnalysisThinkingBanner /> : <ThinkingBanner />
        ) : message.processedSeconds ? (
          <ProcessedBanner seconds={message.processedSeconds} />
        ) : null}
        {message.runEvents?.length || message.thinking ? (
          <AnalysisProgress events={message.runEvents ?? []} toolCalls={message.toolCalls} />
        ) : null}
        {message.content.trim() ? (
          <div
            className='msg-text'
            onClick={openLinkedStock}
            onMouseUp={copySelectedMessage}
            dangerouslySetInnerHTML={{
              __html: renderMarkdownContent(renderCommandInText(message.content, slashItems), {
                disclaimer:
                  message.role === 'assistant' &&
                  Boolean(
                    message.result || message.evidence?.length || message.findings?.length || message.toolCalls?.length,
                  ),
              }),
            }}
          />
        ) : null}
        {message.result ? (
          <ResultCard result={message.result} onStockClick={onStockClick} onBoardClick={onBoardClick} />
        ) : null}
        <div className={styles['msg-time']}>{formatMessageTime(message.createdAt, now)}</div>
      </div>
    </div>
  );
}

function findMessageKline(messages: ChatMessage[], code: string) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const result = messages[i].result;
    if (result?.chart?.type === 'kline' && result.stocks?.some((stock) => stock.code === code))
      return result.chart.data;
  }
  return undefined;
}
