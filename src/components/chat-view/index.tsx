import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import gsap from 'gsap';
import { marked } from 'marked';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { KlineModal, StockKlineChart } from '../kline-chart';
import type { AgentResultCard, AgentRunEvent, BoardDetail, ChatMessage, StockDetail, StoreCategory, StoreItem, ToolCallRecord } from '../../shared/types';
import { useAppStore } from '../../store/app-store';
import styles from './index.module.scss';
import cx from '../../shared/cx';

const builtInSlashItems = [
  { id: 'comprehensive-report', section: 'Commands', label: '综合投研报告', command: '/综合投研报告', description: '调用五个子 Agent，生成完整综合投资报告', argPlaceholder: '[输入股票代码或股票名称]' },
  { id: 'news-announcements', section: 'Commands', label: '新闻公告', command: '/新闻公告', description: '拉取指定个股最近的新闻和公告', argPlaceholder: '[输入股票代码或名称]' },
  { id: 'theme-attribution', section: 'Commands', label: '题材归因', command: '/题材归因', description: '今天哪些股票走强，主要是什么题材', argPlaceholder: '直接发送即可' },
  { id: 'daily-lhb', section: 'Commands', label: '全市场龙虎榜', command: '/全市场龙虎榜', description: '今天龙虎榜哪些票净买入最多', argPlaceholder: '直接发送即可' },
  { id: 'technical-agent', section: 'Sub Agents', label: '技术面分析agent', command: '/技术面分析', description: '仅调用技术面Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
  { id: 'fundamental-agent', section: 'Sub Agents', label: '基本面分析agent', command: '/基本面分析', description: '仅调用基本面Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
  { id: 'capital-agent', section: 'Sub Agents', label: '资金面分析agent', command: '/资金面分析', description: '仅调用资金面Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
  { id: 'sentiment-agent', section: 'Sub Agents', label: '情绪面分析agent', command: '/情绪面分析', description: '仅调用情绪面Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
  { id: 'chip-agent', section: 'Sub Agents', label: '筹码分析agent', command: '/筹码分析', description: '分析个股当前的筹码结构、主力控盘情况以及未来走势', argPlaceholder: '[输入股票代码或名称]' },
] satisfies SlashItem[];

type SlashItem = { id: string; section: string; label: string; command: string; description: string; argPlaceholder: string };
const storeTabs: Array<{ id: StoreCategory; label: string }> = [
  { id: 'commands', label: 'Commands' },
  { id: 'skills', label: 'Skills' },
  { id: 'sub-agents', label: '子代理' },
];

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
  const openRightPanel = useAppStore((state) => state.openRightPanel);
  const openBoardPanel = useAppStore((state) => state.openBoardPanel);
  const slashItems = useMemo(() => [
    ...builtInSlashItems,
    ...storeItems.filter((item) => installedStoreItems.includes(item.id) && item.command).map(storeItemToSlashItem),
  ], [installedStoreItems, storeItems]);

  useEffect(() => {
    const api = getStocksenseApi();
    void Promise.all([api.listStoreItems(), api.listInstalledStoreItems()]).then(([items, installed]) => {
      setStoreItems(items);
      setInstalledStoreItems(installed);
    }).catch(console.error);
  }, []);

  const installStoreCommand = async (id: string) => {
    const installed = await getStocksenseApi().installStoreItem(id);
    setInstalledStoreItems(installed);
    antdMessage.success('安装成功');
  };

  const uninstallStoreCommand = async (id: string) => {
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
    const kline = findMessageKline(messages, stock.code);
    openRightPanel();
    setSelectedStock({ ...stock, kline } as StockDetail);
    try {
      const detail = await getStocksenseApi().getStockDetail(stock.code);
      setSelectedStock({ ...detail, kline });
    } catch {
      setSelectedStock({ ...stock, kline } as StockDetail);
    }
  };

  const openBoardDetail = async (board: Pick<BoardDetail, 'code' | 'name'>) => {
    openBoardPanel();
    setSelectedBoard(board as BoardDetail);
    try {
      setSelectedBoard(await getStocksenseApi().getBoardDetail(board.code));
    } catch {
      setSelectedBoard(board as BoardDetail);
    }
  };

  const slashOpen = input.startsWith('/') && !input.includes(' ');
  const activeCommand = slashItems.find((item) => input.startsWith(`${item.command} `));
  const commandArg = activeCommand ? input.slice(activeCommand.command.length + 1) : '';
  const selectSlashItem = (item = slashItems[selectedSlashIndex]) => {
    if (item) setInput(`${item.command} `);
  };

  const stopThinking = () => {
    activeRequestRef.current = undefined;
    replaceLastAssistant({ id: `assistant-stopped-${Date.now()}`, role: 'assistant', content: '已暂停思考。', createdAt: new Date().toISOString() });
    setSending(false);
  };

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || isSending) return;
    setInput('');
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    addMessage(userMessage);
    if (isGreeting(text)) {
      const assistantMessage: ChatMessage = {
        id: `assistant-greeting-${Date.now()}`,
        role: 'assistant',
        content: '你好！我是 stock-sense，你的桌面端 AI 股票投研助手。有什么我可以帮你做的吗？无论是财报分析，基本面分析还是技术分析，你都可以随时告诉我',
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
    let offToken: (() => void) | undefined;
    const requestId = `chat-${Date.now()}`;
    try {
      const api = getStocksenseApi();
      activeRequestRef.current = requestId;
      offToken = api.onChatToken?.((event) => {
        if (event.requestId !== requestId || activeRequestRef.current !== requestId) return;
        if (event.runEvent) applyRunEventToLastAssistant(event.runEvent);
        if (event.token) appendToLastAssistant(event.token);
      });
      const response = await api.sendChat({ conversationId: activeConversationId ?? 'conv-1', message: text, requestId });
      if (activeRequestRef.current !== requestId) return;
      finalizeLastAssistant(response.message);
      const stock = response.events.find((event) => event.stock)?.stock;
      if (stock) {
        const resultStock = response.message.result?.stocks?.find((item) => item.code === stock.code);
        const chartData = response.message.result?.chart?.type === 'kline' ? response.message.result.chart.data : undefined;
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
        {messages.length === 0 ? <QuickEntry onSubmit={send} slashItems={slashItems} /> : messages.map((message) => <MessageBubble key={message.id} message={message} now={now} slashItems={slashItems} onStockClick={openStockDetail} onBoardClick={openBoardDetail} />)}
      </div>
      {messages.length ? (
        <div className={styles['chat-input']}>
          {slashOpen ? <SlashCommandMenu slashItems={slashItems} selectedIndex={selectedSlashIndex} onSelect={selectSlashItem} /> : null}
          <div className={styles['composer-shell']}>
            <div className={styles['input-row']}>
              {activeCommand ? (
                <div className={styles['command-input-wrap']}>
                  <button className="command-chip" title={activeCommand.description} onClick={() => setInput('/')} type="button"><span className="slash-icon">/</span>{activeCommand.command}</button>
                  <input value={commandArg} onChange={(event) => setInput(`${activeCommand.command} ${event.target.value}`)} onKeyDown={(event) => {
                    if ((event.key === 'Backspace' || event.key === 'Delete') && !commandArg) { event.preventDefault(); setInput(''); return; }
                    if (event.key === 'Enter') void send();
                  }} placeholder={activeCommand.argPlaceholder} autoFocus />
                </div>
              ) : (
                <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
                  if (slashOpen && event.key === 'Enter') { event.preventDefault(); selectSlashItem(); return; }
                  if (slashOpen && event.key === 'ArrowDown') { event.preventDefault(); setSelectedSlashIndex((value) => Math.min(value + 1, slashItems.length - 1)); return; }
                  if (slashOpen && event.key === 'ArrowUp') { event.preventDefault(); setSelectedSlashIndex((value) => Math.max(value - 1, 0)); return; }
                  if (event.key === 'Enter') void send();
                }} placeholder="输入 / 打开命令，或直接输入股票名称/代码" />
              )}
            </div>
            <div className={styles['composer-toolbar']}>
              <AppStoreBar onOpen={() => setStoreOpen(true)} />
              <div className={styles['composer-actions']}>
                <span className={styles['model-pill']}>StockBuddy</span>
                <button className={cx(styles['send-btn'], isSending && styles.sending)} onClick={isSending ? stopThinking : () => void send()} type="button" aria-label={isSending ? '暂停思考' : '发送'} title={isSending ? '暂停思考' : '发送'}>{isSending ? <span className={styles['pause-icon']} /> : '➤'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {storeOpen ? <AppStoreModal items={storeItems} installed={installedStoreItems} onInstall={installStoreCommand} onUninstall={uninstallStoreCommand} onClose={() => setStoreOpen(false)} /> : null}
    </div>
  );
}

function AppStoreBar({ onOpen }: { onOpen(): void }) {
  return (
    <div className={styles['store-bar']}>
      <button onClick={onOpen} type="button">＋</button>
      <span>插件</span>
    </div>
  );
}

function AppStoreModal({ items, installed, onInstall, onUninstall, onClose }: { items: StoreItem[]; installed: string[]; onInstall(id: string): Promise<void>; onUninstall(id: string): Promise<void>; onClose(): void }) {
  const [activeTab, setActiveTab] = useState<StoreCategory>('commands');
  const tabItems = items.filter((item) => item.category === activeTab);
  return (
    <div className={styles['store-overlay']} onClick={onClose}>
      <div className={styles['store-modal']} onClick={(event) => event.stopPropagation()}>
        <div className={styles['store-header']}>
          <h2>应用商店</h2>
          <button onClick={onClose} type="button">✕</button>
        </div>
        <div className={styles['store-tabs']}>
          {storeTabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? styles.active : ''} onClick={() => setActiveTab(tab.id)} type="button">{tab.label}</button>)}
        </div>
        <div className={styles['store-list']}>
          {tabItems.length ? tabItems.map((item) => {
            const isInstalled = installed.includes(item.id);
            return (
              <div className={styles['store-item']} key={item.id}>
                <div>
                  <div className={styles['store-item-title']}>{item.name}</div>
                  <div className={styles['store-item-desc']}>{item.description}</div>
                </div>
                <button className={isInstalled ? styles['store-uninstall'] : ''} onClick={() => void (isInstalled ? onUninstall(item.id) : onInstall(item.id))} type="button">{isInstalled ? '卸载' : '安装'}</button>
              </div>
            );
          }) : <div className={styles['store-empty']}>暂无可安装内容</div>}
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

function SlashCommandMenu({ slashItems, selectedIndex, onSelect }: { slashItems: SlashItem[]; selectedIndex: number; onSelect(item?: SlashItem): void }) {
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
          {slashItems.map((item, index) => item.section === section ? (
            <button ref={index === selectedIndex ? activeRef : undefined} className={cx(styles['slash-item'], index === selectedIndex && styles.active)} key={item.id} onMouseDown={(event) => { event.preventDefault(); onSelect(item); }} type="button">
              <span className="slash-icon">/</span>
              <span className={styles['slash-copy']}>
                <span className={styles['slash-label']}>{item.label}</span>
                <span className={styles['slash-desc']}>{item.description}</span>
              </span>
              <span className={styles['slash-meta']}>
                <span>{item.section === 'Commands' ? '命令' : '全局'}</span>
                <code>{item.command}</code>
              </span>
            </button>
          ) : null)}
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
  const selectSlashItem = (item = slashItems[selectedSlashIndex]) => { if (item) setValue(`${item.command} `); };
  return (
    <div className={styles['quick-entry']} data-quickentry>
      <div className={styles['qe-hero']} aria-hidden="true">
        <svg viewBox="0 0 420 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="420" height="200" fill="var(--bg)" rx="8" />
          <g stroke="var(--surface)" strokeWidth="0.5" opacity="0.75"><line x1="40" y1="30" x2="380" y2="30" /><line x1="40" y1="60" x2="380" y2="60" /><line x1="40" y1="90" x2="380" y2="90" /><line x1="40" y1="120" x2="380" y2="120" /><line x1="40" y1="150" x2="380" y2="150" /><line x1="108" y1="30" x2="108" y2="150" /><line x1="176" y1="30" x2="176" y2="150" /><line x1="244" y1="30" x2="244" y2="150" /><line x1="312" y1="30" x2="312" y2="150" /></g>
          <path className={styles['qe-wave']} d="M60 150 Q 95 110, 130 120 T 200 90 T 270 100 T 340 70 L 360 150 Z" fill="rgba(59,130,246,0.08)" />
          <path className={styles['qe-trend']} d="M60 150 Q 95 110, 130 120 T 200 90 T 270 100 T 340 70" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round" />
          {[80, 140, 200, 260, 320].map((x, index) => <g key={x} transform={`translate(${x},${index % 2 ? 112 : 82})`}><g className={styles['qe-candle']} style={{ animationDelay: `${index * -0.35}s` }}><line x1="6" y1="0" x2="6" y2="40" stroke={index % 2 ? 'var(--danger)' : 'var(--success)'} strokeWidth="1.5" /><rect x="1" y="10" width="10" height="20" fill={index % 2 ? 'var(--danger)' : 'var(--success)'} rx="1" /></g></g>)}
          <line x1="40" y1="150" x2="380" y2="150" stroke="var(--border)" strokeWidth="1" />
        </svg>
      </div>
      <div className={styles['qe-title']}>开始新的投研分析</div>
      <div className={styles['qe-sub']}>输入股票名称或代码，AI 将为你深度解读</div>
      <div className={styles['qe-search-box']}>
        {slashOpen ? <SlashCommandMenu slashItems={slashItems} selectedIndex={selectedSlashIndex} onSelect={selectSlashItem} /> : null}
        <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
          if (slashOpen && event.key === 'Enter') { event.preventDefault(); selectSlashItem(); return; }
          if (slashOpen && event.key === 'ArrowDown') { event.preventDefault(); setSelectedSlashIndex((current) => Math.min(current + 1, slashItems.length - 1)); return; }
          if (slashOpen && event.key === 'ArrowUp') { event.preventDefault(); setSelectedSlashIndex((current) => Math.max(current - 1, 0)); return; }
          if (event.key === 'Enter') onSubmit(value);
        }} placeholder="例如：/综合投研报告 中公教育、000858……" autoFocus />
        <button onClick={() => onSubmit(value)} type="button">开始分析</button>
      </div>
      <div className={styles['qe-hints']}>
        {examples.map((example) => <button key={example} className={styles['qe-hint']} onClick={() => setValue(example)} type="button">{example}</button>)}
      </div>
    </div>
  );
}

function MessageBubble({ message, now, slashItems, onStockClick, onBoardClick }: { message: ChatMessage; now: number; slashItems: SlashItem[]; onStockClick(stock: StockDetail): void; onBoardClick(board: Pick<BoardDetail, 'code' | 'name'>): void }) {
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
      onBoardClick({ code: boardLink.dataset.boardCode!, name: boardLink.dataset.boardName ?? boardLink.textContent ?? boardLink.dataset.boardCode! });
      return;
    }
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-stock-code]');
    if (!link) return;
    event.preventDefault();
    onStockClick({ code: link.dataset.stockCode!, name: link.dataset.stockName ?? link.textContent ?? link.dataset.stockCode! });
  };

  return (
    <div className={cx(styles.msg, 'msg', message.role === 'user' ? styles.user : styles.agent, message.role === 'user' ? 'user' : 'agent')} data-msg>
      <div className={styles['msg-avatar']} data-avatar>
        {message.role === 'user' ? '我' : (
          <span className={cx(styles.whale, message.thinking && styles.busy)} aria-label="AI 鲸鱼头像" role="img">
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
        {message.thinking ? <ThinkingBanner /> : message.processedSeconds ? <ProcessedBanner seconds={message.processedSeconds} /> : null}
        {message.content.trim() ? <div className="msg-text" onClick={openLinkedStock} onMouseUp={copySelectedMessage} dangerouslySetInnerHTML={{ __html: renderMarkdownContent(renderCommandInText(message.content, slashItems), { disclaimer: message.role === 'assistant' && Boolean(message.result || message.evidence?.length || message.findings?.length || message.toolCalls?.length) }) }} /> : null}
        {message.thinking ? <ThinkingTrace startedAt={message.thinking.startedAt} steps={message.thinking.steps} /> : null}
        {message.runEvents?.length ? <RunEventTrace events={message.runEvents} /> : !message.thinking && message.steps?.length ? <Trace steps={message.steps} /> : null}
        {message.toolCalls?.length ? <ToolCallTrace toolCalls={message.toolCalls} /> : null}
        {message.result ? <ResultCard result={message.result} onStockClick={onStockClick} onBoardClick={onBoardClick} /> : null}
        <div className={styles['msg-time']}>{formatMessageTime(message.createdAt, now)}</div>
      </div>
    </div>
  );
}

function WhaleLogo() {
  return (
    <svg className={styles['whale-logo']} viewBox="0 0 352 294" aria-hidden="true">
      <path fill="#F6FAFE" opacity="1.000000" stroke="none" 
  d="
M88.988617,238.965515 
  C88.991425,238.627396 88.994232,238.289276 89.315704,237.561493 
  C90.095856,237.134094 90.557335,237.096375 91.254578,237.317490 
  C93.008522,237.144409 94.526703,236.712509 96.457039,236.180634 
  C99.107544,235.969131 101.345886,235.857605 104.046265,235.830536 
  C106.338257,235.943954 108.168213,235.972885 109.995529,236.325256 
  C110.651764,237.140854 111.310631,237.633041 112.324501,238.155457 
  C114.462509,238.214630 116.245514,238.243561 118.437447,238.333740 
  C121.526817,238.429840 124.207260,238.464691 127.194092,238.635406 
  C127.706512,238.684784 127.912537,238.598297 128.497803,238.554596 
  C129.894363,238.593033 130.911667,238.588654 132.159210,238.818695 
  C132.577301,239.165802 132.765137,239.278503 133.049454,239.701141 
  C134.440353,239.987015 135.734772,239.962936 137.353790,239.889328 
  C138.112427,239.882401 138.546478,239.925034 139.155884,240.219238 
  C140.237411,240.119125 141.143585,239.767426 142.415344,239.301102 
  C143.799072,239.100723 144.817245,239.014954 146.071625,238.879944 
  C146.610596,238.689178 146.840714,238.471024 147.345398,238.167267 
  C147.888367,238.282013 148.084106,238.405731 148.550140,238.723846 
  C151.559265,238.066406 154.298096,237.214539 157.374695,236.197662 
  C176.896408,229.644760 187.539886,215.307800 194.128784,196.852829 
  C194.532257,196.425323 194.791016,196.207352 195.400482,195.939835 
  C197.210052,194.934769 198.631653,193.915543 200.135025,193.036072 
  C204.140854,190.692673 208.181854,188.409409 212.553009,186.031540 
  C217.599579,183.317795 222.302048,180.674759 227.364868,178.055389 
  C231.382385,174.376358 235.039551,170.673676 238.869537,166.952225 
  C239.042358,166.933441 239.072708,166.587082 239.286224,166.472397 
  C239.787277,165.683502 240.074829,165.009277 240.614914,164.180695 
  C240.941498,163.843430 241.015564,163.660538 241.256409,163.413620 
  C241.610382,162.946472 241.797592,162.543350 242.145905,161.825623 
  C246.530655,157.970322 250.754303,154.429626 255.332672,150.892654 
  C259.572876,148.294739 262.947693,145.319687 268.139801,144.514847 
  C272.177765,143.888931 275.767242,140.369858 279.667175,138.206757 
  C279.778290,138.276901 279.985443,138.115173 280.318176,138.160095 
  C281.454834,137.863693 282.258789,137.522385 283.375214,137.229568 
  C284.149841,136.912811 284.612000,136.547546 285.432220,136.127441 
  C290.205841,135.341522 294.621399,134.610443 299.462585,133.942291 
  C305.255920,134.321289 310.623596,134.637375 316.313446,135.044312 
  C317.685242,135.828888 318.734863,136.522614 319.806213,137.496185 
  C320.146881,138.226608 320.465790,138.677216 320.823914,139.354431 
  C320.863129,139.581055 321.048645,140.001923 321.032349,140.266052 
  C321.069641,140.698273 321.123230,140.866364 321.129181,141.457092 
  C321.093506,143.584106 321.105408,145.288483 321.044373,147.323776 
  C320.987732,148.105148 321.004028,148.555588 320.936768,149.385986 
  C320.150116,154.072617 319.447021,158.379288 318.740112,162.785599 
  C318.736298,162.885223 318.928833,162.937103 318.553040,162.924591 
  C316.078156,168.293976 313.979034,173.675888 311.818665,179.170624 
  C311.757416,179.283447 311.797241,179.537094 311.432251,179.633759 
  C305.935577,186.395950 300.803864,193.061447 295.408722,199.904755 
  C294.066986,201.361221 292.988708,202.639893 291.920288,203.883698 
  C291.930176,203.848816 291.861298,203.826202 291.511566,203.832947 
  C287.238190,206.859802 283.314545,209.879913 279.356995,212.814636 
  C279.323090,212.729248 279.141022,212.753708 278.775879,212.841919 
  C270.924561,216.831116 263.438416,220.732101 255.889877,224.300720 
  C255.270508,223.054474 254.713531,222.140594 254.517868,221.174438 
  C258.311462,218.784836 261.743713,216.447479 265.520142,214.069244 
  C278.450897,205.949265 287.388458,194.736389 293.954132,181.266815 
  C292.252686,181.270477 290.700439,181.678177 290.016327,182.679184 
  C288.078949,185.514008 286.496887,188.591644 284.491394,191.727203 
  C283.740875,192.567902 283.273804,193.255035 282.569489,194.169998 
  C275.881531,200.589508 269.430817,206.781174 262.624268,213.019363 
  C253.514801,216.731644 244.761246,220.397400 235.628326,224.051117 
  C231.925125,225.971786 228.597366,227.301270 225.541611,223.946091 
  C228.888306,221.617203 231.933411,219.446671 235.303070,217.321075 
  C237.016907,216.540161 238.451859,215.781662 239.787231,214.876266 
  C244.421768,211.733948 249.968796,209.465164 251.659882,203.125412 
  C253.108978,202.504715 254.461945,202.078903 255.263641,201.167938 
  C262.310608,193.160690 268.320862,184.504562 271.801392,174.002350 
  C272.518768,172.028229 272.943695,170.216858 273.634460,168.253815 
  C274.265930,167.401505 274.631622,166.700897 275.255310,165.750885 
  C276.253113,162.896057 276.992920,160.290619 277.732727,157.685181 
  C277.177338,157.511078 276.621918,157.336960 276.066528,157.162857 
  C275.026733,160.103165 273.986938,163.043472 272.862793,166.247406 
  C272.686859,166.865540 272.595276,167.220032 272.274750,167.832367 
  C271.209381,169.978897 270.372986,171.867584 269.289215,173.976624 
  C262.595001,183.752914 256.148193,193.308838 249.423416,203.025345 
  C244.467255,207.579071 239.789017,211.972183 234.756592,216.181335 
  C228.796692,218.964569 223.190979,221.931763 217.430664,224.877869 
  C217.276062,224.856781 216.999969,225.002167 216.634827,225.020187 
  C214.511322,225.681595 212.752991,226.324982 210.589050,226.961655 
  C206.786987,227.634949 203.390533,228.314972 199.674133,229.005508 
  C198.887421,229.835754 198.420670,230.655487 197.724518,231.447861 
  C197.495148,231.420502 197.104813,231.667847 196.736633,231.562790 
  C195.606339,231.416260 194.844208,231.374786 193.802658,231.192581 
  C192.315750,231.226974 191.108276,231.402069 189.527283,231.644714 
  C187.346069,232.431931 185.465088,233.009552 183.744064,233.897278 
  C178.030197,236.844650 172.373886,239.903564 166.308624,242.890259 
  C164.255768,243.640167 162.589813,244.419510 160.923859,245.198853 
  C162.176804,246.443710 163.429749,247.688553 164.396881,249.039078 
  C162.841400,249.714294 161.571732,250.283844 160.097809,250.504486 
  C159.346664,249.846237 158.821350,249.315796 158.249664,249.259933 
  C143.568848,247.824997 128.878250,246.489059 114.200592,245.023361 
  C107.479492,244.352203 100.782188,243.442734 94.050995,242.267914 
  C94.096817,237.909607 91.053795,239.278748 88.988617,238.965515 
M196.938736,223.727493 
  C200.902542,221.795242 204.866348,219.862991 209.289001,217.418365 
  C216.284943,211.046799 223.280884,204.675232 230.866852,197.990173 
  C232.942032,194.929642 235.017212,191.869110 237.092407,188.808578 
  C236.327408,188.305145 235.562408,187.801727 234.797424,187.298294 
  C232.800980,190.478226 230.804520,193.658157 228.287689,197.245621 
  C221.151001,203.787399 214.014328,210.329163 206.180222,216.971329 
  C202.858093,218.686707 199.535965,220.402084 195.561554,222.102325 
  C195.210037,222.514511 194.858521,222.926712 194.507034,223.338928 
  C195.088089,223.512955 195.669144,223.686996 196.938736,223.727493 
M298.074554,174.502365 
  C299.216034,169.985321 302.414886,165.742569 300.147858,160.134628 
  C297.554108,166.707397 295.200348,172.671982 292.846588,178.636581 
  C293.171082,178.893707 293.495575,179.150848 293.820068,179.407990 
  C295.157806,178.012665 296.495544,176.617355 298.074554,174.502365 
M194.095200,227.727524 
  C194.040512,227.230469 193.985825,226.733414 193.931137,226.236359 
  C193.485458,226.350754 193.039780,226.465134 192.594101,226.579514 
  C192.895676,227.003693 193.197250,227.427872 194.095200,227.727524 
z"/>
<path fill="#1B6AF2" opacity="1.000000" stroke="none" 
  d="
M195.049789,195.989380 
  C194.791016,196.207352 194.532257,196.425323 193.792114,196.889786 
  C191.198517,200.082718 189.086288,203.029160 186.696869,205.739105 
  C185.073929,204.337875 183.863708,202.450058 182.352737,202.166855 
  C179.650146,201.660339 176.736252,202.405884 173.965027,202.113281 
  C169.287872,201.619461 164.653152,200.724075 159.964203,199.654343 
  C154.658157,198.082748 152.220047,191.700409 148.150879,190.799591 
  C142.941391,189.646378 140.198654,187.410339 137.777130,183.371109 
  C137.048401,182.155563 135.764435,181.098953 134.494934,180.414352 
  C130.797501,178.420380 126.992126,176.623230 123.197289,174.815643 
  C122.333275,174.404083 121.278000,174.390747 120.419609,173.971329 
  C117.793427,172.688202 115.245186,171.245529 112.618675,169.963150 
  C110.447708,168.903198 108.208611,167.982819 105.599884,167.000381 
  C104.133873,166.999481 103.067680,166.998825 101.948029,166.651596 
  C100.296700,165.216949 98.736786,164.067368 97.093536,163.052765 
  C92.869820,160.444962 86.438110,161.935684 83.733948,155.715240 
  C80.945198,155.377945 77.485367,152.962677 76.617493,158.047501 
  C71.833374,159.387421 67.420471,160.685333 62.964550,161.618195 
  C60.736919,158.159119 59.116154,154.329926 56.246532,152.129028 
  C50.809425,147.958954 44.089291,146.740997 37.279682,145.896744 
  C29.068003,144.878647 29.110561,144.588379 31.917694,152.503281 
  C32.077026,152.952515 31.975878,153.494156 31.696081,153.849030 
  C27.586658,149.791275 23.777113,145.877274 19.969374,141.594971 
  C19.967468,140.490616 19.963755,139.754547 20.314905,138.976685 
  C21.724188,137.749893 22.632200,136.368866 23.877205,135.439102 
  C24.963623,134.627777 26.419956,133.900177 27.729849,133.869858 
  C33.900150,133.726990 38.483074,141.674515 45.536572,137.428223 
  C45.616066,137.380371 45.883286,137.512619 45.971333,137.629654 
  C49.749866,142.652512 58.052414,138.747955 61.170135,145.308716 
  C61.457413,145.913254 63.455967,146.237122 64.387589,145.911728 
  C68.678871,144.412781 71.948174,145.063843 73.541199,150.300323 
  C74.104195,150.155746 74.667183,150.011154 75.230179,149.866562 
  C76.144844,145.266281 77.059502,140.666000 78.132568,135.269028 
  C80.236687,137.852234 81.602768,139.857956 83.294037,141.535950 
  C86.610497,144.826355 90.785355,142.622131 94.544655,143.122375 
  C99.838524,143.826828 104.073555,142.186218 108.404114,139.001434 
  C109.603485,139.095978 110.400566,139.187241 111.197655,139.278488 
  C107.778381,141.509506 104.370911,143.758957 100.933846,145.962219 
  C99.610870,146.810287 98.220566,147.553345 96.134010,148.767120 
  C103.652252,154.552994 111.367874,153.377167 119.469452,153.072083 
  C119.968063,153.932419 119.983727,154.466217 119.660751,154.968781 
  C117.548698,155.292313 115.775291,155.647079 113.544701,156.001282 
  C109.627914,155.797272 106.152023,155.326614 102.717545,155.535782 
  C101.520531,155.608673 100.425758,157.360352 99.284302,158.345352 
  C101.750679,159.739151 105.170036,162.914108 106.507767,162.198349 
  C110.810638,159.896225 113.250427,162.472565 115.812508,164.458023 
  C119.594688,167.388962 122.911179,170.913223 126.582108,173.999069 
  C128.054199,175.236526 130.115326,177.022995 131.608231,176.772324 
  C138.534286,175.609314 142.396606,180.501236 147.264053,183.668381 
  C154.635391,188.464737 161.564926,195.038086 171.722534,191.143799 
  C172.950272,190.673096 174.665665,191.225037 176.092361,191.565582 
  C182.374573,193.065125 188.555695,197.128433 195.042175,192.069427 
  C195.457718,191.745316 196.338699,192.017929 196.804977,192.283966 
  C196.087799,193.699783 195.568802,194.844589 195.049789,195.989380 
z"/>
<path fill="#2688FF" opacity="1.000000" stroke="none" 
  d="
M163.023788,111.143311 
  C164.327026,109.943741 165.630264,108.744179 167.461014,107.253563 
  C168.662079,106.641548 169.335617,106.320580 170.012894,106.363106 
  C171.638657,109.474350 171.638657,109.474350 176.374939,105.999176 
  C177.499451,105.998901 178.249115,105.998535 179.427353,105.998650 
  C186.174377,104.871445 192.475449,103.623398 198.824295,102.706085 
  C200.294785,102.493614 202.032196,103.188248 203.464142,103.856720 
  C205.975388,105.029053 208.603027,107.948929 210.724503,107.570747 
  C216.250839,106.585632 222.201614,105.190643 226.709183,102.100761 
  C230.852951,99.260269 233.629639,98.180954 237.322571,102.190170 
  C238.588165,100.238243 239.589401,98.694061 240.137695,97.848419 
  C243.482224,99.739937 246.766312,103.161705 249.147308,102.619286 
  C254.156448,101.478165 259.083832,103.215645 263.410187,102.439514 
  C272.584106,100.793762 278.775085,105.615822 285.012756,109.999275 
  C288.695374,112.587166 290.986389,113.391602 293.721619,110.310944 
  C298.763153,112.373955 303.825989,113.545624 305.681702,119.398026 
  C306.100037,120.717293 309.224060,121.629288 311.214478,121.897339 
  C314.475952,122.336555 316.023773,123.808578 315.998444,127.041077 
  C315.982788,129.040283 315.986206,131.039627 315.564514,133.010101 
  C311.103180,132.626556 307.058441,132.271835 303.009521,131.499527 
  C302.912476,127.052475 298.494537,122.593025 292.991394,121.186539 
  C286.821381,119.609612 280.626984,118.122925 274.418121,116.707047 
  C273.030823,116.390678 271.513672,116.677963 270.100769,116.432007 
  C267.478088,115.975464 264.880188,115.364716 262.287567,114.752174 
  C260.646454,114.364449 258.491425,112.949982 257.493286,113.546394 
  C249.035339,118.600258 240.750061,114.204918 233.319595,111.905754 
  C227.819702,110.203949 223.693069,110.735886 220.332031,113.562454 
  C215.874573,117.311127 211.517715,117.342476 206.444489,116.547516 
  C206.274582,115.695496 206.108566,115.065491 206.027527,114.424728 
  C205.341766,109.003807 203.978195,108.401962 199.266830,111.093307 
  C196.343353,112.763321 193.326996,114.391884 190.159012,115.472137 
  C187.866653,116.253807 185.261307,116.164345 182.787216,116.355270 
  C179.161728,116.635040 175.529755,116.835709 171.898544,117.033340 
  C170.535995,117.107491 168.672424,117.651550 167.900375,116.983665 
  C166.007385,115.346054 164.616623,113.127884 163.023788,111.143311 
z"/>
<path fill="#227FFE" opacity="1.000000" stroke="none" 
  d="
M279.985443,138.115173 
  C279.985443,138.115173 279.778290,138.276901 279.257446,138.174835 
  C277.646240,137.846069 276.555939,137.619370 274.751801,137.244247 
  C276.985992,135.855194 278.352783,135.005432 279.719574,134.155670 
  C277.068268,133.519135 274.763184,134.181473 272.603302,133.862030 
  C261.841614,132.270447 251.132950,130.315277 240.362106,128.796860 
  C239.032776,128.609467 237.443497,130.266006 235.567932,131.047211 
  C229.053131,129.608963 222.873749,127.558540 216.696960,130.118042 
  C212.952225,131.669769 209.549789,134.047577 206.026855,135.700607 
  C205.784149,134.112747 205.932571,132.332474 205.162506,131.733917 
  C200.553268,128.151337 194.586655,129.857864 192.041824,135.107620 
  C191.446442,136.335815 190.384537,137.952469 189.265427,138.210236 
  C183.025146,139.647598 176.701263,140.722061 170.206924,141.958511 
  C168.935822,135.314453 165.064529,134.955978 160.381042,136.773941 
  C157.129639,138.036026 154.024765,139.674469 150.777435,140.948471 
  C147.626770,142.184555 144.345856,143.086578 141.184082,144.297150 
  C139.302536,145.017517 137.540497,146.050003 135.462814,147.070862 
  C136.391449,144.177322 137.081741,142.026428 137.772034,139.875549 
  C144.887894,131.485901 152.003754,123.096260 159.500244,115.033356 
  C158.577148,117.417198 157.472366,119.639435 155.929504,121.498016 
  C152.414032,125.732887 148.683701,129.789429 145.040680,133.918427 
  C147.764114,133.499420 149.741959,132.266357 151.723389,131.039108 
  C153.981674,129.640381 156.749939,128.681854 158.398621,126.761192 
  C161.922241,122.656288 163.574982,121.927689 167.854965,124.993126 
  C171.631958,127.698311 175.372162,128.834015 179.963715,127.259827 
  C182.424438,126.416183 185.237228,126.636986 187.752258,125.902107 
  C189.726608,125.325211 192.085953,124.467003 193.224579,122.947304 
  C195.957779,119.299347 199.189285,119.209991 203.211472,119.776794 
  C207.040283,120.316338 211.007889,120.199287 214.889923,119.964699 
  C223.041229,119.472145 231.173813,118.675041 239.321899,118.116737 
  C240.227112,118.054718 241.173172,118.760544 242.116730,119.058144 
  C247.364227,120.713264 252.538208,122.694984 257.884949,123.921356 
  C267.333679,126.088577 276.892578,127.773407 286.392090,129.724670 
  C287.199219,129.890457 287.906952,130.540283 287.988739,130.586395 
  C286.880341,132.714462 285.977264,134.448380 285.074158,136.182281 
  C284.612000,136.547546 284.149841,136.912811 283.185577,136.943451 
  C281.784119,137.110947 280.884796,137.613052 279.985443,138.115173 
z"/>
<path fill="#6BBDFD" opacity="1.000000" stroke="none" 
  d="
M103.584236,235.746063 
  C101.345886,235.857605 99.107544,235.969131 96.074745,236.106842 
  C93.859810,236.441559 92.439316,236.750107 91.018822,237.058655 
  C90.557335,237.096375 90.095856,237.134094 89.312714,237.308228 
  C86.968414,237.430222 84.945770,237.415802 82.218918,237.391998 
  C80.876945,237.827393 80.239182,238.272171 79.601418,238.716949 
  C67.474594,240.246918 55.362778,241.915771 43.212498,243.228668 
  C39.169552,243.665543 35.018631,243.337158 30.934742,243.079086 
  C28.200937,242.906311 27.594872,241.033401 28.846386,238.846649 
  C29.817459,237.149933 30.989567,235.374908 32.515472,234.220413 
  C42.511822,226.657349 53.456963,221.223236 66.844635,219.920578 
  C68.021729,219.552277 68.510208,219.265137 68.998688,218.978012 
  C70.703522,218.911514 72.408348,218.845001 74.812408,218.756561 
  C76.001534,218.465744 76.491417,218.196838 76.981308,217.927948 
  C84.360924,217.914215 91.740532,217.900497 99.742188,218.125366 
  C100.931969,218.431442 101.499695,218.498886 102.067429,218.566315 
  C103.324318,218.801132 104.581207,219.035950 106.397888,219.621521 
  C115.106003,223.205063 115.106003,223.205063 113.731659,230.149414 
  C111.889969,231.495499 110.349731,232.707687 108.434296,233.934464 
  C106.567482,234.548065 105.075859,235.147064 103.584236,235.746063 
M55.270180,224.410858 
  C53.122616,225.373901 50.975052,226.336945 48.827488,227.299973 
  C48.924309,227.572266 49.021126,227.844559 49.117947,228.116852 
  C53.263119,227.172791 57.408287,226.228729 61.553459,225.284668 
  C61.552433,224.904007 61.551407,224.523331 61.550385,224.142670 
  C59.708900,224.142670 57.867420,224.142670 55.270180,224.410858 
z"/>
<path fill="#1A6DF6" opacity="1.000000" stroke="none" 
  d="
M108.001831,138.998169 
  C104.073555,142.186218 99.838524,143.826828 94.544655,143.122375 
  C90.785355,142.622131 86.610497,144.826355 83.294037,141.535950 
  C81.602768,139.857956 80.236687,137.852234 78.132568,135.269028 
  C77.059502,140.666000 76.144844,145.266281 75.230179,149.866562 
  C74.667183,150.011154 74.104195,150.155746 73.541199,150.300323 
  C71.948174,145.063843 68.678871,144.412781 64.387589,145.911728 
  C63.455967,146.237122 61.457413,145.913254 61.170135,145.308716 
  C58.052414,138.747955 49.749866,142.652512 45.971333,137.629654 
  C45.883286,137.512619 45.616066,137.380371 45.536572,137.428223 
  C38.483074,141.674515 33.900150,133.726990 27.729849,133.869858 
  C26.419956,133.900177 24.963623,134.627777 23.877205,135.439102 
  C22.632200,136.368866 21.724188,137.749893 19.993668,138.794891 
  C17.180996,132.411621 14.151996,126.330833 15.435736,118.776466 
  C18.763285,119.590874 21.564013,120.587616 24.441429,120.919548 
  C31.723299,121.759529 39.073730,122.049377 46.332367,123.033913 
  C53.338463,123.984184 60.264099,125.527641 67.225082,126.810516 
  C67.225082,126.810516 67.073891,126.888199 67.105682,127.212753 
  C68.527176,128.318588 69.916862,129.099869 71.306549,129.881149 
  C72.900032,131.073975 74.493523,132.266800 76.087006,133.459625 
  C76.383789,133.087891 76.680573,132.716156 76.977356,132.344406 
  C76.324783,131.133514 75.672211,129.922638 75.445129,128.270309 
  C76.248749,126.218330 76.626869,124.607788 77.353104,122.959694 
  C79.120850,121.673553 80.540474,120.424973 82.377853,118.808960 
  C83.032494,120.118462 83.934280,121.076057 83.903725,122.002914 
  C83.743332,126.868408 86.027557,127.618904 90.247879,126.534706 
  C91.691002,126.163963 94.281670,126.718079 94.996895,127.769104 
  C96.653908,130.204056 97.486343,133.200150 98.812462,136.346863 
  C99.881363,136.277023 101.995956,136.130310 104.111725,136.002930 
  C106.269646,135.873001 108.256851,135.985092 108.001831,138.998169 
z"/>
<path fill="#5DB6FE" opacity="1.000000" stroke="none" 
  d="
M291.299347,257.212952 
  C290.793152,257.535767 290.286957,257.858582 289.222473,257.901093 
  C285.309326,258.381470 281.943512,259.097321 278.601746,259.911835 
  C271.035767,261.756012 263.481598,263.648865 255.895157,265.528717 
  C253.927292,261.138580 252.304138,259.905548 248.361908,261.240143 
  C246.480347,261.877106 245.115158,264.039429 243.516068,265.510803 
  C243.814926,266.102570 244.113785,266.694336 244.412643,267.286102 
  C240.049301,267.857361 235.665131,268.309113 231.333939,269.064728 
  C229.819305,269.328979 228.435181,270.341431 226.523712,271.005188 
  C216.705078,270.995911 207.354187,270.993683 198.085724,270.609863 
  C198.656082,269.848694 199.094482,269.243347 199.639435,269.123810 
  C206.082275,267.710663 212.550781,266.414124 218.991455,264.991608 
  C222.155411,264.292786 224.525055,262.897369 223.370514,258.980896 
  C226.509354,257.993073 229.272202,257.012878 232.351517,256.056610 
  C233.451920,256.385925 234.235855,256.691284 235.380219,257.053070 
  C241.158707,256.072174 246.576782,255.034897 252.376526,253.998672 
  C258.084442,251.195053 265.233215,251.985138 268.872711,245.787231 
  C269.235413,245.169586 270.495422,245.099121 270.905518,244.485168 
  C272.061279,242.754822 272.991089,240.873520 274.009949,239.051727 
  C275.425018,238.388626 276.840118,237.725510 278.993469,237.020309 
  C280.377258,236.863251 281.041229,236.809982 281.665375,236.623520 
  C286.779907,235.095566 291.886993,233.542801 297.221588,232.265625 
  C299.025421,232.463287 300.604034,232.392853 302.182617,232.322693 
  C307.372131,240.748154 308.327606,241.198669 316.632874,238.001556 
  C315.629242,240.650757 315.457977,243.107864 314.170929,244.065720 
  C311.789642,245.837921 308.755219,246.732452 305.932495,247.641129 
  C304.755707,246.974411 303.335175,246.060257 302.574951,246.446350 
  C299.081360,248.220627 295.594879,250.126465 292.498260,252.497589 
  C291.487640,253.271439 291.665192,255.597046 291.299347,257.212952 
z"/>
<path fill="#1F79FE" opacity="1.000000" stroke="none" 
  d="
M137.482468,140.034332 
  C137.081741,142.026428 136.391449,144.177322 135.462814,147.070862 
  C137.540497,146.050003 139.302536,145.017517 141.184082,144.297150 
  C144.345856,143.086578 147.626770,142.184555 150.777435,140.948471 
  C154.024765,139.674469 157.129639,138.036026 160.381042,136.773941 
  C165.064529,134.955978 168.935822,135.314453 170.206924,141.958511 
  C176.701263,140.722061 183.025146,139.647598 189.265427,138.210236 
  C190.384537,137.952469 191.446442,136.335815 192.041824,135.107620 
  C194.586655,129.857864 200.553268,128.151337 205.162506,131.733917 
  C205.932571,132.332474 205.784149,134.112747 205.756714,135.928101 
  C205.196487,139.147415 204.939697,141.785599 204.633209,144.588989 
  C204.583511,144.754227 204.293182,144.940720 203.894897,145.002899 
  C199.397705,147.552689 201.591125,151.608292 200.759247,155.095520 
  C200.326462,154.287521 200.282852,153.317490 199.972473,152.442017 
  C199.100174,149.981445 198.117996,147.559830 197.179138,145.122849 
  C196.119629,147.440048 195.008652,149.735840 194.030930,152.087051 
  C193.724731,152.823425 193.894485,153.746384 193.647400,154.520432 
  C191.678741,160.687622 188.202332,161.903870 183.401810,158.146408 
  C176.214890,161.948669 176.214050,161.950348 168.777908,158.205612 
  C168.484970,158.058105 168.264969,157.735077 167.964432,157.638031 
  C164.669449,156.574326 161.379242,154.728195 158.060471,154.670792 
  C151.774826,154.562073 145.269394,156.677246 139.230026,155.654816 
  C132.708786,154.550812 126.404854,155.061417 119.999390,155.000000 
  C119.983727,154.466217 119.968063,153.932419 119.926224,152.998016 
  C125.664322,148.462646 131.428619,144.327896 137.482468,140.034332 
z"/>
<path fill="#2383FF" opacity="1.000000" stroke="none" 
  d="
M285.432220,136.127441 
  C285.977264,134.448380 286.880341,132.714462 287.988739,130.586395 
  C287.906952,130.540283 287.199219,129.890457 286.392090,129.724670 
  C276.892578,127.773407 267.333679,126.088577 257.884949,123.921356 
  C252.538208,122.694984 247.364227,120.713264 242.116730,119.058144 
  C241.173172,118.760544 240.227112,118.054718 239.321899,118.116737 
  C231.173813,118.675041 223.041229,119.472145 214.889923,119.964699 
  C211.007889,120.199287 207.040283,120.316338 203.211472,119.776794 
  C199.189285,119.209991 195.957779,119.299347 193.224579,122.947304 
  C192.085953,124.467003 189.726608,125.325211 187.752258,125.902107 
  C185.237228,126.636986 182.424438,126.416183 179.963715,127.259827 
  C175.372162,128.834015 171.631958,127.698311 167.854965,124.993126 
  C163.574982,121.927689 161.922241,122.656288 158.398621,126.761192 
  C156.749939,128.681854 153.981674,129.640381 151.723389,131.039108 
  C149.741959,132.266357 147.764114,133.499420 145.040680,133.918427 
  C148.683701,129.789429 152.414032,125.732887 155.929504,121.498016 
  C157.472366,119.639435 158.577148,117.417198 159.853821,114.979691 
  C160.678482,113.448830 161.530167,112.298370 162.702820,111.145599 
  C164.616623,113.127884 166.007385,115.346054 167.900375,116.983665 
  C168.672424,117.651550 170.535995,117.107491 171.898544,117.033340 
  C175.529755,116.835709 179.161728,116.635040 182.787216,116.355270 
  C185.261307,116.164345 187.866653,116.253807 190.159012,115.472137 
  C193.326996,114.391884 196.343353,112.763321 199.266830,111.093307 
  C203.978195,108.401962 205.341766,109.003807 206.027527,114.424728 
  C206.108566,115.065491 206.274582,115.695496 206.444489,116.547516 
  C211.517715,117.342476 215.874573,117.311127 220.332031,113.562454 
  C223.693069,110.735886 227.819702,110.203949 233.319595,111.905754 
  C240.750061,114.204918 249.035339,118.600258 257.493286,113.546394 
  C258.491425,112.949982 260.646454,114.364449 262.287567,114.752174 
  C264.880188,115.364716 267.478088,115.975464 270.100769,116.432007 
  C271.513672,116.677963 273.030823,116.390678 274.418121,116.707047 
  C280.626984,118.122925 286.821381,119.609612 292.991394,121.186539 
  C298.494537,122.593025 302.912476,127.052475 302.640381,131.526703 
  C301.195953,132.607437 300.116455,133.243408 299.036957,133.879364 
  C294.621399,134.610443 290.205841,135.341522 285.432220,136.127441 
z"/>
<path fill="#66BAFE" opacity="1.000000" stroke="none" 
  d="
M170.901352,30.029514 
  C178.774872,43.128765 183.759460,57.135216 184.933960,72.338127 
  C184.470322,72.543098 184.006668,72.748077 183.543015,72.953049 
  C181.374298,68.572433 179.205566,64.191818 176.988937,59.135941 
  C176.563065,58.004757 176.185104,57.548832 175.807129,57.092911 
  C175.807129,57.092911 175.884079,57.143726 175.912460,56.786354 
  C177.044647,50.962616 177.044647,50.962616 170.773087,52.241764 
  C170.773087,52.241764 170.786530,52.156147 170.756897,51.902985 
  C170.427048,51.476673 170.126831,51.303528 169.826614,51.130386 
  C169.826614,51.130386 169.854599,51.203167 169.861557,50.842648 
  C169.194016,49.629868 168.680481,48.536152 167.820160,47.962662 
  C159.107040,42.154491 149.127441,40.830532 139.021866,39.998550 
  C136.349625,37.399254 132.785858,35.249737 131.198410,32.103161 
  C128.266296,26.291245 131.054153,22.058413 137.101837,18.213100 
  C142.868607,14.546402 148.416107,14.501546 154.620880,17.042458 
  C159.828842,21.717480 164.862244,25.849785 169.920135,29.951899 
  C170.130081,30.122177 170.569077,30.010067 170.901352,30.029514 
z"/>
<path fill="#3794FE" opacity="1.000000" stroke="none" 
  d="
M235.019775,256.996674 
  C234.235855,256.691284 233.451920,256.385925 232.116272,255.876907 
  C231.662048,254.808319 231.759583,253.943359 231.866058,252.998962 
  C229.233063,252.998962 226.616531,252.998962 223.741608,252.718353 
  C222.846146,252.294312 222.163605,252.251434 221.580948,251.987778 
  C220.088730,251.312515 218.640930,250.539078 217.175369,249.804886 
  C218.617111,248.535629 219.866531,246.755325 221.547806,246.122589 
  C223.799606,245.275116 226.443771,245.539001 228.814560,244.922409 
  C232.162079,244.051773 235.413635,242.812210 238.706223,241.730347 
  C238.598175,241.198196 238.490128,240.666046 238.382080,240.133896 
  C236.375122,240.237473 234.120728,239.782394 232.404572,240.542542 
  C225.445740,243.624771 218.381058,243.496689 211.113373,242.240570 
  C207.446976,241.606888 203.706802,241.399918 199.666672,241.000000 
  C198.888901,241.000000 198.444443,241.000000 197.625702,240.958038 
  C193.138382,239.730362 193.224075,237.146515 195.230331,234.294312 
  C203.515091,234.716965 211.538452,235.225098 219.526001,234.887054 
  C225.729156,234.624527 231.915939,233.463242 238.048019,232.357620 
  C239.796234,232.042419 241.327866,230.526062 243.225525,229.332199 
  C246.943436,228.245804 250.394638,227.387726 253.770111,226.873657 
  C252.849213,228.155121 252.004044,229.092575 250.371048,230.903809 
  C252.785675,230.431747 253.856003,230.222504 255.325760,230.010468 
  C261.848389,228.043243 268.574921,227.754257 273.638489,222.854065 
  C274.865021,221.667084 277.316437,221.745819 279.204590,221.242523 
  C273.393982,227.166214 268.028717,233.635849 261.638153,238.848465 
  C256.082916,243.379730 249.368469,246.489822 242.580704,250.542236 
  C239.669998,252.903244 237.344879,254.949951 235.019775,256.996674 
z"/>
<path fill="#56AFFE" opacity="1.000000" stroke="none" 
  d="
M222.994507,258.988525 
  C224.525055,262.897369 222.155411,264.292786 218.991455,264.991608 
  C212.550781,266.414124 206.082275,267.710663 199.639435,269.123810 
  C199.094482,269.243347 198.656082,269.848694 197.631363,270.616455 
  C193.701340,271.375885 190.308121,271.747131 186.914902,272.118408 
  C175.883865,270.390686 164.852844,268.662964 153.419586,266.523376 
  C153.008102,265.741211 152.998871,265.370850 153.417191,264.999817 
  C157.645752,265.834290 161.420776,266.830261 165.256607,267.449768 
  C167.937744,267.882812 170.702042,267.800964 173.429184,267.949127 
  C173.728653,267.401550 174.028107,266.853943 174.327576,266.306366 
  C168.033127,265.716492 166.749588,262.457153 167.794540,257.294342 
  C168.029251,256.134735 165.849152,253.377396 164.537674,253.205017 
  C158.735580,252.442474 152.844818,252.354507 146.659744,252.014236 
  C145.927536,251.848694 145.516357,251.702621 145.124359,251.516220 
  C145.085403,251.497696 145.161026,251.101624 145.187637,251.101105 
  C150.225525,251.005463 155.263794,250.929764 160.302048,250.853394 
  C161.571732,250.283844 162.841400,249.714294 164.841309,249.062485 
  C167.044983,248.993271 168.518402,249.006332 170.003448,249.419556 
  C171.199066,250.875153 172.236969,252.502899 173.601425,252.851151 
  C175.620651,253.366501 177.871689,252.973526 180.491028,252.973175 
  C187.638474,252.986633 194.318939,252.994232 201.374146,253.005020 
  C202.498474,253.007645 203.248032,253.007095 204.166885,253.249466 
  C204.892059,253.653076 205.447922,253.813751 206.432281,253.984314 
  C210.570221,254.332153 214.279663,254.670105 218.001556,255.392166 
  C218.130249,259.240875 220.641113,258.992615 222.994507,258.988525 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M160.097809,250.504471 
  C155.263794,250.929764 150.225525,251.005463 145.187637,251.101105 
  C145.161026,251.101624 145.085403,251.497696 145.124359,251.516220 
  C145.516357,251.702621 145.927536,251.848694 146.699356,252.360718 
  C147.199066,253.715118 147.332748,254.714920 147.632706,256.958191 
  C140.331589,251.570084 134.570984,252.165298 129.577942,258.997314 
  C127.783058,258.991547 126.402390,258.985992 124.954666,258.625366 
  C121.212799,254.362686 117.640968,256.844421 114.054932,258.444916 
  C107.009949,257.986694 99.964966,257.528473 92.531631,256.654816 
  C93.259598,255.510818 94.375923,254.782257 96.367569,253.482422 
  C87.445534,253.482422 79.566742,253.482422 71.687950,253.482422 
  C71.668251,253.715881 71.648544,253.949341 71.628845,254.182800 
  C74.140129,254.876099 76.651413,255.569397 79.162689,256.262695 
  C73.416832,258.942139 67.874962,257.822632 61.476131,255.717331 
  C68.242393,247.103363 76.222633,242.242172 86.604774,240.741364 
  C89.421501,241.594070 91.747795,242.117706 94.074097,242.641327 
  C100.782188,243.442734 107.479492,244.352203 114.200592,245.023361 
  C128.878250,246.489059 143.568848,247.824997 158.249664,249.259933 
  C158.821350,249.315796 159.346664,249.846237 160.097809,250.504471 
z"/>
<path fill="#66BAFE" opacity="1.000000" stroke="none" 
  d="
M305.992828,247.992554 
  C308.755219,246.732452 311.789642,245.837921 314.170929,244.065720 
  C315.457977,243.107864 315.629242,240.650757 316.632874,238.001556 
  C308.327606,241.198669 307.372131,240.748154 302.182617,232.322693 
  C300.604034,232.392853 299.025421,232.463287 297.306366,231.881989 
  C306.604340,228.610214 316.104065,226.727020 325.918701,228.987518 
  C329.477600,229.807205 333.116119,230.569122 333.770447,235.150009 
  C333.695923,235.861511 333.847351,236.429184 334.176697,237.271820 
  C334.732574,237.765167 335.110504,237.983536 335.488464,238.201904 
  C334.869629,239.804062 334.250793,241.406219 333.305298,242.777435 
  C332.773041,241.453400 332.567474,240.360321 332.361908,239.267242 
  C331.667755,239.178223 330.973602,239.089188 330.279449,239.000153 
  C329.520447,241.666565 328.761444,244.332977 327.856750,247.299622 
  C325.043091,250.017288 322.360748,252.419113 319.711243,254.856644 
  C317.127563,257.233612 314.577484,259.647064 312.012634,262.044495 
  C305.923187,264.515747 299.833771,266.987000 293.744324,269.458282 
  C293.519440,269.063995 293.294586,268.669739 293.069702,268.275452 
  C296.152710,263.369293 299.235718,258.463104 302.608704,253.000641 
  C303.930084,250.960419 304.961456,249.476486 305.992828,247.992554 
z"/>
<path fill="#2078FC" opacity="1.000000" stroke="none" 
  d="
M127.613075,99.032547 
  C128.201706,106.871788 129.405289,114.780006 124.319984,122.217285 
  C123.153252,124.010719 122.696762,125.649429 122.240273,127.288139 
  C122.240273,127.288139 122.210464,127.149765 121.880890,127.119370 
  C121.035027,127.060135 120.518753,127.031311 119.685410,126.834991 
  C117.728516,125.113884 116.233528,123.355270 114.407547,122.065117 
  C112.631569,120.810303 110.474281,120.110283 108.560661,119.031425 
  C106.021149,117.599724 103.713013,115.572151 101.014954,114.658157 
  C98.195610,113.703087 96.184853,112.962090 95.392303,109.546967 
  C95.045403,108.052139 92.095314,107.149284 90.309746,106.005020 
  C89.222572,105.308311 88.101898,104.663872 86.998886,103.747070 
  C87.001503,103.498184 87.001244,103.000290 87.355408,102.965340 
  C92.806252,99.953194 97.902939,96.975998 103.181328,94.329575 
  C109.052422,97.803398 114.697266,97.884239 119.731461,93.870583 
  C121.579681,97.906883 123.130219,101.293106 124.828781,105.002579 
  C125.977493,102.539520 126.795280,100.786034 127.613075,99.032547 
z"/>
<path fill="#1C71F9" opacity="1.000000" stroke="none" 
  d="
M86.996269,103.995956 
  C88.101898,104.663872 89.222572,105.308311 90.309746,106.005020 
  C92.095314,107.149284 95.045403,108.052139 95.392303,109.546967 
  C96.184853,112.962090 98.195610,113.703087 101.014954,114.658157 
  C103.713013,115.572151 106.021149,117.599724 108.560661,119.031425 
  C110.474281,120.110283 112.631569,120.810303 114.407547,122.065117 
  C116.233528,123.355270 117.728516,125.113884 119.728592,127.278999 
  C120.357239,128.413971 120.625641,128.937439 120.894043,129.460907 
  C120.894043,129.460907 120.753387,129.712677 120.302544,129.560928 
  C118.949577,130.998749 118.047447,132.588318 117.145325,134.177887 
  C117.145325,134.177887 117.098763,134.094482 116.879898,134.179810 
  C116.473679,134.574661 116.286331,134.884201 116.098984,135.193726 
  C116.098976,135.193726 116.079277,135.079193 115.869446,135.174622 
  C115.477791,135.584335 115.295982,135.898636 115.114182,136.212936 
  C115.114182,136.212936 115.109299,136.109497 114.763626,136.087128 
  C113.343025,137.130692 112.268105,138.196625 111.193176,139.262558 
  C111.193176,139.262558 111.152679,139.261566 111.175171,139.270020 
  C110.400566,139.187241 109.603485,139.095978 108.404114,139.001434 
  C108.256851,135.985092 106.269646,135.873001 104.111725,136.002930 
  C101.995956,136.130310 99.881363,136.277023 98.812462,136.346863 
  C97.486343,133.200150 96.653908,130.204056 94.996895,127.769104 
  C94.281670,126.718079 91.691002,126.163963 90.247879,126.534706 
  C86.027557,127.618904 83.743332,126.868408 83.903725,122.002914 
  C83.934280,121.076057 83.032494,120.118462 82.377853,118.808960 
  C80.540474,120.424973 79.120850,121.673553 77.352036,122.532684 
  C77.608955,118.024048 78.215065,113.904854 78.821182,109.785667 
  C78.821182,109.785667 78.845161,109.914284 79.178223,109.879944 
  C79.957855,108.833336 80.404419,107.821060 80.850983,106.808784 
  C80.850975,106.808784 80.901596,106.896088 81.113693,106.823082 
  C81.538986,106.465965 81.752182,106.181862 81.965385,105.897751 
  C81.965385,105.897751 81.973564,105.976807 82.297318,105.927200 
  C83.041557,105.366966 83.462036,104.856339 83.882515,104.345703 
  C83.882515,104.345703 83.957413,104.050484 84.448380,104.019699 
  C85.624992,103.991264 86.310631,103.993607 86.996269,103.995956 
z"/>
<path fill="#3296FF" opacity="1.000000" stroke="none" 
  d="
M291.274658,75.896667 
  C291.274658,75.896667 291.620361,75.874794 291.941833,76.216393 
  C296.178528,79.702896 300.093811,82.847801 304.005951,86.368958 
  C304.001495,87.497414 304.000153,88.249619 303.648132,88.942291 
  C302.426483,87.984779 301.154175,86.158844 300.747528,86.334694 
  C297.296753,87.826958 295.709137,85.377937 293.697815,83.542656 
  C293.178406,83.068703 292.035919,82.846542 291.346802,83.056747 
  C284.939362,85.011215 280.686615,80.716072 275.528351,78.312439 
  C268.370789,74.977173 260.688538,70.070488 252.730469,77.368622 
  C251.845566,78.180130 249.885315,77.837173 248.420013,77.994659 
  C240.176147,78.880638 231.914642,79.631340 223.697433,80.717682 
  C221.494171,81.008957 219.465347,82.442375 217.285217,83.123459 
  C212.945419,84.479240 209.293213,89.133446 204.028915,85.630035 
  C205.026047,84.477051 205.855682,83.302483 206.950821,82.947868 
  C217.258911,79.609993 227.477234,75.853676 237.985962,73.311409 
  C251.963333,69.930008 266.190735,69.573433 280.323425,72.996307 
  C283.992737,73.885002 287.625244,74.925751 291.274658,75.896667 
z"/>
<path fill="#66BAFE" opacity="1.000000" stroke="none" 
  d="
M191.106750,67.034996 
  C191.156296,65.614876 191.205841,64.194756 191.732574,62.285446 
  C192.806808,59.555038 193.894623,57.316338 193.906097,55.072132 
  C193.936752,49.075912 197.105240,45.297638 201.747086,42.189480 
  C206.873795,38.756645 212.581085,38.633530 218.372025,39.038204 
  C222.687607,39.339783 224.879395,43.903881 222.890808,47.688473 
  C220.246445,52.721111 214.845795,52.848854 210.642319,55.168888 
  C206.821487,57.277721 203.580338,60.436821 200.083649,63.132935 
  C200.083649,63.132931 200.038696,63.039684 199.712112,63.065964 
  C197.890839,64.362900 195.918442,65.362198 195.008072,66.964790 
  C193.456467,69.696167 192.422211,68.458664 191.106750,67.034996 
z"/>
<path fill="#68BBFE" opacity="1.000000" stroke="none" 
  d="
M200.046448,26.145508 
  C195.514862,32.330788 190.983261,38.516068 186.592636,44.508934 
  C179.378677,35.995846 178.899872,20.721741 186.708572,14.388653 
  C189.169357,14.817145 191.414337,15.598523 193.238129,15.029623 
  C197.224762,13.786062 201.339020,16.623007 200.856445,20.812641 
  C200.650833,22.597679 200.320236,24.368320 200.046448,26.145508 
z"/>
<path fill="#64B7FE" opacity="1.000000" stroke="none" 
  d="
M67.148041,190.823029 
  C69.021568,192.669418 71.087143,194.360657 72.729683,196.393677 
  C76.452591,201.001602 74.036850,207.265579 68.140762,207.821930 
  C59.579620,208.629776 52.208946,206.049820 47.215195,198.392609 
  C48.009678,196.713959 48.311188,195.309967 49.091366,194.262512 
  C50.016655,193.020233 51.477562,191.069458 52.491623,191.192688 
  C56.853230,191.722717 61.420235,188.164108 65.622055,191.770981 
  C65.758736,191.888321 66.622963,191.158127 67.148041,190.823029 
z"/>
<path fill="#3989FA" opacity="1.000000" stroke="none" 
  d="
M291.091156,75.590538 
  C287.625244,74.925751 283.992737,73.885002 280.323425,72.996307 
  C266.190735,69.573433 251.963333,69.930008 237.985962,73.311409 
  C227.477234,75.853676 217.258911,79.609993 206.950821,82.947868 
  C205.855682,83.302483 205.026047,84.477051 203.629700,85.631447 
  C194.612732,88.313522 187.664276,93.410843 180.774811,99.093964 
  C180.280777,99.404259 180.092026,99.666458 179.649185,100.025482 
  C177.538132,101.370407 175.766693,102.680084 173.701447,104.131958 
  C172.274841,104.849297 171.141998,105.424446 170.009155,105.999603 
  C169.335617,106.320580 168.662079,106.641548 167.710205,106.998825 
  C170.985184,103.969093 174.365524,100.670395 178.122070,97.877777 
  C193.430786,86.497292 209.902145,77.265732 228.548340,72.626358 
  C245.569702,68.391251 262.852600,67.335220 280.160645,70.675514 
  C283.900177,71.397202 287.333374,73.706421 291.091156,75.590538 
z"/>
<path fill="#2981FC" opacity="1.000000" stroke="none" 
  d="
M127.662033,98.744965 
  C126.795280,100.786034 125.977493,102.539520 124.828781,105.002579 
  C123.130219,101.293106 121.579681,97.906883 119.731461,93.870583 
  C114.697266,97.884239 109.052422,97.803398 103.329803,94.027458 
  C106.034531,90.924377 108.806160,88.488884 111.451378,85.923065 
  C111.681946,85.699417 111.080734,84.618248 110.865875,83.935387 
  C110.903793,83.775589 110.904457,83.593468 110.984947,83.459198 
  C115.117348,76.565636 116.000206,76.436142 120.449997,82.967186 
  C122.636002,86.175621 124.238724,89.781456 125.812813,93.618759 
  C125.221092,94.742622 124.520088,95.629272 124.732727,96.120178 
  C124.958015,96.640282 126.051811,96.784195 126.766281,97.092407 
  C127.081184,97.547401 127.396088,98.002396 127.662033,98.744965 
z"/>
<path fill="#1C4FC4" opacity="1.000000" stroke="none" 
  d="
M122.066528,211.845627 
  C117.642357,209.776260 113.210861,207.722382 108.795319,205.634766 
  C92.478798,197.920609 85.847443,183.086380 80.583466,167.244278 
  C79.816284,164.935440 78.976242,162.650787 77.765068,160.254669 
  C77.360222,160.154404 77.360626,160.129654 77.702576,160.118408 
  C79.377220,161.390488 80.709923,162.673828 82.031952,164.344864 
  C84.676064,170.498016 87.330841,176.263458 89.991074,182.394852 
  C93.524620,187.616928 96.599129,192.911514 100.730095,197.184845 
  C103.810860,200.371796 108.424568,204.478729 112.059326,204.207397 
  C118.763275,203.706909 121.994560,209.403976 128.616241,209.331329 
  C126.623016,210.879288 125.743797,211.562103 124.507370,212.233490 
  C123.455605,212.096588 122.761070,211.971100 122.066528,211.845627 
z"/>
<path fill="#6BBDFD" opacity="1.000000" stroke="none" 
  d="
M35.119495,208.809158 
  C38.770824,210.251190 41.101959,213.348495 40.276733,216.807083 
  C39.307720,220.868286 35.370472,222.869034 31.238636,221.974594 
  C26.459747,220.940094 20.700459,221.420547 18.394514,215.286728 
  C21.930399,209.266510 24.028889,208.486771 31.583040,209.676575 
  C32.688885,209.850754 33.937138,209.120773 35.119495,208.809158 
z"/>
<path fill="#56AFFE" opacity="1.000000" stroke="none" 
  d="
M279.500397,221.083603 
  C277.316437,221.745819 274.865021,221.667084 273.638489,222.854065 
  C268.574921,227.754257 261.848389,228.043243 255.352371,229.623993 
  C255.661682,228.480637 256.199097,227.425827 257.049286,227.008911 
  C262.866394,224.156464 268.891846,221.693069 274.533752,218.538498 
  C276.525116,217.425064 277.630920,214.727829 279.141022,212.753708 
  C279.141022,212.753708 279.323090,212.729248 279.767334,212.848007 
  C282.809937,211.650208 285.408325,210.333633 288.050568,209.335739 
  C288.977448,209.700455 290.230255,210.148727 290.685883,209.729874 
  C294.897369,205.858185 298.881775,201.737183 303.136810,197.916519 
  C304.503265,196.689529 306.478455,196.140472 308.175140,195.281265 
  C301.010101,206.368454 290.442444,213.690048 279.500397,221.083603 
z"/>
<path fill="#2D6EEA" opacity="1.000000" stroke="none" 
  d="
M67.083969,126.501450 
  C60.264099,125.527641 53.338463,123.984184 46.332367,123.033913 
  C39.073730,122.049377 31.723299,121.759529 24.441429,120.919548 
  C21.564013,120.587616 18.763285,119.590874 15.435736,118.776466 
  C14.151996,126.330833 17.180996,132.411621 19.638802,138.836716 
  C19.963755,139.754547 19.967468,140.490616 19.635578,141.633789 
  C19.076981,142.064621 18.853983,142.088333 18.630983,142.112045 
  C14.419190,135.536636 12.586879,128.333115 12.933830,120.552406 
  C13.105129,116.710899 14.832852,116.108986 18.525156,116.907974 
  C24.723671,118.249268 31.080376,118.933586 37.400063,119.623909 
  C47.500893,120.727234 57.796295,120.838722 67.083969,126.501450 
z"/>
<path fill="#64B2FC" opacity="1.000000" stroke="none" 
  d="
M200.429657,63.053837 
  C203.580338,60.436821 206.821487,57.277721 210.642319,55.168888 
  C214.845795,52.848854 220.246445,52.721111 222.890808,47.688473 
  C224.879395,43.903881 222.687607,39.339783 218.372025,39.038204 
  C212.581085,38.633530 206.873795,38.756645 201.747086,42.189480 
  C197.105240,45.297638 193.936752,49.075912 193.906097,55.072132 
  C193.894623,57.316338 192.806808,59.555038 191.877075,61.883625 
  C190.067764,47.145786 199.003082,36.510090 213.793884,35.487526 
  C218.529938,35.160099 224.566238,38.872608 225.771774,42.854305 
  C226.975998,46.831654 224.665421,51.390263 219.489929,54.071278 
  C213.359512,57.246956 207.022903,60.024582 200.429657,63.053837 
z"/>
<path fill="#56AFFE" opacity="1.000000" stroke="none" 
  d="
M226.991455,271.012207 
  C228.435181,270.341431 229.819305,269.328979 231.333939,269.064728 
  C235.665131,268.309113 240.049301,267.857361 244.412643,267.286102 
  C244.113785,266.694336 243.814926,266.102570 243.516068,265.510803 
  C245.115158,264.039429 246.480347,261.877106 248.361908,261.240143 
  C252.304138,259.905548 253.927292,261.138580 255.895157,265.528717 
  C263.481598,263.648865 271.035767,261.756012 278.601746,259.911835 
  C281.943512,259.097321 285.309326,258.381470 288.910889,257.941589 
  C269.511597,266.358521 248.783417,269.686707 227.428772,271.850922 
  C226.992447,271.355316 226.991959,271.183746 226.991455,271.012207 
z"/>
<path fill="#2663E1" opacity="1.000000" stroke="none" 
  d="
M18.741194,142.450928 
  C18.853983,142.088333 19.076981,142.064621 19.633770,142.002106 
  C23.777113,145.877274 27.586658,149.791275 32.080647,153.855820 
  C33.570976,154.119247 34.546440,153.977203 35.157177,154.383469 
  C43.609806,160.006012 53.149574,161.561142 63.007561,161.983246 
  C67.420471,160.685333 71.833374,159.387421 76.633766,158.408768 
  C77.134377,159.195236 77.247505,159.662445 77.360626,160.129654 
  C77.360626,160.129654 77.360222,160.154404 77.372009,160.134613 
  C59.634052,170.492554 27.896721,160.367249 18.741194,142.450928 
z"/>
<path fill="#64B2FC" opacity="1.000000" stroke="none" 
  d="
M335.672943,237.870087 
  C335.110504,237.983536 334.732574,237.765167 334.176941,236.940033 
  C333.998260,235.890915 333.997284,235.448532 333.996338,235.006165 
  C333.116119,230.569122 329.477600,229.807205 325.918701,228.987518 
  C316.104065,226.727020 306.604340,228.610214 297.081116,231.613892 
  C291.886993,233.542801 286.779907,235.095566 281.665375,236.623520 
  C281.041229,236.809982 280.377258,236.863251 279.329041,236.975494 
  C288.111694,233.393646 297.163544,229.403381 306.524353,226.364883 
  C314.081970,223.911713 321.870544,224.316193 329.501678,227.232498 
  C334.481903,229.135757 336.642975,232.310028 335.672943,237.870087 
z"/>
<path fill="#64B7FE" opacity="1.000000" stroke="none" 
  d="
M340.212677,194.558640 
  C340.813416,195.473709 341.414124,196.388794 341.738037,197.884323 
  C341.689911,199.996506 341.918579,201.528244 342.147217,203.059982 
  C340.405457,204.768692 338.846069,206.745743 336.860229,208.095337 
  C335.446136,209.056381 333.458130,209.172989 331.397766,209.222382 
  C333.686462,207.288101 336.303711,205.797897 339.437683,204.013458 
  C337.788879,202.215851 336.687164,200.850143 335.410492,199.674484 
  C334.373444,198.719482 332.453003,197.061996 332.089050,197.325378 
  C330.509308,198.468750 328.654266,200.029861 328.229370,201.764862 
  C327.720184,203.843918 328.563934,206.254303 328.821777,208.521210 
  C324.558167,207.661072 322.505524,204.403427 322.399078,200.704849 
  C322.289062,196.880341 324.005646,193.278000 328.613464,192.128448 
  C331.013123,195.024307 337.367340,196.197205 340.212677,194.558640 
z"/>
<path fill="#5DB6FE" opacity="1.000000" stroke="none" 
  d="
M308.444336,195.088196 
  C306.478455,196.140472 304.503265,196.689529 303.136810,197.916519 
  C298.881775,201.737183 294.897369,205.858185 290.685883,209.729874 
  C290.230255,210.148727 288.977448,209.700455 288.349121,209.180542 
  C289.689667,207.079849 290.775482,205.453033 291.861298,203.826202 
  C291.861298,203.826202 291.930176,203.848816 292.292725,203.910416 
  C296.550293,202.965439 296.964630,202.382431 295.672150,199.726959 
  C300.803864,193.061447 305.935577,186.395950 311.500488,180.083817 
  C311.956665,181.638336 311.979645,182.839462 311.998962,184.407349 
  C311.723907,186.881821 311.452515,188.989517 311.181091,191.097214 
  C310.358582,192.363190 309.536041,193.629150 308.444336,195.088196 
z"/>
<path fill="#75C2FE" opacity="1.000000" stroke="none" 
  d="
M273.661530,239.149902 
  C272.991089,240.873520 272.061279,242.754822 270.905518,244.485168 
  C270.495422,245.099121 269.235413,245.169586 268.872711,245.787231 
  C265.233215,251.985138 258.084442,251.195053 252.214813,253.737900 
  C251.135178,252.681610 250.598907,251.887161 250.062637,251.092712 
  C257.812775,247.144485 265.562958,243.196274 273.661530,239.149902 
z"/>
<path fill="#56AFFE" opacity="1.000000" stroke="none" 
  d="
M311.422668,190.863068 
  C311.452515,188.989517 311.723907,186.881821 312.302155,184.241089 
  C315.745026,176.800552 318.881073,169.893036 322.023804,162.667389 
  C322.040710,161.924942 322.050903,161.500641 322.313416,160.860229 
  C323.067535,159.410995 323.569336,158.177856 324.361572,156.953094 
  C325.228333,156.955399 325.804688,156.949371 326.381012,156.943329 
  C324.578796,169.527679 319.097992,180.504913 311.422668,190.863068 
z"/>
<path fill="#50A0FA" opacity="1.000000" stroke="none" 
  d="
M66.948578,190.532242 
  C66.622963,191.158127 65.758736,191.888321 65.622055,191.770981 
  C61.420235,188.164108 56.853230,191.722717 52.491623,191.192688 
  C51.477562,191.069458 50.016655,193.020233 49.091366,194.262512 
  C48.311188,195.309967 48.009678,196.713959 47.097572,198.068329 
  C43.944229,194.301514 47.213646,187.920502 52.854908,187.072357 
  C57.735882,186.338501 62.830395,186.097809 66.948578,190.532242 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M328.928314,208.776459 
  C328.563934,206.254303 327.720184,203.843918 328.229370,201.764862 
  C328.654266,200.029861 330.509308,198.468750 332.089050,197.325378 
  C332.453003,197.061996 334.373444,198.719482 335.410492,199.674484 
  C336.687164,200.850143 337.788879,202.215851 339.437683,204.013458 
  C336.303711,205.797897 333.686462,207.288101 331.058899,209.118866 
  C330.377350,209.316864 329.706085,209.174286 328.928314,208.776459 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M117.010910,216.043503 
  C118.537178,216.193680 120.063446,216.343857 122.098862,216.116989 
  C123.403694,214.833679 124.199387,213.927399 125.416794,212.992493 
  C127.232666,213.144318 128.626816,213.324783 129.934021,213.814697 
  C129.155182,215.191025 128.606781,216.394775 127.744331,217.298965 
  C125.231834,219.933014 122.593727,222.447250 120.002617,224.612152 
  C120.854668,219.813004 116.263832,221.889420 115.137390,219.716522 
  C115.855629,218.295975 116.433273,217.169739 117.010910,216.043503 
z"/>
<path fill="#64B2FC" opacity="1.000000" stroke="none" 
  d="
M200.360825,25.950352 
  C200.320236,24.368320 200.650833,22.597679 200.856445,20.812641 
  C201.339020,16.623007 197.224762,13.786062 193.238129,15.029623 
  C191.414337,15.598523 189.169357,14.817145 187.034973,14.267015 
  C191.619751,10.068591 196.624786,9.734098 200.195450,13.000951 
  C203.922272,16.410715 204.076721,20.516506 200.360825,25.950352 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M226.523712,271.005188 
  C226.991959,271.183746 226.992447,271.355316 227.005478,271.783997 
  C213.916275,272.152039 200.814514,272.262909 187.313843,272.246094 
  C190.308121,271.747131 193.701340,271.375885 197.548920,270.998047 
  C207.354187,270.993683 216.705078,270.995911 226.523712,271.005188 
z"/>
<path fill="#64B2FC" opacity="1.000000" stroke="none" 
  d="
M125.021721,258.980408 
  C126.402390,258.985992 127.783058,258.991547 129.859833,259.287750 
  C138.033829,261.385773 145.511719,263.193146 152.989624,265.000519 
  C152.998871,265.370850 153.008102,265.741211 153.026093,266.388550 
  C142.140717,264.316345 131.246613,261.967163 120.553436,259.308960 
  C122.176819,258.993439 123.599274,258.986908 125.021721,258.980408 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M79.562584,256.265198 
  C76.651413,255.569397 74.140129,254.876099 71.628845,254.182800 
  C71.648544,253.949341 71.668251,253.715881 71.687950,253.482422 
  C79.566742,253.482422 87.445534,253.482422 96.367569,253.482422 
  C94.375923,254.782257 93.259598,255.510818 92.074509,256.582489 
  C87.991325,256.706299 83.976898,256.487000 79.562584,256.265198 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M139.154419,40.337704 
  C149.127441,40.830532 159.107040,42.154491 167.820160,47.962662 
  C168.680481,48.536152 169.194016,49.629868 169.823608,50.851620 
  C161.667648,44.675148 151.294754,44.841217 141.988174,41.841877 
  C141.059113,41.542461 140.186050,41.069351 139.154419,40.337704 
z"/>
<path fill="#56AFFE" opacity="1.000000" stroke="none" 
  d="
M305.932495,247.641113 
  C304.961456,249.476486 303.930084,250.960419 302.633698,252.611267 
  C298.919800,254.255768 295.470947,255.733368 291.660706,257.211975 
  C291.665192,255.597046 291.487640,253.271439 292.498260,252.497589 
  C295.594879,250.126465 299.081360,248.220627 302.574951,246.446350 
  C303.335175,246.060257 304.755707,246.974411 305.932495,247.641113 
z"/>
<path fill="#3989FA" opacity="1.000000" stroke="none" 
  d="
M304.009064,85.992722 
  C300.093811,82.847801 296.178528,79.702896 292.112305,76.246986 
  C295.776031,77.854561 300.056274,79.202217 303.287170,81.836754 
  C307.294250,85.104225 310.432343,89.437393 313.760040,93.654037 
  C313.374359,93.999100 313.174469,94.000351 312.638611,93.951508 
  C309.538147,91.265190 306.773590,88.628952 304.009064,85.992722 
z"/>
<path fill="#1C71F9" opacity="1.000000" stroke="none" 
  d="
M110.569504,84.083153 
  C111.080734,84.618248 111.681946,85.699417 111.451378,85.923065 
  C108.806160,88.488884 106.034531,90.924377 103.148102,93.696686 
  C97.902939,96.975998 92.806252,99.953194 87.036598,102.943108 
  C86.152618,102.926498 85.941605,102.897171 85.730591,102.867859 
  C91.574417,98.701668 97.472176,94.608253 103.236893,90.335350 
  C105.724075,88.491814 107.936104,86.277039 110.569504,84.083153 
z"/>
<path fill="#2981FC" opacity="1.000000" stroke="none" 
  d="
M320.227020,105.795280 
  C322.539551,113.140663 324.852081,120.486046 327.153198,128.501572 
  C327.192871,129.516052 327.369232,129.774979 327.670898,129.948502 
  C327.851471,131.692123 328.032013,133.435745 327.750641,135.561813 
  C326.852417,135.941589 326.416138,135.938919 325.870178,135.730515 
  C325.562988,135.268936 325.309906,135.093079 325.001312,134.596313 
  C324.996613,133.126328 324.991852,132.057251 324.989746,130.539993 
  C324.325562,125.876343 323.809326,121.629776 322.947601,117.454514 
  C322.152069,113.600121 320.985901,109.822227 320.044159,105.957008 
  C320.105347,105.903374 320.227020,105.795280 320.227020,105.795280 
z"/>
<path fill="#ABDDFE" opacity="1.000000" stroke="none" 
  d="
M249.656647,251.048492 
  C250.598907,251.887161 251.135178,252.681610 251.833145,253.736832 
  C246.576782,255.034897 241.158707,256.072174 235.380219,257.053070 
  C237.344879,254.949951 239.669998,252.903244 242.327469,250.798065 
  C244.856766,250.827820 247.053696,250.916061 249.656647,251.048492 
z"/>
<path fill="#64B2FC" opacity="1.000000" stroke="none" 
  d="
M312.377441,262.032532 
  C314.577484,259.647064 317.127563,257.233612 319.711243,254.856644 
  C322.360748,252.419113 325.043091,250.017288 328.208679,247.141449 
  C329.720123,245.795380 330.734009,244.907730 331.747894,244.020081 
  C331.451782,245.358032 331.618378,247.260834 330.785278,247.943268 
  C324.885773,252.775879 318.781342,257.358337 312.377441,262.032532 
z"/>
<path fill="#D5E9FB" opacity="1.000000" stroke="none" 
  d="
M114.996780,220.010834 
  C116.263832,221.889420 120.854668,219.813004 119.750183,224.781464 
  C118.992096,226.228546 118.484200,227.110001 117.659012,228.035904 
  C116.894341,228.717804 116.446945,229.355255 115.671707,230.003555 
  C114.906952,230.014771 114.470024,230.015137 114.033104,230.015503 
  C115.106003,223.205063 115.106003,223.205063 106.779587,219.665543 
  C107.449608,219.237671 108.297699,219.116531 109.820992,219.273193 
  C111.996384,219.704254 113.496582,219.857544 114.996780,220.010834 
z"/>
<path fill="#64B2FC" opacity="1.000000" stroke="none" 
  d="
M34.826931,208.556854 
  C33.937138,209.120773 32.688885,209.850754 31.583040,209.676575 
  C24.028889,208.486771 21.930399,209.266510 18.377026,214.931458 
  C16.730528,210.559906 19.393806,207.939819 22.956806,207.417816 
  C26.692503,206.870514 30.665234,207.941071 34.826931,208.556854 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M340.076904,194.256897 
  C337.367340,196.197205 331.013123,195.024307 328.985291,192.115051 
  C333.419556,188.664978 335.456787,189.076004 340.076904,194.256897 
z"/>
<path fill="#64B2FC" opacity="1.000000" stroke="none" 
  d="
M170.877228,29.688097 
  C170.569077,30.010067 170.130081,30.122177 169.920135,29.951899 
  C164.862244,25.849785 159.828842,21.717480 154.887054,17.311459 
  C162.162537,18.702099 166.848022,23.585951 170.877228,29.688097 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M326.541138,156.539551 
  C325.804688,156.949371 325.228333,156.955399 324.351654,156.627762 
  C324.045929,155.858719 324.040527,155.423340 324.076416,154.623810 
  C324.371643,152.832550 324.625641,151.405441 324.910431,149.609039 
  C324.931976,148.498749 324.922699,147.757736 324.939575,146.643585 
  C324.959381,145.523422 324.953003,144.776382 325.009552,143.684601 
  C326.038330,142.891586 327.004211,142.443344 327.970062,141.995087 
  C327.547150,146.708633 327.124207,151.422211 326.541138,156.539551 
z"/>
<path fill="#64B2FC" opacity="1.000000" stroke="none" 
  d="
M191.025421,67.455429 
  C192.422211,68.458664 193.456467,69.696167 195.008072,66.964790 
  C195.918442,65.362198 197.890839,64.362900 199.758514,63.088875 
  C197.797455,66.869659 195.463379,70.653801 193.129318,74.437943 
  C192.529327,74.232635 191.929321,74.027328 191.329330,73.822021 
  C191.200928,71.839966 191.072510,69.857910 191.025421,67.455429 
z"/>
<path fill="#1967F0" opacity="1.000000" stroke="none" 
  d="
M78.490555,109.920853 
  C78.215065,113.904854 77.608955,118.024048 77.003914,122.570244 
  C76.626869,124.607788 76.248749,126.218330 75.514053,127.911957 
  C75.207497,121.856239 73.161987,115.366707 78.490555,109.920853 
z"/>
<path fill="#56AFFE" opacity="1.000000" stroke="none" 
  d="
M328.214813,141.734955 
  C327.004211,142.443344 326.038330,142.891586 324.690582,143.645645 
  C323.264740,142.979126 322.220764,142.006790 321.176788,141.034454 
  C321.123230,140.866364 321.069641,140.698273 321.357117,140.270874 
  C322.131531,140.014786 322.564819,140.017990 323.204803,140.279938 
  C324.270325,140.655762 325.129211,140.772812 326.193665,140.814529 
  C326.665924,140.565079 326.802032,140.318802 326.835876,139.648819 
  C326.569366,138.176910 326.274628,137.056580 325.979858,135.936249 
  C326.416138,135.938919 326.852417,135.941589 327.613251,135.981873 
  C328.111725,137.837952 328.285645,139.656387 328.214813,141.734955 
z"/>
<path fill="#5DB6FE" opacity="1.000000" stroke="none" 
  d="
M124.954666,258.625366 
  C123.599274,258.986908 122.176819,258.993439 120.324898,259.006042 
  C118.167374,258.915527 116.439316,258.818970 114.383102,258.583679 
  C117.640968,256.844421 121.212799,254.362686 124.954666,258.625366 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M331.822571,243.928406 
  C330.734009,244.907730 329.720123,245.795380 328.354370,246.841202 
  C328.761444,244.332977 329.520447,241.666565 330.279449,239.000153 
  C330.973602,239.089188 331.667755,239.178223 332.361908,239.267242 
  C332.567474,240.360321 332.773041,241.453400 332.969604,242.952240 
  C332.606140,243.517578 332.251709,243.677155 331.822571,243.928406 
z"/>
<path fill="#2981FC" opacity="1.000000" stroke="none" 
  d="
M312.974548,94.001602 
  C313.174469,94.000351 313.374359,93.999100 313.874207,93.985229 
  C315.851135,96.670464 317.528137,99.368317 319.146729,102.492310 
  C319.088287,102.918449 318.971771,103.026588 318.661499,102.983856 
  C317.568268,102.292038 316.785339,101.642967 315.973297,100.667221 
  C315.292084,99.222504 314.640015,98.104469 313.862000,96.693336 
  C313.482208,95.600700 313.228394,94.801147 312.974548,94.001602 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M170.831833,52.564896 
  C177.044647,50.962616 177.044647,50.962616 175.874207,56.812092 
  C174.168579,55.759476 172.529572,54.323750 170.831833,52.564896 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M94.050995,242.267929 
  C91.747795,242.117706 89.421501,241.594070 86.970535,240.754410 
  C87.331276,239.982773 87.816689,239.527176 88.645355,239.018539 
  C91.053795,239.278748 94.096817,237.909607 94.050995,242.267929 
z"/>
<path fill="#E7EEFA" opacity="1.000000" stroke="none" 
  d="
M115.137390,219.716522 
  C113.496582,219.857544 111.996384,219.704254 110.247635,219.271454 
  C112.095802,218.025192 114.192513,217.058441 116.650070,216.067596 
  C116.433273,217.169739 115.855629,218.295975 115.137390,219.716522 
z"/>
<path fill="#2D6EEA" opacity="1.000000" stroke="none" 
  d="
M71.176117,129.568054 
  C69.916862,129.099869 68.527176,128.318588 67.160797,127.148056 
  C68.471298,127.590858 69.758499,128.422913 71.176117,129.568054 
z"/>
<path fill="#E7EEFA" opacity="1.000000" stroke="none" 
  d="
M124.995079,213.021118 
  C124.199387,213.927399 123.403694,214.833679 122.310211,215.870026 
  C122.014641,214.892044 122.016853,213.783981 122.042801,212.260773 
  C122.761070,211.971100 123.455605,212.096588 124.534874,212.428345 
  C124.919601,212.634598 124.995079,213.021118 124.995079,213.021118 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M342.369324,202.793823 
  C341.918579,201.528244 341.689911,199.996506 341.735596,198.230438 
  C342.203796,199.506622 342.397614,201.017151 342.369324,202.793823 
z"/>
<path fill="#2078FC" opacity="1.000000" stroke="none" 
  d="
M126.798500,96.765633 
  C126.051811,96.784195 124.958015,96.640282 124.732727,96.120178 
  C124.520088,95.629272 125.221092,94.742622 125.831284,93.989182 
  C126.371819,94.778481 126.601273,95.608673 126.798500,96.765633 
z"/>
<path fill="#1B6AF2" opacity="1.000000" stroke="none" 
  d="
M117.452766,134.051697 
  C118.047447,132.588318 118.949577,130.998749 120.189827,129.650879 
  C119.605370,131.236877 118.682785,132.581192 117.452766,134.051697 
z"/>
<path fill="#1B6AF2" opacity="1.000000" stroke="none" 
  d="
M111.532150,139.260590 
  C112.268105,138.196625 113.343025,137.130692 114.806900,136.115570 
  C114.087608,137.197128 112.979370,138.227875 111.532150,139.260590 
z"/>
<path fill="#1B6AF2" opacity="1.000000" stroke="none" 
  d="
M122.591301,127.168808 
  C122.696762,125.649429 123.153252,124.010719 123.944748,122.213661 
  C123.833946,123.720032 123.388138,125.384750 122.591301,127.168808 
z"/>
<path fill="#1967F0" opacity="1.000000" stroke="none" 
  d="
M80.549232,106.929535 
  C80.404419,107.821060 79.957855,108.833336 79.130905,109.834785 
  C79.249504,108.899406 79.748497,107.974846 80.549232,106.929535 
z"/>
<path fill="#E7EEFA" opacity="1.000000" stroke="none" 
  d="
M102.001686,218.320969 
  C101.499695,218.498886 100.931969,218.431442 100.201965,218.109528 
  C100.671776,217.928589 101.303856,218.002090 102.001686,218.320969 
z"/>
<path fill="#1B6AF2" opacity="1.000000" stroke="none" 
  d="
M121.137329,129.320679 
  C120.625641,128.937439 120.357239,128.413971 120.045654,127.446487 
  C120.518753,127.031311 121.035027,127.060135 121.933922,127.166237 
  C122.004555,127.889153 121.692581,128.534790 121.137329,129.320679 
z"/>
<path fill="#E7EEFA" opacity="1.000000" stroke="none" 
  d="
M68.837189,218.760422 
  C68.510208,219.265137 68.021729,219.552277 67.241577,219.785126 
  C67.525162,219.334839 68.100426,218.938828 68.837189,218.760422 
z"/>
<path fill="#E7EEFA" opacity="1.000000" stroke="none" 
  d="
M76.830956,217.717499 
  C76.491417,218.196838 76.001534,218.465744 75.223495,218.646851 
  C75.517097,218.208389 76.098846,217.857727 76.830956,217.717499 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M79.911560,238.788422 
  C80.239182,238.272171 80.876945,237.827393 81.804047,237.509308 
  C81.469498,238.043976 80.845604,238.451950 79.911560,238.788422 
z"/>
<path fill="#2981FC" opacity="1.000000" stroke="none" 
  d="
M319.146759,102.864609 
  C319.513702,103.584778 319.822144,104.358788 320.178802,105.464043 
  C320.227020,105.795280 320.105347,105.903374 319.783142,105.752472 
  C319.297913,104.743248 319.134827,103.884918 318.971741,103.026588 
  C318.971771,103.026588 319.088287,102.918449 319.146759,102.864609 
z"/>
<path fill="#1967F0" opacity="1.000000" stroke="none" 
  d="
M85.479080,102.898216 
  C85.941605,102.897171 86.152618,102.926498 86.682434,102.978058 
  C87.001244,103.000290 87.001503,103.498184 86.998886,103.747070 
  C86.310631,103.993607 85.624992,103.991264 84.598602,103.994682 
  C84.581093,103.643158 84.904327,103.285873 85.479080,102.898216 
z"/>
<path fill="#1967F0" opacity="1.000000" stroke="none" 
  d="
M83.552101,104.414902 
  C83.462036,104.856339 83.041557,105.366966 82.261612,105.909775 
  C82.341988,105.455994 82.781837,104.970047 83.552101,104.414902 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M175.810562,57.401955 
  C176.185104,57.548832 176.563065,58.004757 176.952408,58.781128 
  C176.580521,58.638050 176.197250,58.174526 175.810562,57.401955 
z"/>
<path fill="#1967F0" opacity="1.000000" stroke="none" 
  d="
M81.695160,105.960968 
  C81.752182,106.181862 81.538986,106.465965 81.063522,106.828499 
  C81.009148,106.612671 81.217041,106.318428 81.695160,105.960968 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M327.728027,129.703705 
  C327.369232,129.774979 327.192871,129.516052 327.161926,128.928680 
  C327.383118,128.943390 327.584137,129.201157 327.728027,129.703705 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M169.871185,51.408493 
  C170.126831,51.303528 170.427048,51.476673 170.799683,51.909847 
  C170.553314,52.008785 170.234543,51.847691 169.871185,51.408493 
z"/>
<path fill="#1B6AF2" opacity="1.000000" stroke="none" 
  d="
M115.383194,136.129440 
  C115.295982,135.898636 115.477791,135.584335 115.927055,135.182144 
  C116.013733,135.411484 115.832970,135.728714 115.383194,136.129440 
z"/>
<path fill="#1B6AF2" opacity="1.000000" stroke="none" 
  d="
M116.368271,135.112656 
  C116.286331,134.884201 116.473679,134.574661 116.927650,134.179184 
  C117.008705,134.406021 116.823135,134.718811 116.368271,135.112656 
z"/>
<path fill="#298CFF" opacity="1.000000" stroke="none" 
  d="
M322.998108,140.021210 
  C322.564819,140.017990 322.131531,140.014786 321.373413,140.006744 
  C321.048645,140.001923 320.863129,139.581055 320.887268,139.033524 
  C320.535767,138.062775 320.160126,137.639557 319.784485,137.216354 
  C318.734863,136.522614 317.685242,135.828888 316.319946,134.725006 
  C315.996552,133.889542 315.988831,133.464218 315.981079,133.038910 
  C315.986206,131.039627 315.982788,129.040283 315.998444,127.041077 
  C316.023773,123.808578 314.475952,122.336555 311.214478,121.897339 
  C309.224060,121.629288 306.100037,120.717293 305.681702,119.398026 
  C303.825989,113.545624 298.763153,112.373955 293.721619,110.310944 
  C290.986389,113.391602 288.695374,112.587166 285.012756,109.999275 
  C278.775085,105.615822 272.584106,100.793762 263.410187,102.439514 
  C259.083832,103.215645 254.156448,101.478165 249.147308,102.619286 
  C246.766312,103.161705 243.482224,99.739937 240.137695,97.848419 
  C239.589401,98.694061 238.588165,100.238243 237.322571,102.190170 
  C233.629639,98.180954 230.852951,99.260269 226.709183,102.100761 
  C222.201614,105.190643 216.250839,106.585632 210.724503,107.570747 
  C208.603027,107.948929 205.975388,105.029053 203.464142,103.856720 
  C202.032196,103.188248 200.294785,102.493614 198.824295,102.706085 
  C192.475449,103.623398 186.174377,104.871445 179.474731,105.670593 
  C179.391953,103.558113 179.690369,101.774170 179.988785,99.990234 
  C180.092026,99.666458 180.280777,99.404259 180.996979,99.366257 
  C184.349091,98.757019 187.747482,98.689514 190.074631,97.076492 
  C196.179871,92.844765 201.996552,91.455666 208.413834,96.122223 
  C209.130661,96.643501 210.560837,97.059898 211.173477,96.698921 
  C214.050339,95.003799 216.706253,92.938194 219.545670,91.173210 
  C221.003311,90.267151 222.644516,89.213860 224.264908,89.098259 
  C228.486969,88.797028 232.747894,89.095497 236.984848,88.933441 
  C241.846924,88.747475 246.696060,88.178993 251.558090,88.049561 
  C255.276276,87.950577 259.374451,87.330055 262.653992,88.608253 
  C269.629639,91.326973 278.464142,89.957054 283.373138,97.532440 
  C283.731964,98.086136 285.136261,97.906593 285.605652,98.453316 
  C288.966583,102.367607 291.445221,100.659332 293.629120,96.989899 
  C294.703491,97.615738 295.517822,98.477684 296.379303,98.527756 
  C301.248138,98.810738 303.675171,101.323486 304.752289,106.045227 
  C305.074615,107.458382 307.472443,108.533752 309.084320,109.484184 
  C311.307587,110.795105 313.687286,111.840736 316.000000,113.424072 
  C316.000000,115.726868 316.000000,117.605606 316.000000,119.778366 
  C318.309296,119.031990 319.767670,118.560638 321.585876,117.972984 
  C321.777954,119.752205 321.731934,121.089600 322.091675,122.307121 
  C322.955444,125.230743 324.009674,128.098114 324.987061,130.988174 
  C324.991852,132.057251 324.996613,133.126328 324.683044,134.766327 
  C323.909180,136.898560 323.453644,138.459885 322.998108,140.021210 
z"/>
<path fill="#145FE8" opacity="1.000000" stroke="none" 
  d="
M148.279861,238.529434 
  C148.084106,238.405731 147.888367,238.282013 147.115753,238.108368 
  C146.538879,238.058441 146.067123,238.106171 146.072571,238.015137 
  C146.078018,237.924118 146.007019,237.756149 145.932465,237.435669 
  C144.829239,236.540833 143.800552,235.966507 141.798416,234.848663 
  C145.380417,234.064835 147.036530,233.702423 148.813507,233.313568 
  C147.830002,231.469376 146.219360,229.877869 146.471436,228.677551 
  C147.637695,223.124207 144.308914,219.269806 142.141205,214.696075 
  C144.522949,211.594482 146.757492,208.792786 149.199707,206.271027 
  C154.617157,208.700623 159.700867,212.104279 165.072464,212.644287 
  C170.353592,213.175232 175.926926,210.799530 181.921371,209.588318 
  C181.514130,212.568314 181.273682,214.327698 180.990295,216.434586 
  C179.976700,218.056625 179.114334,219.433960 178.017838,220.589005 
  C170.872284,228.116150 161.725555,232.073959 151.635086,235.008850 
  C150.151825,235.970627 149.056564,236.937836 148.011353,238.076233 
  C148.061401,238.247421 148.279861,238.529434 148.279861,238.529434 
z"/>
<path fill="#1E77FC" opacity="1.000000" stroke="none" 
  d="
M235.974686,131.068085 
  C237.443497,130.266006 239.032776,128.609467 240.362106,128.796860 
  C251.132950,130.315277 261.841614,132.270447 272.603302,133.862030 
  C274.763184,134.181473 277.068268,133.519135 279.719574,134.155670 
  C278.352783,135.005432 276.985992,135.855194 274.751801,137.244247 
  C276.555939,137.619370 277.646240,137.846069 279.146301,138.104691 
  C275.767242,140.369858 272.177765,143.888931 268.139801,144.514847 
  C262.947693,145.319687 259.572876,148.294739 255.116943,150.624344 
  C252.756119,147.054443 251.153595,144.227875 246.465927,143.632385 
  C243.458511,143.250336 240.824265,139.930740 238.004639,137.559570 
  C237.315903,135.150177 236.645294,133.109131 235.974686,131.068085 
M273.174927,138.753418 
  C273.119598,138.586700 273.064301,138.419983 273.008942,138.253265 
  C272.954987,138.421066 272.901001,138.588867 273.174927,138.753418 
z"/>
<path fill="#1B71F5" opacity="1.000000" stroke="none" 
  d="
M227.004517,178.031723 
  C222.302048,180.674759 217.599579,183.317795 212.145905,185.999329 
  C207.266724,187.657379 203.138779,189.276917 199.016602,190.532410 
  C199.645889,189.308533 200.110199,187.917007 200.918732,187.674866 
  C206.314453,186.058853 206.184174,182.289841 205.141876,177.677948 
  C206.522049,173.914017 207.760361,170.472107 209.322174,167.183502 
  C211.577820,168.206055 213.501373,169.787537 215.443665,169.810867 
  C221.252670,169.880630 227.069000,169.340454 232.763809,169.357147 
  C230.764938,172.461151 228.884735,175.246429 227.004517,178.031723 
z"/>
<path fill="#1B71F5" opacity="1.000000" stroke="none" 
  d="
M238.022751,137.927933 
  C240.824265,139.930740 243.458511,143.250336 246.465927,143.632385 
  C251.153595,144.227875 252.756119,147.054443 254.762207,150.620605 
  C250.754303,154.429626 246.530655,157.970322 242.121597,162.041519 
  C241.654007,162.873901 241.371811,163.175766 241.089630,163.477646 
  C241.015564,163.660538 240.941498,163.843430 240.620605,164.380920 
  C239.940094,165.352722 239.506393,165.969894 239.072708,166.587082 
  C239.072708,166.587082 239.042358,166.933441 238.522537,167.035736 
  C236.341278,167.402100 234.679840,167.666168 233.054352,167.585815 
  C233.853043,166.423752 235.059235,165.717682 235.298111,164.768250 
  C236.122711,161.490753 242.256790,159.590683 237.903687,154.755463 
  C237.763397,154.239029 237.548462,154.044525 237.324738,153.612457 
  C240.209106,149.376511 241.454224,145.395538 237.967743,140.788467 
  C237.905045,139.633209 237.918503,138.858765 237.948288,138.041504 
  C237.964615,137.998718 238.022751,137.927933 238.022751,137.927933 
z"/>
<path fill="#ABDDFE" opacity="1.000000" stroke="none" 
  d="
M253.845856,226.529663 
  C250.394638,227.387726 246.943436,228.245804 242.787628,229.403946 
  C239.209396,229.914474 236.335785,230.124924 233.146667,230.250580 
  C232.191177,230.572876 231.551193,230.979965 230.503983,231.513107 
  C228.387283,231.723816 226.677811,231.808487 224.686829,231.624634 
  C221.578125,231.748749 218.750931,232.141357 215.474579,232.633240 
  C210.712418,232.662872 206.399414,232.593246 202.010223,232.276428 
  C201.289810,232.017014 200.645569,232.004776 199.645493,231.971771 
  C198.844406,231.792435 198.399155,231.633835 197.953918,231.475220 
  C198.420670,230.655487 198.887421,229.835754 199.971680,229.286911 
  C204.060532,229.713715 207.531876,229.869629 211.156616,230.247086 
  C211.873856,230.281097 212.437653,230.093582 213.318390,229.892578 
  C214.423538,229.586136 215.211761,229.293198 216.379547,229.015045 
  C223.649567,228.863251 230.773682,230.302155 237.459930,226.058243 
  C243.283447,224.437592 248.720001,222.832169 254.156555,221.226715 
  C254.713531,222.140594 255.270508,223.054474 255.722534,224.483276 
  C255.027008,225.508682 254.436432,226.019165 253.845856,226.529663 
z"/>
<path fill="#3794FE" opacity="1.000000" stroke="none" 
  d="
M169.991837,249.019394 
  C168.518402,249.006332 167.044983,248.993271 165.127136,248.956818 
  C163.429749,247.688553 162.176804,246.443710 160.923859,245.198853 
  C162.589813,244.419510 164.255768,243.640167 166.731812,242.918213 
  C171.332275,241.972229 175.122696,240.968826 179.376404,239.977692 
  C182.501007,239.952774 185.352142,240.516037 187.782394,239.747803 
  C192.229462,238.342072 193.237061,240.157684 192.541412,243.997849 
  C187.821564,244.639481 182.373566,241.707169 179.565002,248.007690 
  C176.092407,248.343933 173.042114,248.681656 169.991837,249.019394 
z"/>
<path fill="#48AFFB" opacity="1.000000" stroke="none" 
  d="
M262.980133,212.972855 
  C269.430817,206.781174 275.881531,200.589508 282.940125,194.134918 
  C283.956970,193.105881 284.365906,192.339767 284.774872,191.573654 
  C286.496887,188.591644 288.078949,185.514008 290.016327,182.679184 
  C290.700439,181.678177 292.252686,181.270477 293.954132,181.266815 
  C287.388458,194.736389 278.450897,205.949265 265.197845,214.016602 
  C264.014313,213.660843 263.497223,213.316849 262.980133,212.972855 
z"/>
<path fill="#1438E6" opacity="1.000000" stroke="none" 
  d="
M152.023102,235.014282 
  C161.725555,232.073959 170.872284,228.116150 178.017838,220.589005 
  C179.114334,219.433960 179.976700,218.056625 181.232849,216.404602 
  C181.518356,216.027130 182.004211,215.968872 182.209961,215.871170 
  C182.672791,215.583679 182.829712,215.331558 182.952606,214.661499 
  C184.337189,211.529129 185.655624,208.752365 186.974060,205.975601 
  C189.086288,203.029160 191.198517,200.082718 193.647400,197.099304 
  C187.539886,215.307800 176.896408,229.644760 156.959183,236.131927 
  C154.808594,236.163132 153.411255,236.095062 152.014648,235.773804 
  C152.017960,235.351852 152.020523,235.183075 152.023102,235.014282 
z"/>
<path fill="#64B7FE" opacity="1.000000" stroke="none" 
  d="
M271.508942,174.165100 
  C268.320862,184.504562 262.310608,193.160690 255.263641,201.167938 
  C254.461945,202.078903 253.108978,202.504715 251.256699,203.074265 
  C250.234955,202.950272 249.968140,202.907516 249.701355,202.864746 
  C256.148193,193.308838 262.595001,183.752914 269.782471,174.083832 
  C270.851715,174.035492 271.180328,174.100296 271.508942,174.165100 
z"/>
<path fill="#227FFE" opacity="1.000000" stroke="none" 
  d="
M224.968323,231.893143 
  C226.677811,231.808487 228.387283,231.723816 230.797211,231.636063 
  C232.152481,231.200439 232.807327,230.767899 233.462173,230.335358 
  C236.335785,230.124924 239.209396,229.914474 242.520905,229.632263 
  C241.327866,230.526062 239.796234,232.042419 238.048019,232.357620 
  C231.915939,233.463242 225.729156,234.624527 219.526001,234.887054 
  C211.538452,235.225098 203.515091,234.716965 195.229630,234.061905 
  C194.952103,233.550507 194.912598,233.088013 195.254684,233.029495 
  C196.099442,232.536591 196.602127,232.102219 197.104813,231.667847 
  C197.104813,231.667847 197.495148,231.420502 197.724533,231.447861 
  C198.399155,231.633835 198.844406,231.792435 199.828445,232.208786 
  C200.940292,232.485565 201.513351,232.504593 202.086395,232.523621 
  C206.399414,232.593246 210.712418,232.662872 215.907867,232.742813 
  C219.516312,232.466461 222.242310,232.179794 224.968323,231.893143 
z"/>
<path fill="#6BBDFD" opacity="1.000000" stroke="none" 
  d="
M262.624268,213.019379 
  C263.497223,213.316849 264.014313,213.660843 264.853699,214.057480 
  C261.743713,216.447479 258.311462,218.784836 254.517868,221.174454 
  C248.720001,222.832169 243.283447,224.437592 237.209351,225.886353 
  C236.383774,225.174194 236.195740,224.618683 236.007706,224.063171 
  C244.761246,220.397400 253.514801,216.731644 262.624268,213.019379 
z"/>
<path fill="#3296FF" opacity="1.000000" stroke="none" 
  d="
M253.770126,226.873672 
  C254.436432,226.019165 255.027008,225.508682 255.784943,224.815628 
  C263.438416,220.732101 270.924561,216.831116 278.775879,212.841919 
  C277.630920,214.727829 276.525116,217.425064 274.533752,218.538498 
  C268.891846,221.693069 262.866394,224.156464 257.049286,227.008911 
  C256.199097,227.425827 255.661682,228.480637 254.952942,229.626770 
  C253.856003,230.222504 252.785675,230.431747 250.371048,230.903809 
  C252.004044,229.092575 252.849213,228.155121 253.770126,226.873672 
z"/>
<path fill="#6BBDFD" opacity="1.000000" stroke="none" 
  d="
M206.877655,216.870941 
  C214.014328,210.329163 221.151001,203.787399 228.861176,197.209564 
  C229.715393,197.550232 229.996109,197.926956 230.276825,198.303650 
  C223.280884,204.675232 216.284943,211.046799 208.766556,217.656357 
  C207.788635,217.553223 207.333145,217.212082 206.877655,216.870941 
z"/>
<path fill="#75C2FE" opacity="1.000000" stroke="none" 
  d="
M235.628326,224.051117 
  C236.195740,224.618683 236.383774,225.174194 236.822403,225.901581 
  C230.773682,230.302155 223.649567,228.863251 216.409210,228.669403 
  C216.372864,227.206726 216.686417,226.104446 216.999969,225.002167 
  C216.999969,225.002167 217.276062,224.856781 217.873032,224.903244 
  C220.726685,224.667953 222.983353,224.386215 225.240036,224.104462 
  C228.597366,227.301270 231.925125,225.971786 235.628326,224.051117 
z"/>
<path fill="#56AFFE" opacity="1.000000" stroke="none" 
  d="
M249.423401,203.025345 
  C249.968140,202.907516 250.234955,202.950272 250.904968,203.044189 
  C249.968796,209.465164 244.421768,211.733948 239.787231,214.876266 
  C238.451859,215.781662 237.016907,216.540161 235.344269,217.179245 
  C235.068497,216.782700 235.085114,216.573639 235.110779,216.365295 
  C239.789017,211.972183 244.467255,207.579071 249.423401,203.025345 
z"/>
<path fill="#5DB6FE" opacity="1.000000" stroke="none" 
  d="
M297.953918,174.862213 
  C296.495544,176.617355 295.157806,178.012665 293.820068,179.407990 
  C293.495575,179.150848 293.171082,178.893707 292.846588,178.636581 
  C295.200348,172.671982 297.554108,166.707397 300.147858,160.134628 
  C302.414886,165.742569 299.216034,169.985321 297.953918,174.862213 
z"/>
<path fill="#196CF7" opacity="1.000000" stroke="none" 
  d="
M196.736633,231.562790 
  C196.602127,232.102219 196.099442,232.536591 194.865372,233.013458 
  C189.060349,235.359085 183.986740,237.662262 178.913116,239.965424 
  C175.122696,240.968826 171.332275,241.972229 167.118683,242.947678 
  C172.373886,239.903564 178.030197,236.844650 183.744064,233.897278 
  C185.465088,233.009552 187.346069,232.431931 189.942047,231.768188 
  C191.847580,231.660492 192.964828,231.496902 194.082077,231.333298 
  C194.844208,231.374786 195.606339,231.416260 196.736633,231.562790 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M234.756592,216.181335 
  C235.085114,216.573639 235.068497,216.782700 235.019730,217.134308 
  C231.933411,219.446671 228.888306,221.617203 225.541611,223.946091 
  C222.983353,224.386215 220.726685,224.667953 218.027618,224.924332 
  C223.190979,221.931763 228.796692,218.964569 234.756592,216.181335 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M322.017120,162.985535 
  C318.881073,169.893036 315.745026,176.800552 312.305786,183.874329 
  C311.979645,182.839462 311.956665,181.638336 311.865448,179.987152 
  C311.797241,179.537094 311.757416,179.283447 312.178284,179.112930 
  C314.709045,173.607315 316.818939,168.272217 318.928833,162.937103 
  C318.928833,162.937103 318.736298,162.885223 319.146454,162.893555 
  C320.376770,162.929764 321.196960,162.957657 322.017120,162.985535 
z"/>
<path fill="#1438E6" opacity="1.000000" stroke="none" 
  d="
M199.010849,190.896469 
  C203.138779,189.276917 207.266724,187.657379 211.801773,186.070038 
  C208.181854,188.409409 204.140854,190.692673 200.135025,193.036072 
  C198.631653,193.915543 197.210052,194.934769 195.400497,195.939850 
  C195.568802,194.844589 196.087799,193.699783 197.070007,192.173462 
  C198.025772,191.493439 198.518311,191.194962 199.010849,190.896469 
z"/>
<path fill="#1664F0" opacity="1.000000" stroke="none" 
  d="
M315.564514,133.010101 
  C315.988831,133.464218 315.996552,133.889542 315.997742,134.634155 
  C310.623596,134.637375 305.255920,134.321289 299.462585,133.942291 
  C300.116455,133.243408 301.195953,132.607437 302.644592,131.944290 
  C307.058441,132.271835 311.103180,132.626556 315.564514,133.010101 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M322.023804,162.667404 
  C321.196960,162.957657 320.376770,162.929764 319.150269,162.793930 
  C319.447021,158.379288 320.150116,154.072617 321.248474,149.521378 
  C322.722351,149.510666 323.800995,149.744507 324.879639,149.978333 
  C324.625641,151.405441 324.371643,152.832550 323.721313,154.680237 
  C321.117889,156.714966 320.074158,158.575150 322.061096,161.076324 
  C322.050903,161.500641 322.040710,161.924942 322.023804,162.667404 
z"/>
<path fill="#1438E6" opacity="1.000000" stroke="none" 
  d="
M233.018402,167.930237 
  C234.679840,167.666168 236.341278,167.402100 238.349716,167.054520 
  C235.039551,170.673676 231.382385,174.376358 227.364868,178.055389 
  C228.884735,175.246429 230.764938,172.461151 232.801880,169.080353 
  C232.978546,168.299988 232.998474,168.115112 233.018402,167.930237 
z"/>
<path fill="#48AFFB" opacity="1.000000" stroke="none" 
  d="
M318.553040,162.924591 
  C316.818939,168.272217 314.709045,173.607315 312.239502,179.000092 
  C313.979034,173.675888 316.078156,168.293976 318.553040,162.924591 
z"/>
<path fill="#8DCAFD" opacity="1.000000" stroke="none" 
  d="
M230.571838,198.146912 
  C229.996109,197.926956 229.715393,197.550232 229.121368,197.005798 
  C230.804520,193.658157 232.800980,190.478226 234.797424,187.298294 
  C235.562408,187.801727 236.327408,188.305145 237.092407,188.808578 
  C235.017212,191.869110 232.942032,194.929642 230.571838,198.146912 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M291.511566,203.832947 
  C290.775482,205.453033 289.689667,207.079849 288.305298,208.861877 
  C285.408325,210.333633 282.809937,211.650208 279.801208,212.933395 
  C283.314545,209.879913 287.238190,206.859802 291.511566,203.832947 
z"/>
<path fill="#8DCAFD" opacity="1.000000" stroke="none" 
  d="
M206.528931,216.921143 
  C207.333145,217.212082 207.788635,217.553223 208.537125,217.912552 
  C204.866348,219.862991 200.902542,221.795242 196.551498,223.505737 
  C196.180801,222.895157 196.197327,222.506317 196.213852,222.117462 
  C199.535965,220.402084 202.858093,218.686707 206.528931,216.921143 
z"/>
<path fill="#0409C6" opacity="1.000000" stroke="none" 
  d="
M126.887695,238.499542 
  C124.207260,238.464691 121.526817,238.429840 118.398766,238.022400 
  C117.951813,237.440659 117.952469,237.231522 118.425110,237.007645 
  C125.593590,237.319946 132.290085,237.646988 138.578308,238.009369 
  C136.089676,238.224564 134.009323,238.404419 131.928970,238.584274 
  C130.911667,238.588654 129.894363,238.593033 128.384735,238.393005 
  C127.557495,238.292252 127.222595,238.395889 126.887695,238.499542 
z"/>
<path fill="#8DCAFD" opacity="1.000000" stroke="none" 
  d="
M272.947144,165.983765 
  C273.986938,163.043472 275.026733,160.103165 276.066528,157.162857 
  C276.621918,157.336960 277.177338,157.511078 277.732727,157.685181 
  C276.992920,160.290619 276.253113,162.896057 274.913818,165.748596 
  C273.858612,165.991730 273.402863,165.987747 272.947144,165.983765 
z"/>
<path fill="#75C2FE" opacity="1.000000" stroke="none" 
  d="
M211.003204,230.025543 
  C207.531876,229.869629 204.060532,229.713715 200.291656,229.276398 
  C203.390533,228.314972 206.786987,227.634949 210.511566,227.190536 
  C210.896469,227.953812 210.953232,228.481491 211.006866,229.263245 
  C211.003571,229.686737 211.003387,229.856140 211.003204,230.025543 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M211.009995,229.009155 
  C210.953232,228.481491 210.896469,227.953812 210.917175,227.197266 
  C212.752991,226.324982 214.511322,225.681595 216.634827,225.020187 
  C216.686417,226.104446 216.372864,227.206726 216.029663,228.654633 
  C215.211761,229.293198 214.423538,229.586136 213.142914,229.665649 
  C212.103668,229.304520 211.556839,229.156830 211.009995,229.009155 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M152.013931,236.027008 
  C153.411255,236.095062 154.808594,236.163132 156.621429,236.296936 
  C154.298096,237.214539 151.559265,238.066406 148.550140,238.723846 
  C148.279861,238.529434 148.061401,238.247421 148.337219,238.161423 
  C149.746658,237.392624 150.880295,236.709808 152.013931,236.027008 
z"/>
<path fill="#67B8FE" opacity="1.000000" stroke="none" 
  d="
M321.129181,141.457092 
  C322.220764,142.006790 323.264740,142.979126 324.627686,143.990402 
  C324.953003,144.776382 324.959381,145.523422 324.561462,146.638336 
  C323.143921,147.001770 322.130646,146.997314 321.117340,146.992859 
  C321.105408,145.288483 321.093506,143.584106 321.129181,141.457092 
z"/>
<path fill="#5770D3" opacity="1.000000" stroke="none" 
  d="
M132.159210,238.818695 
  C134.009323,238.404419 136.089676,238.224564 139.017715,238.026276 
  C141.912613,237.923965 143.959808,237.840057 146.007019,237.756149 
  C146.007019,237.756149 146.078018,237.924118 145.994507,238.215332 
  C145.910995,238.506546 145.835419,238.929184 145.835419,238.929184 
  C144.817245,239.014954 143.799072,239.100723 142.094437,239.227921 
  C140.598831,239.502121 139.789673,239.734894 138.980530,239.967667 
  C138.546478,239.925034 138.112427,239.882401 137.078568,239.669144 
  C135.303497,239.462738 134.128235,239.426987 132.952972,239.391205 
  C132.765137,239.278503 132.577301,239.165802 132.159210,238.818695 
z"/>
<path fill="#75C2FE" opacity="1.000000" stroke="none" 
  d="
M271.801392,174.002350 
  C271.180328,174.100296 270.851715,174.035492 270.029846,173.863464 
  C270.372986,171.867584 271.209381,169.978897 272.496735,168.037262 
  C273.087982,168.124710 273.228302,168.265091 273.368622,168.405487 
  C272.943695,170.216858 272.518768,172.028229 271.801392,174.002350 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M295.408722,199.904755 
  C296.964630,202.382431 296.550293,202.965439 292.282837,203.945282 
  C292.988708,202.639893 294.066986,201.361221 295.408722,199.904755 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M104.046265,235.830536 
  C105.075859,235.147064 106.567482,234.548065 108.712921,234.096741 
  C109.578354,234.828995 109.789970,235.413574 110.000793,235.999084 
  C110.000000,236.000000 109.998169,236.001831 109.998169,236.001831 
  C108.168213,235.972885 106.338257,235.943954 104.046265,235.830536 
z"/>
<path fill="#5770D3" opacity="1.000000" stroke="none" 
  d="
M117.953125,237.022369 
  C117.952469,237.231522 117.951813,237.440659 117.989838,237.961151 
  C116.245514,238.243561 114.462509,238.214630 112.250404,237.898132 
  C111.624763,237.115982 111.428230,236.621384 111.531281,236.066284 
  C112.229828,236.003494 112.628792,236.001205 113.257683,236.299835 
  C114.988579,236.747818 116.489540,236.894852 117.990234,237.020386 
  C117.989952,236.998856 117.953125,237.022369 117.953125,237.022369 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M321.044373,147.323761 
  C322.130646,146.997314 323.143921,147.001770 324.535339,147.011475 
  C324.922699,147.757736 324.931976,148.498749 324.910400,149.609039 
  C323.800995,149.744507 322.722351,149.510666 321.332031,149.141434 
  C321.004028,148.555588 320.987732,148.105148 321.044373,147.323761 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M91.254578,237.317490 
  C92.439316,236.750107 93.859810,236.441559 95.662590,236.206818 
  C94.526703,236.712509 93.008522,237.144409 91.254578,237.317490 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M133.049454,239.701141 
  C134.128235,239.426987 135.303497,239.462738 136.753967,239.718689 
  C135.734772,239.962936 134.440353,239.987015 133.049454,239.701141 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M139.155884,240.219238 
  C139.789673,239.734894 140.598831,239.502121 141.728882,239.342545 
  C141.143585,239.767426 140.237411,240.119125 139.155884,240.219238 
z"/>
<path fill="#E7EEFA" opacity="1.000000" stroke="none" 
  d="
M193.797012,227.789795 
  C193.197250,227.427872 192.895676,227.003693 192.594101,226.579514 
  C193.039780,226.465134 193.485458,226.350754 193.931137,226.236359 
  C193.985825,226.733414 194.040512,227.230469 193.797012,227.789795 
z"/>
<path fill="#1E77FC" opacity="1.000000" stroke="none" 
  d="
M280.318176,138.160095 
  C280.884796,137.613052 281.784119,137.110947 282.873108,136.894958 
  C282.258789,137.522385 281.454834,137.863693 280.318176,138.160095 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M111.231689,236.126770 
  C111.428230,236.621384 111.624763,237.115982 111.895401,237.867920 
  C111.310631,237.633041 110.651764,237.140854 109.995529,236.325256 
  C109.998169,236.001831 110.000000,236.000000 110.309952,236.015533 
  C110.823830,236.062973 111.027763,236.094864 111.231689,236.126770 
z"/>
<path fill="#E7EEFA" opacity="1.000000" stroke="none" 
  d="
M195.887695,222.109894 
  C196.197327,222.506317 196.180801,222.895157 196.207230,223.572510 
  C195.669144,223.686996 195.088089,223.512955 194.507019,223.338913 
  C194.858521,222.926712 195.210037,222.514511 195.887695,222.109894 
z"/>
<path fill="#75C2FE" opacity="1.000000" stroke="none" 
  d="
M272.862793,166.247406 
  C273.402863,165.987747 273.858612,165.991730 274.655823,165.997986 
  C274.631622,166.700897 274.265930,167.401505 273.634460,168.253815 
  C273.228302,168.265091 273.087982,168.124710 272.725708,167.779419 
  C272.595276,167.220032 272.686859,166.865540 272.862793,166.247406 
z"/>
<path fill="#64B7FE" opacity="1.000000" stroke="none" 
  d="
M284.491394,191.727203 
  C284.365906,192.339767 283.956970,193.105881 283.177368,193.907074 
  C283.273804,193.255035 283.740875,192.567902 284.491394,191.727203 
z"/>
<path fill="#8DCAFD" opacity="1.000000" stroke="none" 
  d="
M193.802658,231.192581 
  C192.964828,231.496902 191.847580,231.660492 190.315552,231.700623 
  C191.108276,231.402069 192.315750,231.226974 193.802658,231.192581 
z"/>
<path fill="#1438E6" opacity="1.000000" stroke="none" 
  d="
M239.286224,166.472397 
  C239.506393,165.969894 239.940094,165.352722 240.368073,164.535309 
  C240.074829,165.009277 239.787277,165.683502 239.286224,166.472397 
z"/>
<path fill="#1438E6" opacity="1.000000" stroke="none" 
  d="
M241.256409,163.413620 
  C241.371811,163.175766 241.654007,162.873901 241.960480,162.356125 
  C241.797592,162.543350 241.610382,162.946472 241.256409,163.413620 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M319.806213,137.496185 
  C320.160126,137.639557 320.535767,138.062775 320.848053,138.806915 
  C320.465790,138.677216 320.146881,138.226608 319.806213,137.496185 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M146.071625,238.879944 
  C145.835419,238.929184 145.910995,238.506546 145.989059,238.306366 
  C146.067123,238.106171 146.538879,238.058441 146.768524,238.117340 
  C146.840714,238.471024 146.610596,238.689178 146.071625,238.879944 
z"/>
<path fill="#5770D3" opacity="1.000000" stroke="none" 
  d="
M127.194092,238.635406 
  C127.222595,238.395889 127.557495,238.292252 128.005478,238.350220 
  C127.912537,238.598297 127.706512,238.684784 127.194092,238.635406 
z"/>
<path fill="#1B72FB" opacity="1.000000" stroke="none" 
  d="
M208.998657,167.030212 
  C207.760361,170.472107 206.522049,173.914017 204.697006,177.677948 
  C198.942734,177.884552 193.784637,177.465836 191.205490,183.719650 
  C190.873703,184.524170 186.045349,184.756287 185.713287,184.075851 
  C183.057556,178.633804 178.552002,178.962341 173.777847,179.369217 
  C172.501877,179.477966 171.043793,179.285492 169.896225,178.747391 
  C164.953491,176.429672 160.001144,174.849686 154.368408,175.861206 
  C152.917618,176.121704 151.133270,174.763412 149.555267,174.033875 
  C143.810501,171.377991 138.109268,168.627396 132.351624,166.000122 
  C126.562874,163.358658 120.707809,160.861618 114.941711,158.172821 
  C114.407204,157.923569 114.304871,156.747543 114.001877,156.001831 
  C115.775291,155.647079 117.548698,155.292313 119.660751,154.968781 
  C126.404854,155.061417 132.708786,154.550812 139.230026,155.654816 
  C145.269394,156.677246 151.774826,154.562073 158.060471,154.670792 
  C161.379242,154.728195 164.669449,156.574326 167.964432,157.638031 
  C168.264969,157.735077 168.484970,158.058105 168.777908,158.205612 
  C176.214050,161.950348 176.214890,161.948669 183.401810,158.146408 
  C188.202332,161.903870 191.678741,160.687622 193.647400,154.520432 
  C193.894485,153.746384 193.724731,152.823425 194.030930,152.087051 
  C195.008652,149.735840 196.119629,147.440048 197.179138,145.122849 
  C198.117996,147.559830 199.100174,149.981445 199.972473,152.442017 
  C200.282852,153.317490 200.326462,154.287521 201.033157,155.301483 
  C202.517044,155.886765 203.459610,156.384949 204.611877,156.988892 
  C205.069077,157.326660 205.175308,157.611389 204.803619,157.995483 
  C203.252823,161.200409 204.261093,163.200211 208.998657,167.030212 
z"/>
<path fill="#196CF7" opacity="1.000000" stroke="none" 
  d="
M113.544701,156.001282 
  C114.304871,156.747543 114.407204,157.923569 114.941711,158.172821 
  C120.707809,160.861618 126.562874,163.358658 132.351624,166.000122 
  C138.109268,168.627396 143.810501,171.377991 149.555267,174.033875 
  C151.133270,174.763412 152.917618,176.121704 154.368408,175.861206 
  C160.001144,174.849686 164.953491,176.429672 169.896225,178.747391 
  C171.043793,179.285492 172.501877,179.477966 173.777847,179.369217 
  C178.552002,178.962341 183.057556,178.633804 185.713287,184.075851 
  C186.045349,184.756287 190.873703,184.524170 191.205490,183.719650 
  C193.784637,177.465836 198.942734,177.884552 204.555145,178.000000 
  C206.184174,182.289841 206.314453,186.058853 200.918732,187.674866 
  C200.110199,187.917007 199.645889,189.308533 199.016602,190.532425 
  C198.518311,191.194962 198.025772,191.493439 197.268188,191.902435 
  C196.338699,192.017929 195.457718,191.745316 195.042175,192.069427 
  C188.555695,197.128433 182.374573,193.065125 176.092361,191.565582 
  C174.665665,191.225037 172.950272,190.673096 171.722534,191.143799 
  C161.564926,195.038086 154.635391,188.464737 147.264053,183.668381 
  C142.396606,180.501236 138.534286,175.609314 131.608231,176.772324 
  C130.115326,177.022995 128.054199,175.236526 126.582108,173.999069 
  C122.911179,170.913223 119.594688,167.388962 115.812508,164.458023 
  C113.250427,162.472565 110.810638,159.896225 106.507767,162.198349 
  C105.170036,162.914108 101.750679,159.739151 99.284302,158.345352 
  C100.425758,157.360352 101.520531,155.608673 102.717545,155.535782 
  C106.152023,155.326614 109.627914,155.797272 113.544701,156.001282 
z"/>
<path fill="#1664F0" opacity="1.000000" stroke="none" 
  d="
M182.004211,215.968872 
  C182.004211,215.968872 181.518356,216.027130 181.275803,216.057098 
  C181.273682,214.327698 181.514130,212.568314 181.921371,209.588318 
  C175.926926,210.799530 170.353592,213.175232 165.072464,212.644287 
  C159.700867,212.104279 154.617157,208.700623 149.308960,206.011810 
  C149.480286,204.979370 149.750046,204.486069 150.431702,203.994781 
  C155.194855,205.637833 156.727798,200.825851 160.000580,199.997559 
  C164.653152,200.724075 169.287872,201.619461 173.965027,202.113281 
  C176.736252,202.405884 179.650146,201.660339 182.352737,202.166855 
  C183.863708,202.450058 185.073929,204.337875 186.696869,205.739105 
  C185.655624,208.752365 184.337189,211.529129 182.759216,214.771011 
  C182.259644,215.429688 182.094482,215.673935 182.004211,215.968872 
z"/>
<path fill="#1967F0" opacity="1.000000" stroke="none" 
  d="
M62.964554,161.618195 
  C53.149574,161.561142 43.609806,160.006012 35.157177,154.383469 
  C34.546440,153.977203 33.570976,154.119247 32.380524,153.999573 
  C31.975878,153.494156 32.077026,152.952515 31.917694,152.503281 
  C29.110561,144.588379 29.068003,144.878647 37.279682,145.896744 
  C44.089291,146.740997 50.809425,147.958954 56.246532,152.129028 
  C59.116154,154.329926 60.736919,158.159119 62.964554,161.618195 
z"/>
<path fill="#1967F0" opacity="1.000000" stroke="none" 
  d="
M159.964203,199.654343 
  C156.727798,200.825851 155.194855,205.637833 150.424683,203.658173 
  C149.999939,202.870468 149.994110,202.421432 149.986618,201.627014 
  C149.739532,197.501373 147.340302,200.410370 146.001923,199.628815 
  C145.179581,195.375443 143.602783,192.228912 138.947723,191.655060 
  C136.763931,186.743530 132.662766,184.479980 128.501907,182.171295 
  C125.839615,180.694122 123.649635,177.908554 120.867477,177.196960 
  C114.516335,175.572540 110.609192,170.879288 105.999695,167.000610 
  C108.208611,167.982819 110.447708,168.903198 112.618675,169.963150 
  C115.245186,171.245529 117.793427,172.688202 120.419609,173.971329 
  C121.278000,174.390747 122.333275,174.404083 123.197289,174.815643 
  C126.992126,176.623230 130.797501,178.420380 134.494934,180.414352 
  C135.764435,181.098953 137.048401,182.155563 137.777130,183.371109 
  C140.198654,187.410339 142.941391,189.646378 148.150879,190.799591 
  C152.220047,191.700409 154.658157,198.082748 159.964203,199.654343 
z"/>
<path fill="#1664F0" opacity="1.000000" stroke="none" 
  d="
M105.599884,167.000381 
  C110.609192,170.879288 114.516335,175.572540 120.867477,177.196960 
  C123.649635,177.908554 125.839615,180.694122 128.501907,182.171295 
  C132.662766,184.479980 136.763931,186.743530 138.543030,191.647552 
  C133.160294,191.554123 128.553162,190.044144 124.966858,186.330231 
  C119.662094,180.836700 112.832932,177.757645 106.557678,173.737656 
  C99.970375,169.517715 93.625320,166.567703 85.995598,165.752182 
  C85.993385,165.502274 85.991310,165.002411 86.345985,164.848526 
  C91.800934,165.462479 96.901207,166.230331 102.001480,166.998169 
  C103.067680,166.998825 104.133873,166.999481 105.599884,167.000381 
z"/>
<path fill="#1967F0" opacity="1.000000" stroke="none" 
  d="
M101.948029,166.651611 
  C96.901207,166.230331 91.800934,165.462479 86.205566,164.560059 
  C84.807289,163.951950 83.904099,163.478424 83.001503,162.605499 
  C83.335106,160.137009 83.668114,158.067886 84.001122,155.998779 
  C86.438110,161.935684 92.869820,160.444962 97.093536,163.052765 
  C98.736786,164.067368 100.296700,165.216949 101.948029,166.651611 
z"/>
<path fill="#1664F0" opacity="1.000000" stroke="none" 
  d="
M83.733948,155.715240 
  C83.668114,158.067886 83.335106,160.137009 82.899315,162.816635 
  C82.607620,163.692581 82.356316,163.869247 82.042618,163.957153 
  C80.709923,162.673828 79.377220,161.390488 77.702576,160.118408 
  C77.247505,159.662445 77.134377,159.195236 77.004974,158.366760 
  C77.485367,152.962677 80.945198,155.377945 83.733948,155.715240 
z"/>
<path fill="#2C90FF" opacity="1.000000" stroke="none" 
  d="
M179.649185,100.025482 
  C179.690369,101.774170 179.391953,103.558113 179.046173,105.670105 
  C178.249115,105.998535 177.499451,105.998901 176.220215,105.754929 
  C175.125504,105.003639 174.560379,104.496704 173.995239,103.989769 
  C175.766693,102.680084 177.538132,101.370407 179.649185,100.025482 
z"/>
<path fill="#298CFF" opacity="1.000000" stroke="none" 
  d="
M173.701447,104.131958 
  C174.560379,104.496704 175.125504,105.003639 175.845352,105.754837 
  C171.638657,109.474350 171.638657,109.474350 170.012894,106.363106 
  C171.141998,105.424446 172.274841,104.849297 173.701447,104.131958 
z"/>
<path fill="#1C5BF4" opacity="1.000000" stroke="none" 
  d="
M235.567932,131.047211 
  C236.645294,133.109131 237.315903,135.150177 238.004639,137.559570 
  C238.022751,137.927933 237.964615,137.998718 237.619690,137.934372 
  C234.053864,134.524078 230.643921,131.818680 225.593033,131.537689 
  C215.507538,130.976578 209.361160,136.415207 204.682907,144.423767 
  C204.939697,141.785599 205.196487,139.147415 205.723419,136.281754 
  C209.549789,134.047577 212.952225,131.669769 216.696960,130.118042 
  C222.873749,127.558540 229.053131,129.608963 235.567932,131.047211 
z"/>
<path fill="#F6FAFE" opacity="1.000000" stroke="none" 
  d="
M111.531281,236.066284 
  C111.027763,236.094864 110.823830,236.062973 110.310745,236.014618 
  C109.789970,235.413574 109.578354,234.828995 109.088120,234.082123 
  C110.349731,232.707687 111.889969,231.495499 113.731659,230.149414 
  C114.470024,230.015137 114.906952,230.014771 115.851776,230.191574 
  C116.898537,229.576309 117.437408,228.783875 117.976288,227.991455 
  C118.484200,227.110001 118.992096,226.228546 119.752441,225.177795 
  C122.593727,222.447250 125.231834,219.933014 127.744331,217.298965 
  C128.606781,216.394775 129.155182,215.191025 130.237854,213.600754 
  C133.166031,211.411591 135.703445,209.745819 138.525986,208.036682 
  C139.168427,207.590042 139.525726,207.186752 139.873413,206.834991 
  C139.863800,206.886505 139.780258,206.823196 140.157928,206.863007 
  C142.556610,205.999176 144.577621,205.095535 146.508789,204.540863 
  C144.486099,207.329895 142.619766,209.826553 140.603546,212.195679 
  C138.076294,215.165314 135.426056,218.030289 132.573776,220.982468 
  C132.138351,221.311752 131.958054,221.598999 131.467285,221.997192 
  C129.717880,223.053970 128.278961,223.999786 126.560287,224.975983 
  C125.838272,225.535782 125.396011,226.065170 124.739273,226.795624 
  C124.066360,227.353699 123.607918,227.710693 122.825195,228.065430 
  C121.984787,228.651398 121.468658,229.239655 120.835495,230.072601 
  C120.445938,230.537277 120.173409,230.757263 119.569305,231.000763 
  C118.131516,231.938858 117.025307,232.853439 115.851234,234.002045 
  C115.783371,234.236069 115.694687,234.715256 115.397743,234.762146 
  C114.409782,235.205673 113.718765,235.602295 113.027756,235.998917 
  C112.628792,236.001205 112.229828,236.003494 111.531281,236.066284 
z"/>
<path fill="#75C2FE" opacity="1.000000" stroke="none" 
  d="
M55.648060,224.276764 
  C57.867420,224.142670 59.708900,224.142670 61.550385,224.142670 
  C61.551407,224.523331 61.552433,224.904007 61.553459,225.284668 
  C57.408287,226.228729 53.263119,227.172791 49.117947,228.116852 
  C49.021126,227.844559 48.924309,227.572266 48.827488,227.299973 
  C50.975052,226.336945 53.122616,225.373901 55.648060,224.276764 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M223.370514,258.980896 
  C220.641113,258.992615 218.130249,259.240875 218.338745,255.243988 
  C220.442337,254.140762 222.221176,253.569870 224.000000,252.998962 
  C226.616531,252.998962 229.233063,252.998962 231.866058,252.998962 
  C231.759583,253.943359 231.662048,254.808319 231.799774,255.852982 
  C229.272202,257.012878 226.509354,257.993073 223.370514,258.980896 
z"/>
<path fill="#E7EEFA" opacity="1.000000" stroke="none" 
  d="
M204.633209,144.588989 
  C209.361160,136.415207 215.507538,130.976578 225.593033,131.537689 
  C230.643921,131.818680 234.053864,134.524078 237.603363,137.977173 
  C237.918503,138.858765 237.905045,139.633209 237.775024,141.084656 
  C235.499786,147.612976 233.291000,148.565002 226.189636,146.764648 
  C226.171310,146.832275 226.306274,146.794510 226.280457,146.384827 
  C225.655548,143.316391 225.056473,140.657639 224.260574,137.125473 
  C222.682037,138.074524 221.278488,138.918365 219.497925,139.822083 
  C217.717758,140.355713 216.314590,140.829468 214.602051,141.435379 
  C213.814713,142.432983 213.226120,143.256180 212.876862,144.170761 
  C210.651581,149.997910 212.277588,155.343521 217.147263,157.881683 
  C223.137680,163.171890 224.858536,163.397705 231.453156,159.979630 
  C232.589905,159.390442 233.696442,158.743011 234.952484,158.405930 
  C234.308777,160.476791 233.971970,162.721573 232.676208,163.975067 
  C225.834396,170.593704 209.084167,170.345825 205.140228,157.948837 
  C205.175308,157.611389 205.069077,157.326660 204.565826,156.537292 
  C204.304459,152.300201 204.298813,148.620468 204.293182,144.940720 
  C204.293182,144.940720 204.583511,144.754227 204.633209,144.588989 
z"/>
<path fill="#145FE8" opacity="1.000000" stroke="none" 
  d="
M203.894897,145.002899 
  C204.298813,148.620468 204.304459,152.300201 204.356140,156.431549 
  C203.459610,156.384949 202.517044,155.886765 201.300568,155.182617 
  C201.591125,151.608292 199.397705,147.552689 203.894897,145.002899 
z"/>
<path fill="#3A98FF" opacity="1.000000" stroke="none" 
  d="
M223.741608,252.718369 
  C222.221176,253.569870 220.442337,254.140762 218.326309,254.859863 
  C214.279663,254.670105 210.570221,254.332153 206.399506,253.694305 
  C205.291367,253.265106 204.644485,253.135818 203.997589,253.006531 
  C203.248032,253.007095 202.498474,253.007645 201.387054,252.610870 
  C203.265839,250.908035 205.506470,249.602539 208.502289,247.857025 
  C205.403931,245.358215 202.701965,243.179108 200.000000,241.000000 
  C203.706802,241.399918 207.446976,241.606888 211.113373,242.240570 
  C218.381058,243.496689 225.445740,243.624771 232.404572,240.542542 
  C234.120728,239.782394 236.375122,240.237473 238.382080,240.133896 
  C238.490128,240.666046 238.598175,241.198196 238.706223,241.730347 
  C235.413635,242.812210 232.162079,244.051773 228.814560,244.922409 
  C226.443771,245.539001 223.799606,245.275116 221.547806,246.122589 
  C219.866531,246.755325 218.617111,248.535629 217.175369,249.804886 
  C218.640930,250.539078 220.088730,251.312515 221.580948,251.987778 
  C222.163605,252.251434 222.846146,252.294312 223.741608,252.718369 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M199.666672,241.000000 
  C202.701965,243.179108 205.403931,245.358215 208.502289,247.857025 
  C205.506470,249.602539 203.265839,250.908035 201.012299,252.607681 
  C194.318939,252.994232 187.638474,252.986633 180.483368,252.561035 
  C180.001572,250.765091 179.994446,249.387115 179.987305,248.009155 
  C182.373566,241.707169 187.821564,244.639481 192.899994,243.961334 
  C195.143555,242.949692 196.571777,241.974838 198.000000,241.000000 
  C198.444443,241.000000 198.888901,241.000000 199.666672,241.000000 
z"/>
<path fill="#3A98FF" opacity="1.000000" stroke="none" 
  d="
M197.625687,240.958038 
  C196.571777,241.974838 195.143555,242.949692 193.356750,243.961060 
  C193.237061,240.157684 192.229462,238.342072 187.782394,239.747803 
  C185.352142,240.516037 182.501007,239.952774 179.376404,239.977707 
  C183.986740,237.662262 189.060349,235.359085 194.523285,233.071960 
  C194.912598,233.088013 194.952103,233.550507 194.952805,233.782913 
  C193.224075,237.146515 193.138382,239.730362 197.625687,240.958038 
z"/>
<path fill="#5DB6FE" opacity="1.000000" stroke="none" 
  d="
M153.417191,264.999817 
  C145.511719,263.193146 138.033829,261.385773 130.274048,259.287964 
  C134.570984,252.165298 140.331589,251.570084 147.632706,256.958191 
  C147.332748,254.714920 147.199066,253.715118 147.025772,252.368835 
  C152.844818,252.354507 158.735580,252.442474 164.537674,253.205017 
  C165.849152,253.377396 168.029251,256.134735 167.794540,257.294342 
  C166.749588,262.457153 168.033127,265.716492 174.327576,266.306366 
  C174.028107,266.853943 173.728653,267.401550 173.429184,267.949127 
  C170.702042,267.800964 167.937744,267.882812 165.256607,267.449768 
  C161.420776,266.830261 157.645752,265.834290 153.417191,264.999817 
z"/>
<path fill="#50A0FA" opacity="1.000000" stroke="none" 
  d="
M179.565002,248.007690 
  C179.994446,249.387115 180.001572,250.765091 180.016373,252.555176 
  C177.871689,252.973526 175.620651,253.366501 173.601425,252.851151 
  C172.236969,252.502899 171.199066,250.875153 170.003448,249.419556 
  C173.042114,248.681656 176.092407,248.343933 179.565002,248.007690 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M204.166885,253.249451 
  C204.644485,253.135818 205.291367,253.265106 205.971039,253.684418 
  C205.447922,253.813751 204.892059,253.653076 204.166885,253.249451 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M333.770416,235.150009 
  C333.997284,235.448532 333.998260,235.890915 333.998993,236.665070 
  C333.847351,236.429184 333.695923,235.861511 333.770416,235.150009 
z"/>
<path fill="#2C90FF" opacity="1.000000" stroke="none" 
  d="
M316.000000,113.000000 
  C313.687286,111.840736 311.307587,110.795105 309.084320,109.484184 
  C307.472443,108.533752 305.074615,107.458382 304.752289,106.045227 
  C303.675171,101.323486 301.248138,98.810738 296.379303,98.527756 
  C295.517822,98.477684 294.703491,97.615738 293.629120,96.989899 
  C291.445221,100.659332 288.966583,102.367607 285.605652,98.453316 
  C285.136261,97.906593 283.731964,98.086136 283.373138,97.532440 
  C278.464142,89.957054 269.629639,91.326973 262.653992,88.608253 
  C259.374451,87.330055 255.276276,87.950577 251.558090,88.049561 
  C246.696060,88.178993 241.846924,88.747475 236.984848,88.933441 
  C232.747894,89.095497 228.486969,88.797028 224.264908,89.098259 
  C222.644516,89.213860 221.003311,90.267151 219.545670,91.173210 
  C216.706253,92.938194 214.050339,95.003799 211.173477,96.698921 
  C210.560837,97.059898 209.130661,96.643501 208.413834,96.122223 
  C201.996552,91.455666 196.179871,92.844765 190.074631,97.076492 
  C187.747482,98.689514 184.349091,98.757019 181.216736,99.256592 
  C187.664276,93.410843 194.612732,88.313522 203.585373,85.990250 
  C209.293213,89.133446 212.945419,84.479240 217.285217,83.123459 
  C219.465347,82.442375 221.494171,81.008957 223.697433,80.717682 
  C231.914642,79.631340 240.176147,78.880638 248.420013,77.994659 
  C249.885315,77.837173 251.845566,78.180130 252.730469,77.368622 
  C260.688538,70.070488 268.370789,74.977173 275.528351,78.312439 
  C280.686615,80.716072 284.939362,85.011215 291.346802,83.056747 
  C292.035919,82.846542 293.178406,83.068703 293.697815,83.542656 
  C295.709137,85.377937 297.296753,87.826958 300.747528,86.334694 
  C301.154175,86.158844 302.426483,87.984779 303.649261,89.338348 
  C304.688507,95.859207 310.503082,94.805397 313.987946,96.986427 
  C314.640015,98.104469 315.292084,99.222504 315.971863,101.117439 
  C315.999725,105.596222 315.999878,109.298111 316.000000,113.000000 
z"/>
<path fill="#3A98FF" opacity="1.000000" stroke="none" 
  d="
M313.862000,96.693336 
  C310.503082,94.805397 304.688507,95.859207 303.999908,89.397888 
  C304.000153,88.249619 304.001495,87.497414 304.005951,86.368958 
  C306.773590,88.628952 309.538147,91.265190 312.638611,93.951508 
  C313.228394,94.801147 313.482208,95.600700 313.862000,96.693336 
z"/>
<path fill="#1356D7" opacity="1.000000" stroke="none" 
  d="
M138.240845,208.080032 
  C135.703445,209.745819 133.166031,211.411591 130.324799,213.291321 
  C128.626816,213.324783 127.232666,213.144318 125.416794,212.992493 
  C124.995079,213.021118 124.919601,212.634598 124.892090,212.439758 
  C125.743797,211.562103 126.623016,210.879288 128.616241,209.331329 
  C121.994560,209.403976 118.763275,203.706909 112.059326,204.207397 
  C108.424568,204.478729 103.810860,200.371796 100.730095,197.184845 
  C96.599129,192.911514 93.524620,187.616928 90.215324,182.098923 
  C94.260933,178.967056 97.313782,179.762848 100.581978,182.938263 
  C105.967133,188.170532 111.791931,192.951920 117.470924,197.877792 
  C118.063080,198.391403 118.912079,198.619919 119.658241,198.942947 
  C122.454742,200.153732 125.296356,201.267746 128.049622,202.569138 
  C131.999237,204.435989 135.919922,205.538055 140.330841,203.028320 
  C140.878769,203.083023 141.097717,203.107193 141.278778,203.482361 
  C140.753983,204.829971 140.267120,205.826584 139.780258,206.823196 
  C139.780258,206.823196 139.863800,206.886505 139.587799,206.851013 
  C138.954803,207.237030 138.597824,207.658524 138.240845,208.080032 
z"/>
<path fill="#145AE1" opacity="1.000000" stroke="none" 
  d="
M140.001831,202.997787 
  C135.919922,205.538055 131.999237,204.435989 128.049622,202.569138 
  C125.296356,201.267746 122.454742,200.153732 119.658241,198.942947 
  C118.912079,198.619919 118.063080,198.391403 117.470924,197.877792 
  C111.791931,192.951920 105.967133,188.170532 100.581978,182.938263 
  C97.313782,179.762848 94.260933,178.967056 90.209862,181.732971 
  C87.330841,176.263458 84.676064,170.498016 82.031952,164.344864 
  C82.356316,163.869247 82.607620,163.692581 82.898720,163.216019 
  C83.904099,163.478424 84.807289,163.951950 85.850891,164.713959 
  C85.991310,165.002411 85.993385,165.502274 85.997139,166.161041 
  C87.126366,168.538498 88.420853,171.832031 89.351151,171.732193 
  C98.598686,170.739685 102.608322,180.556488 110.670067,181.712891 
  C111.015076,181.762375 111.193764,182.563217 111.570343,182.862564 
  C116.614830,186.872650 121.601791,190.963882 126.802055,194.762497 
  C127.967842,195.614059 129.958923,195.842224 131.467209,195.629181 
  C137.397079,194.791626 139.863281,196.806976 140.001831,202.997787 
z"/>
<path fill="#6DBEFE" opacity="1.000000" stroke="none" 
  d="
M322.313416,160.860229 
  C320.074158,158.575150 321.117889,156.714966 323.680054,155.044403 
  C324.040527,155.423340 324.045929,155.858719 324.061218,156.619415 
  C323.569336,158.177856 323.067535,159.410995 322.313416,160.860229 
z"/>
<path fill="#3296FF" opacity="1.000000" stroke="none" 
  d="
M316.000000,113.424065 
  C315.999878,109.298111 315.999725,105.596222 316.001007,101.444107 
  C316.785339,101.642967 317.568268,102.292038 318.661469,102.983856 
  C319.134827,103.884918 319.297913,104.743248 319.721985,105.806107 
  C320.985901,109.822227 322.152069,113.600121 322.947601,117.454514 
  C323.809326,121.629776 324.325562,125.876343 324.989746,130.539993 
  C324.009674,128.098114 322.955444,125.230743 322.091675,122.307121 
  C321.731934,121.089600 321.777954,119.752205 321.585876,117.972984 
  C319.767670,118.560638 318.309296,119.031990 316.000000,119.778366 
  C316.000000,117.605606 316.000000,115.726868 316.000000,113.424065 
z"/>
<path fill="#3296FF" opacity="1.000000" stroke="none" 
  d="
M323.204773,140.279953 
  C323.453644,138.459885 323.909180,136.898560 324.682983,135.167236 
  C325.309906,135.093079 325.562988,135.268936 325.870178,135.730499 
  C326.274628,137.056580 326.569366,138.176910 326.665527,139.762177 
  C326.253296,140.408981 326.093658,140.629898 325.988068,140.889862 
  C325.129211,140.772812 324.270325,140.655762 323.204773,140.279953 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M117.659012,228.035904 
  C117.437408,228.783875 116.898537,229.576309 116.179611,230.180725 
  C116.446945,229.355255 116.894341,228.717804 117.659012,228.035904 
z"/>
<path fill="#3E9BFF" opacity="1.000000" stroke="none" 
  d="
M326.193665,140.814545 
  C326.093658,140.629898 326.253296,140.408981 326.637329,140.113739 
  C326.802032,140.318802 326.665924,140.565079 326.193665,140.814545 
z"/>
<path fill="#145AE1" opacity="1.000000" stroke="none" 
  d="
M131.777740,221.886246 
  C131.958054,221.598999 132.138351,221.311752 132.949509,220.994858 
  C136.384918,218.975479 139.189468,216.985733 141.994019,214.996002 
  C144.308914,219.269806 147.637695,223.124207 146.471436,228.677551 
  C146.219360,229.877869 147.830002,231.469376 148.813507,233.313568 
  C147.036530,233.702423 145.380417,234.064835 141.798416,234.848663 
  C143.800552,235.966507 144.829239,236.540833 145.932465,237.435669 
  C143.959808,237.840057 141.912613,237.923965 139.425995,237.990936 
  C132.290085,237.646988 125.593590,237.319946 118.425110,237.007645 
  C117.953125,237.022369 117.989952,236.998856 117.887482,236.698090 
  C117.088234,235.836624 116.391457,235.275940 115.694687,234.715256 
  C115.694687,234.715256 115.783371,234.236069 116.171280,233.904510 
  C117.610420,233.330063 118.661659,233.087158 120.078514,232.855057 
  C124.451111,229.736481 128.467407,226.618622 132.420761,223.422913 
  C132.541550,223.325272 132.006851,222.416733 131.777740,221.886246 
z"/>
<path fill="#1356D7" opacity="1.000000" stroke="none" 
  d="
M142.141220,214.696091 
  C139.189468,216.985733 136.384918,218.975479 133.204636,220.952835 
  C135.426056,218.030289 138.076294,215.165314 140.603546,212.195679 
  C142.619766,209.826553 144.486099,207.329895 146.760223,204.429962 
  C147.352600,203.332916 147.603729,202.695770 148.210663,202.048569 
  C149.040405,202.016479 149.514343,201.994431 149.988281,201.972382 
  C149.994110,202.421432 149.999939,202.870468 150.012787,203.656128 
  C149.750046,204.486069 149.480286,204.979370 149.101288,205.731903 
  C146.757492,208.792786 144.522949,211.594482 142.141220,214.696091 
z"/>
<path fill="#145AE1" opacity="1.000000" stroke="none" 
  d="
M152.014648,235.773804 
  C150.880295,236.709808 149.746658,237.392624 148.287170,237.990234 
  C149.056564,236.937836 150.151825,235.970627 151.635086,235.008850 
  C152.020523,235.183075 152.017960,235.351852 152.014648,235.773804 
z"/>
<path fill="#227FFE" opacity="1.000000" stroke="none" 
  d="
M273.010986,138.755035 
  C272.901001,138.588867 272.954987,138.421066 273.008972,138.253265 
  C273.064301,138.419983 273.119598,138.586700 273.010986,138.755035 
z"/>
<path fill="#1C5BF4" opacity="1.000000" stroke="none" 
  d="
M204.803619,157.995483 
  C209.084167,170.345825 225.834396,170.593704 232.676208,163.975067 
  C233.971970,162.721573 234.308777,160.476791 235.254669,158.278290 
  C236.253891,156.904083 237.086502,155.940979 237.919098,154.977875 
  C242.256790,159.590683 236.122711,161.490753 235.298111,164.768250 
  C235.059235,165.717682 233.853043,166.423752 233.054352,167.585815 
  C232.998474,168.115112 232.978546,168.299988 232.920532,168.761658 
  C227.069000,169.340454 221.252670,169.880630 215.443665,169.810867 
  C213.501373,169.787537 211.577820,168.206055 209.322174,167.183502 
  C204.261093,163.200211 203.252823,161.200409 204.803619,157.995483 
z"/>
<path fill="#0F309D" opacity="1.000000" stroke="none" 
  d="
M237.903687,154.755463 
  C237.086502,155.940979 236.253891,156.904083 235.119110,157.994843 
  C233.696442,158.743011 232.589905,159.390442 231.453156,159.979630 
  C224.858536,163.397705 223.137680,163.171890 216.987823,157.585953 
  C214.974777,152.921127 213.066589,148.920547 215.592117,144.432983 
  C215.983429,143.737640 215.168533,142.363480 214.911438,141.303223 
  C216.314590,140.829468 217.717758,140.355713 219.692474,140.128357 
  C221.208542,141.572525 222.079926,142.838791 223.118912,143.948090 
  C224.088791,144.983597 225.236725,145.852356 226.306274,146.794510 
  C226.306274,146.794510 226.171310,146.832275 226.153625,147.165802 
  C228.880478,153.371643 233.152145,148.002869 235.340561,149.420837 
  C235.974854,150.930405 236.609146,152.439972 237.243423,153.949539 
  C237.548462,154.044525 237.763397,154.239029 237.903687,154.755463 
z"/>
<path fill="#08168B" opacity="1.000000" stroke="none" 
  d="
M237.324738,153.612457 
  C236.609146,152.439972 235.974854,150.930405 235.340561,149.420837 
  C233.152145,148.002869 228.880478,153.371643 226.171951,147.098175 
  C233.291000,148.565002 235.499786,147.612976 237.851166,141.465454 
  C241.454224,145.395538 240.209106,149.376511 237.324738,153.612457 
z"/>
<path fill="#8DCAFD" opacity="1.000000" stroke="none" 
  d="
M224.686829,231.624634 
  C222.242310,232.179794 219.516312,232.466461 216.357010,232.643555 
  C218.750931,232.141357 221.578125,231.748749 224.686829,231.624634 
z"/>
<path fill="#8DCAFD" opacity="1.000000" stroke="none" 
  d="
M202.010223,232.276428 
  C201.513351,232.504593 200.940292,232.485565 200.184296,232.229523 
  C200.645569,232.004776 201.289810,232.017014 202.010223,232.276428 
z"/>
<path fill="#8DCAFD" opacity="1.000000" stroke="none" 
  d="
M233.146667,230.250565 
  C232.807327,230.767899 232.152481,231.200439 231.204407,231.510010 
  C231.551193,230.979965 232.191177,230.572876 233.146667,230.250565 
z"/>
<path fill="#8DCAFD" opacity="1.000000" stroke="none" 
  d="
M211.006866,229.263245 
  C211.556839,229.156830 212.103668,229.304520 212.825989,229.679138 
  C212.437653,230.093582 211.873856,230.281097 211.156616,230.247086 
  C211.003387,229.856140 211.003571,229.686737 211.006866,229.263245 
z"/>
<path fill="#145FE8" opacity="1.000000" stroke="none" 
  d="
M182.209961,215.871170 
  C182.094482,215.673935 182.259644,215.429688 182.693085,215.126602 
  C182.829712,215.331558 182.672791,215.583679 182.209961,215.871170 
z"/>
<path fill="#0409C6" opacity="1.000000" stroke="none" 
  d="
M115.397743,234.762146 
  C116.391457,235.275940 117.088234,235.836624 117.887756,236.719604 
  C116.489540,236.894852 114.988579,236.747818 113.257690,236.299835 
  C113.718765,235.602295 114.409782,235.205673 115.397743,234.762146 
z"/>
<path fill="#145FE8" opacity="1.000000" stroke="none" 
  d="
M140.330841,203.028320 
  C139.863281,196.806976 137.397079,194.791626 131.467209,195.629181 
  C129.958923,195.842224 127.967842,195.614059 126.802055,194.762497 
  C121.601791,190.963882 116.614830,186.872650 111.570343,182.862564 
  C111.193764,182.563217 111.015076,181.762375 110.670067,181.712891 
  C102.608322,180.556488 98.598686,170.739685 89.351151,171.732193 
  C88.420853,171.832031 87.126366,168.538498 85.999352,166.410950 
  C93.625320,166.567703 99.970375,169.517715 106.557678,173.737656 
  C112.832932,177.757645 119.662094,180.836700 124.966858,186.330231 
  C128.553162,190.044144 133.160294,191.554123 138.595932,191.989960 
  C143.602783,192.228912 145.179581,195.375443 145.998230,199.947479 
  C146.002884,201.063828 146.003830,201.488754 145.666306,202.021210 
  C143.990768,202.462952 142.653732,202.797165 141.316681,203.131378 
  C141.097717,203.107193 140.878769,203.083023 140.330841,203.028320 
z"/>
<path fill="#1B6AF2" opacity="1.000000" stroke="none" 
  d="
M146.004791,201.913666 
  C146.003830,201.488754 146.002884,201.063828 146.005615,200.320251 
  C147.340302,200.410370 149.739532,197.501373 149.986618,201.627014 
  C149.514343,201.994431 149.040405,202.016479 147.899597,202.067825 
  C146.823410,202.035965 146.414093,201.974808 146.004791,201.913666 
z"/>
<path fill="#1438E6" opacity="1.000000" stroke="none" 
  d="
M131.467285,221.997192 
  C132.006851,222.416733 132.541550,223.325272 132.420761,223.422913 
  C128.467407,226.618622 124.451111,229.736481 120.105270,232.543808 
  C119.811234,231.806915 119.856056,231.392075 119.900879,230.977234 
  C120.173409,230.757263 120.445938,230.537277 121.127274,230.019165 
  C122.073891,229.169937 122.611687,228.618820 123.149483,228.067688 
  C123.607918,227.710693 124.066360,227.353699 125.007278,226.780502 
  C125.939857,226.024734 126.389954,225.485168 126.840042,224.945587 
  C128.278961,223.999786 129.717880,223.053970 131.467285,221.997192 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M145.666306,202.021210 
  C146.414093,201.974808 146.823410,202.035965 147.543793,202.077866 
  C147.603729,202.695770 147.352600,203.332916 146.850037,204.080963 
  C144.577621,205.095535 142.556610,205.999176 140.157928,206.863007 
  C140.267120,205.826584 140.753983,204.829971 141.278778,203.482361 
  C142.653732,202.797165 143.990768,202.462952 145.666306,202.021210 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M119.569305,231.000763 
  C119.856056,231.392075 119.811234,231.806915 119.739655,232.533005 
  C118.661659,233.087158 117.610420,233.330063 116.239136,233.670502 
  C117.025307,232.853439 118.131516,231.938858 119.569305,231.000763 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M126.560287,224.975983 
  C126.389954,225.485168 125.939857,226.024734 125.221756,226.579437 
  C125.396011,226.065170 125.838272,225.535782 126.560287,224.975983 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M122.825195,228.065430 
  C122.611687,228.618820 122.073891,229.169937 121.244308,229.774475 
  C121.468658,229.239655 121.984787,228.651398 122.825195,228.065430 
z"/>
<path fill="#DEECFB" opacity="1.000000" stroke="none" 
  d="
M138.525986,208.036682 
  C138.597824,207.658524 138.954803,207.237030 139.597412,206.799500 
  C139.525726,207.186752 139.168427,207.590042 138.525986,208.036682 
z"/>
<path fill="#313780" opacity="1.000000" stroke="none" 
  d="
M214.602051,141.435379 
  C215.168533,142.363480 215.983429,143.737640 215.592117,144.432983 
  C213.066589,148.920547 214.974777,152.921127 216.744568,157.293777 
  C212.277588,155.343521 210.651581,149.997910 212.876862,144.170761 
  C213.226120,143.256180 213.814713,142.432983 214.602051,141.435379 
z"/>
<path fill="#08168B" opacity="1.000000" stroke="none" 
  d="
M226.280457,146.384827 
  C225.236725,145.852356 224.088791,144.983597 223.118912,143.948090 
  C222.079926,142.838791 221.208542,141.572525 220.069489,140.068481 
  C221.278488,138.918365 222.682037,138.074524 224.260574,137.125473 
  C225.056473,140.657639 225.655548,143.316391 226.280457,146.384827 
z"/>
    </svg>
  );
}

function findMessageKline(messages: ChatMessage[], code: string) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const result = messages[i].result;
    if (result?.chart?.type === 'kline' && result.stocks?.some((stock) => stock.code === code)) return result.chart.data;
  }
  return undefined;
}

function ThinkingBanner() {
  return <div className="thinking-line">Stockbuddy <span className="thinking-shimmer"><span>思</span><span>考</span><span>中</span><span>.</span><span>.</span><span>.</span></span></div>;
}

function ProcessedBanner({ seconds }: { seconds: number }) {
  return <div className="processed-line">StockBuddy 已处理，共耗时 {seconds.toFixed(1)}s</div>;
}

function ThinkingTrace({ startedAt, steps }: { startedAt: string; steps: NonNullable<ChatMessage['steps']> }) {
  const [seconds, setSeconds] = useState(0);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <div className={cx(styles.trace, styles['thinking-trace'], open && styles.open)} data-trace>
      <button className={cx(styles['trace-header'], styles['thinking-header'])} onClick={() => setOpen(!open)} type="button">
        <span>思考了 {seconds} 秒</span><span className={styles['trace-caret']}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={cx(styles['trace-body'], styles['thinking-body'])} data-tracebody>
          {steps.map((step) => (
          <div className={styles['trace-step']} key={step.id}>
            <span className={styles.tag}>{step.agent}</span>
            <span className={styles.desc}>{dedupeLabelPrefix(step.agent, step.description)}</span>
            {step.detail ? <span className={styles.progress}>{step.detail}</span> : null}
          </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Trace({ steps }: { steps: NonNullable<ChatMessage['steps']> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx(styles.trace, open && styles.open)} data-trace>
      <button className={styles['trace-header']} onClick={() => setOpen(!open)} type="button">
        <span>分析步骤</span><span className={styles['trace-caret']}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={styles['trace-body']} data-tracebody>
          {steps.map((step) => (
            <div className={styles['trace-step']} key={`${step.id}-${step.status}`}>
              <span className={styles.tag}>{step.agent}</span>
              <span className={styles.desc}>{step.description}</span>
              {step.detail ? <span className={styles.progress}>{step.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RunEventTrace({ events }: { events: AgentRunEvent[] }) {
  const [open, setOpen] = useState(true);
  const visible = events.filter((event) => event.type !== 'final_answer');
  if (!visible.length) return null;
  return (
    <div className={cx(styles.trace, styles['run-event-trace'], open && styles.open)} data-trace>
      <button className={styles['trace-header']} onClick={() => setOpen(!open)} type="button">
        <span>执行过程</span><span className={styles['trace-caret']}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={styles['trace-body']} data-tracebody>
          {visible.map((event, index) => (
            <div className={styles['trace-step']} key={`${event.type}-${index}`}>
              <span className={styles.tag}>{eventLabel(event)}</span>
              <span className={styles.desc}>{eventDescription(event)}</span>
              {event.progress ? <span className={styles.progress}>{event.progress.current}/{event.progress.total}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function eventLabel(event: AgentRunEvent) {
  if (event.tool?.name) return event.tool.name;
  if (event.subAgent?.name) return event.subAgent.name;
  if (event.command?.name) return event.command.name;
  return {
    plan_created: '计划',
    command_detected: 'Command',
    intent_detected: '意图',
    tool_started: '工具开始',
    tool_completed: '工具完成',
    tool_failed: '工具失败',
    subagent_started: 'Agent开始',
    subagent_completed: 'Agent完成',
    progress_updated: '进度',
    evidence_added: '证据',
    summary_completed: '汇总',
    step_started: '步骤开始',
    step_completed: '步骤完成',
    tool_result: '工具',
    final_answer: '结论',
    error: '错误',
  }[event.type];
}

function eventDescription(event: AgentRunEvent) {
  const label = eventLabel(event);
  const text = event.message ?? event.step?.description ?? event.tool?.outputSummary ?? event.subAgent?.summary ?? '';
  return dedupeLabelPrefix(label, text);
}

function dedupeLabelPrefix(label: string | undefined, text: string) {
  if (!label) return text;
  return text.startsWith(`${label}：`) || text.startsWith(`${label}:`) ? text.slice(label.length + 1).trim() : text;
}

function ToolCallTrace({ toolCalls }: { toolCalls: ToolCallRecord[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cx(styles.trace, styles['tool-trace'], open && styles.open)}>
      <button className={styles['trace-header']} onClick={() => setOpen(!open)} type="button">
        <span>工具调用</span><span className={styles['trace-caret']}>{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={cx(styles['trace-body'], styles['tool-call-body'])}>
          {toolCalls.map((toolCall) => {
            const duration = toolCall.endedAt ? new Date(toolCall.endedAt).getTime() - new Date(toolCall.startedAt).getTime() : undefined;
            return (
              <div className={styles['tool-call']} key={toolCall.id}>
                <div className={styles['tool-call-header']}>
                  <span>{toolCall.toolName}</span>
                  <span className={styles['tool-call-meta']}>{toolCall.error ? '失败' : '成功'}{duration !== undefined ? ` · ${duration}ms` : ''}</span>
                </div>
                <div className={styles['tool-call-meta']}>输入：{toolCall.inputSummary ?? summarizeInline(toolCall.input)}</div>
                {toolCall.error ? <div className={styles['tool-call-error']}>{toolCall.error}</div> : <div className={styles['tool-call-meta']}>输出：{toolCall.outputSummary ?? summarizeInline(toolCall.output)}</div>}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function summarizeInline(value: unknown) {
  if (value === undefined) return '--';
  return (typeof value === 'string' ? value : JSON.stringify(value)).replace(/\s+/g, ' ').slice(0, 160);
}

function ResultCard({ result, onStockClick, onBoardClick }: { result: AgentResultCard; onStockClick(stock: StockDetail): void; onBoardClick(board: Pick<BoardDetail, 'code' | 'name'>): void }) {
  const [open, setOpen] = useState(!isNewsAnnouncementCard(result));
  const [rowsOpen, setRowsOpen] = useState(false);
  const headers = result.rows?.[0] ? Object.keys(result.rows[0]) : [];
  const isCollapsible = isNewsAnnouncementCard(result);
  const isDailyDragonTiger = isDailyDragonTigerCard(result);
  const rows = result.rows ?? [];
  const visibleRows = isDailyDragonTiger && !rowsOpen ? rows.slice(0, 5) : rows;
  return (
    <div className={styles.card} data-card>
      <div className={styles['card-title']}>
        <span>{result.title}</span>
        <span className={styles.sub}>{result.subtitle}</span>
        {isCollapsible ? <button className={styles['card-toggle']} onClick={() => setOpen((value) => !value)} type="button">{open ? '收起' : '展开'}</button> : null}
      </div>
      {result.metrics?.length ? (
        <div className={styles['metric-row']}>
          {result.metrics.map((metric) => <div className={styles['metric-item']} key={metric.label}><div className={styles.lbl}>{metric.label}</div><div className={cx(styles.val, metric.tone ? styles[metric.tone] : undefined)}>{metric.value}</div></div>)}
        </div>
      ) : null}
      {open && result.chart?.type === 'kline' ? <KlineChart data={result.chart.data} stock={result.stocks?.[0]} /> : null}
      {open && headers.length ? (
        <>
          <div className={styles['table-wrap']}>
            <table className={cx(styles.tbl, isDailyDragonTiger && styles['lhb-table'])}>
              <thead><tr>{headers.map((header, index) => <th className={getTableCellClass(header, index, headers.length)} key={header}>{header}</th>)}</tr></thead>
              <tbody>
                {visibleRows.map((row, index) => (
                  <tr key={index}>{headers.map((header, colIndex) => <td className={getTableCellClass(header, colIndex, headers.length)} key={header}>{renderCell(header, row, onStockClick, onBoardClick)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {isDailyDragonTiger && rows.length > 5 ? (
            <button className={styles['table-toggle']} onClick={() => setRowsOpen((value) => !value)} type="button">
              {rowsOpen ? '收起列表' : `展开全部 ${rows.length} 条`}
            </button>
          ) : null}
        </>
      ) : null}
      {open && result.narrative && !isCollapsible ? <div className={styles['card-narrative']} dangerouslySetInnerHTML={{ __html: renderMarkdownContent(result.narrative, { disclaimer: result.title !== '技术指标摘要' }) }} /> : null}
    </div>
  );
}

function isDailyDragonTigerCard(result: AgentResultCard) {
  return result.title === '全市场龙虎榜';
}

function getTableCellClass(header: string, index?: number, total?: number) {
  if (total !== undefined && index === total - 1) return styles['col-last'];
  if (index === 2) return styles['col-wrap'];
  if (/^(名称|name|title)$/i.test(header)) return styles['col-name'];
  if (/上榜原因|reason/i.test(header)) return styles['col-reason'];
  return undefined;
}

function isNewsAnnouncementCard(result: AgentResultCard) {
  return /新闻公告/.test(result.title) || (result.metrics?.some((metric) => metric.label === '新闻') && result.metrics?.some((metric) => metric.label === '公告'));
}

function KlineChart({ data, stock }: { data: NonNullable<AgentResultCard['chart']>['data']; stock?: StockDetail }) {
  const [isModalOpen, setModalOpen] = useState(false);
  return (
    <div className={styles['card-kline']}>
      <button className={styles['kline-expand']} onClick={() => setModalOpen(true)} title="放大K线图" type="button">⛶</button>
      <StockKlineChart stock={stock} data={data} height={230} />
      {isModalOpen ? <KlineModal stock={stock ?? { code: '', name: '技术指标摘要' }} data={data} onClose={() => setModalOpen(false)} /> : null}
    </div>
  );
}

function renderCell(header: string, row: Record<string, unknown>, onStockClick: (stock: StockDetail) => void, onBoardClick: (board: Pick<BoardDetail, 'code' | 'name'>) => void) {
  const value = stringifyCell(row[header]);
  const name = pickCell(row, ['名称', 'name', 'title']);
  const code = pickCell(row, ['代码', 'code', 'symbol']);
  if (/^(名称|name|title)$/i.test(header) && code) {
    if (isBoardCode(code) || /板块|行业|概念/.test(name || value)) return <button className="stock-link btn-link" onClick={() => onBoardClick({ code, name: name || value })} type="button">{value}</button>;
    return <button className="stock-link btn-link" onClick={() => onStockClick({ code, name: name || value })} type="button">{value}</button>;
  }
  if (/涨跌幅|涨幅|涨跌|change|pct/i.test(header)) return <span className={getChinaMarketTone(value)}>{value}</span>;
  if (/净流入|资金|amount|turnover|flow/i.test(header)) return <span className={getChinaMarketTone(value)}>{formatChinaMoney(value)}</span>;
  if (/链接|url/i.test(header) && /^https?:\/\//.test(value)) return <a href={value} target="_blank" rel="noreferrer">查看</a>;
  return value;
}

function pickCell(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return stringifyCell(value);
  }
  return '';
}

function stringifyCell(value: unknown) {
  if (value === undefined || value === null || value === '') return '--';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getChinaMarketTone(value: string) {
  const n = Number(String(value).replace(/[^\d.-]/g, ''));
  if (n > 0) return 'cn-up';
  if (n < 0) return 'cn-down';
  return '';
}

function formatChinaMoney(value: string) {
  const text = String(value).trim();
  const n = Number(text.replace(/,/g, '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return text;
  if (/万|亿/.test(text)) return text.replace(/\s+/g, '');
  const abs = Math.abs(n);
  const sign = n > 0 && /^\+/.test(text) ? '+' : n < 0 ? '-' : '';
  const amount = abs >= 100_000_000 ? `${(abs / 100_000_000).toFixed(2)}亿` : abs >= 10_000 ? `${(abs / 10_000).toFixed(2)}万` : abs.toFixed(0);
  return `${sign}${amount}`;
}

function formatMessageTime(createdAt: string, now: number) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.max(0, now - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (isSameDay(date, new Date(now))) return `${Math.floor(diff / hour)} 小时前`;
  if (isYesterday(date, new Date(now))) return `昨天 ${formatHM(date)}`;
  if (diff < 7 * 24 * hour) return `${formatWeekday(date)} ${formatHM(date)}`;
  if (date.getFullYear() === new Date(now).getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日 ${formatHM(date)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatHM(date)}`;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isYesterday(date: Date, now: Date) {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  return isSameDay(date, yesterday);
}

function formatWeekday(date: Date) {
  return ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][date.getDay()];
}

function formatHM(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function isGreeting(text: string) {
  return /^(你好|您好|hi|hello|hey|嗨|哈喽)[!！。\s]*$/i.test(text.trim());
}

function createThinkingSteps(text: string): NonNullable<ChatMessage['steps']> {
  const commandSteps = getCommandThinkingSteps(text);
  if (commandSteps) return commandSteps;

  const singleAgent = getSingleAgentCommand(text);
  if (singleAgent) {
    return [
      { id: 'quote', agent: 'DataAgent', description: '0/3 获取实时行情', status: 'running' },
      { id: 'market-data', agent: 'DataAgent', description: '1/3 拉取K线、指标与新闻样本', status: 'pending' },
      { id: `analysis-${singleAgent.id}`, agent: singleAgent.label.replace('agent', ''), description: `2/3 调用${singleAgent.label}`, status: 'pending' },
    ];
  }

  if (isStockAnalysisQuery(text)) {
    return [
      { id: 'quote', agent: 'DataAgent', description: '0/8 获取实时行情', status: 'running' },
      { id: 'market-data', agent: 'DataAgent', description: '1/8 拉取K线、技术指标与新闻样本', status: 'pending' },
      { id: 'analysis-technical', agent: '技术面分析', description: '2/8 调用技术面子Agent', status: 'pending' },
      { id: 'analysis-fundamental', agent: '基本面分析', description: '3/8 调用基本面子Agent', status: 'pending' },
      { id: 'analysis-capital', agent: '资金面分析', description: '4/8 调用资金面子Agent', status: 'pending' },
      { id: 'analysis-sentiment', agent: '情绪面分析', description: '5/8 调用情绪面子Agent', status: 'pending' },
      { id: 'analysis-chip', agent: '筹码分析', description: '6/8 调用筹码分析子Agent', status: 'pending' },
      { id: 'analysis-overview', agent: '汇总分析Agent', description: '7/8 汇总五维结果并生成报告', status: 'pending' },
    ];
  }
  const hasStock = /[一-龥]{2,}|\d{6}/.test(text);
  return [
    { id: 'understand', agent: '理解问题', description: `识别用户意图：${text.slice(0, 28)}${text.length > 28 ? '…' : ''}`, status: 'running' },
    { id: 'collect', agent: '采集数据', description: hasStock ? '准备拉取行情、财务、估值与资金面数据' : '准备检索相关市场、板块与资金线索', status: 'pending' },
    { id: 'analyze', agent: '生成结论', description: '汇总基本面、技术面与风险点，组织可执行回答', status: 'pending' },
    { id: 'risk', agent: '风险核查', description: '检查异常波动、估值偏离与潜在风险提示', status: 'pending' },
  ];
}

function getCommandThinkingSteps(text: string): NonNullable<ChatMessage['steps']> | undefined {
  const command = text.trim().split(/\s+/, 1)[0];
  const stockTarget = text.trim().slice(command.length).trim() || '目标股票';
  const map: Record<string, NonNullable<ChatMessage['steps']>> = {
    '/网页内容总结': [
      { id: 'understand', agent: '理解问题', description: `识别网页总结任务：${text.slice(0, 36)}${text.length > 36 ? '…' : ''}`, status: 'running' },
      { id: 'collect-web', agent: '采集网页数据', description: '使用 Crawl4AI 提取网页正文、标题与可读内容', status: 'pending' },
      { id: 'summarize-web', agent: '汇总网页数据', description: '清洗正文并生成中文 Markdown 摘要', status: 'pending' },
    ],
    '/行业轮动': [
      { id: 'understand', agent: '理解问题', description: '识别行业轮动命令', status: 'running' },
      { id: 'collect-sector', agent: '采集行业数据', description: '拉取行业涨幅榜与板块资金流', status: 'pending' },
      { id: 'summarize-sector', agent: '汇总行业数据', description: '整理强势行业、资金流向与轮动风险', status: 'pending' },
    ],
    '/龙虎榜': [
      { id: 'understand', agent: '理解问题', description: `识别个股龙虎榜命令：${stockTarget}`, status: 'running' },
      { id: 'collect-lhb', agent: '采集龙虎榜数据', description: '拉取个股近30日上榜记录与买卖席位', status: 'pending' },
      { id: 'summarize-lhb', agent: '汇总龙虎榜数据', description: '整理净买入、营业部席位与短线风险', status: 'pending' },
    ],
    '/全市场龙虎榜': [
      { id: 'understand', agent: '理解问题', description: '识别全市场龙虎榜命令', status: 'running' },
      { id: 'collect-market-lhb', agent: '采集龙虎榜数据', description: '拉取全市场龙虎榜净买入排名', status: 'pending' },
      { id: 'summarize-market-lhb', agent: '汇总龙虎榜数据', description: '整理买入席位、热门个股与短线风险', status: 'pending' },
    ],
    '/题材归因': [
      { id: 'understand', agent: '理解问题', description: '识别题材归因命令', status: 'running' },
      { id: 'collect-theme', agent: '采集题材数据', description: '拉取强势股、热点题材与资金流数据', status: 'pending' },
      { id: 'summarize-theme', agent: '汇总题材数据', description: '归纳上涨题材、代表个股与持续性风险', status: 'pending' },
    ],
    '/新闻公告': [
      { id: 'understand', agent: '理解问题', description: `识别新闻公告命令：${stockTarget}`, status: 'running' },
      { id: 'collect-news', agent: '采集新闻公告', description: '拉取个股最近新闻、公告与事件线索', status: 'pending' },
      { id: 'summarize-news', agent: '汇总新闻公告', description: '解读利好利空、事件影响与信息风险', status: 'pending' },
    ],
    '/综合投研报告': [
      { id: 'understand', agent: '理解问题', description: `识别综合投研报告命令：${stockTarget}`, status: 'running' },
      { id: 'collect-stock', agent: '采集个股数据', description: '拉取行情、K线、新闻、资金与筹码数据', status: 'pending' },
      { id: 'summarize-stock', agent: '汇总投研结论', description: '调用多维分析 Agent 并生成综合投研报告', status: 'pending' },
    ],
  };
  return map[command];
}

function getSingleAgentCommand(text: string) {
  const command = builtInSlashItems.find((item) => item.section === 'Sub Agents' && text.startsWith(`${item.command} `));
  return command;
}

function isStockAnalysisQuery(text: string) {
  return /^\s*(?:\d{6}|茅台|贵州茅台|五粮液|泸州老窖|洋河股份|宁德|宁德时代|宁王|招行|招商银行|比亚迪|中信证券)\s*$/.test(text)
    || (/分析|诊股|个股分析|帮我看看|看看/.test(text) && /\d{6}|茅台|贵州茅台|五粮液|泸州老窖|洋河股份|宁德|宁德时代|宁王|招行|招商银行|比亚迪|中信证券/.test(text));
}

function renderCommandInText(content: string, slashItems: SlashItem[]) {
  const item = slashItems.find((command) => content.startsWith(command.command));
  if (!item) return content;
  return `<button class="command-chip msg-command-chip" title="${item.description}" type="button"><span class="slash-icon">/</span>${item.command}</button>${content.slice(item.command.length)}`;
}

const stockAliases: Array<[string, string]> = [
  ['贵州茅台', '600519'], ['茅台', '600519'],
  ['五粮液', '000858'],
  ['泸州老窖', '000568'],
  ['洋河股份', '002304'],
  ['招商银行', '600036'], ['招行', '600036'],
  ['宁德时代', '300750'], ['宁王', '300750'],
  ['比亚迪', '002594'],
  ['中信证券', '600030'],
  ['引力传媒', '603598'],
];

function renderMarkdownWithStocks(content: string) {
  return renderMarkdownContent(content);
}

function renderMarkdownContent(content: string, options: { disclaimer?: boolean } = {}) {
  const normalized = normalizeAnalysisContent(content, options.disclaimer !== false);
  const html = marked.parse(normalized, { async: false, breaks: true }) as string;
  return linkMarkets(html);
}

const standardDisclaimer = '以上内容基于公开数据自动生成，仅供研究参考，不构成投资建议。';
const disclaimerPatterns = [
  /以上内容基于(?:当前可用)?公开数据自动生成，仅供研究参考，不构成投资建议。/g,
  /以上内容基于当前可用公开数据自动生成，仅供研究参考，不构成投资建议。/g,
  /仅供研究参考，不构成投资建议。/g,
];

function normalizeAnalysisContent(content: string, showDisclaimer = true) {
  const withoutDisclaimer = disclaimerPatterns.reduce((text, pattern) => text.replace(pattern, ''), content).trim();
  return showDisclaimer && withoutDisclaimer ? `${colorScoreTable(withoutDisclaimer)}\n\n${renderDisclaimerLine()}` : colorScoreTable(withoutDisclaimer);
}

function renderDisclaimerLine() {
  return `<div class="disclaimer-line">${standardDisclaimer}</div>`;
}

function colorScoreTable(content: string) {
  const lines = content.split('\n');
  let inScoreTable = false;
  return lines.map((line) => {
    if (/^\|.*评分\(0-100\).*\|/.test(line)) {
      inScoreTable = true;
      return line;
    }
    if (inScoreTable && !line.trim().startsWith('|')) inScoreTable = false;
    if (!inScoreTable || /^\|\s*-+/.test(line)) return line;
    const cells = line.split('|');
    cells[3] = colorScoreCell(cells[3]);
    cells[4] = colorScoreCell(cells[4]);
    return cells.join('|');
  }).join('\n');
}

function colorScoreCell(cell = '') {
  return cell.replace(/(?<![\w"'>-])(\d{1,3}(?:\.\d+)?)(?![\w"'<-])/g, (match) => {
    const value = Number(match);
    if (!Number.isFinite(value) || value > 100) return match;
    const cls = value >= 80 ? 'score-high' : value >= 60 ? 'score-mid' : 'score-low';
    return `<span class="${cls}">${match}</span>`;
  });
}

function linkMarkets(html: string) {
  const stockPattern = new RegExp(`(${stockAliases.map(([name]) => escapeRegExp(name)).join('|')})（(\\d{6})）|(?<![\\w/.-])(BK\\d{3,6}|\\d{6})(?![\\w/.-])`, 'gi');
  return html.split(/(<[^>]+>)/g).map((part) => {
    if (part.startsWith('<')) return part;
    return part.replace(stockPattern, (match, name: string | undefined, pairedCode: string | undefined, codeOnly: string | undefined) => {
      const code = pairedCode ?? codeOnly ?? stockAliases.find(([alias]) => alias === name)?.[1] ?? '';
      if (isBoardCode(code)) return `<a href="#" class="stock-link" data-board-code="${code.toUpperCase()}" data-board-name="${code.toUpperCase()}">${match}</a>`;
      const stockName = name ?? stockAliases.find(([, aliasCode]) => aliasCode === code)?.[0] ?? code;
      return `<a href="#" class="stock-link" data-stock-code="${code}" data-stock-name="${stockName}">${match}</a>`;
    });
  }).join('');
}

function isBoardCode(code: string) {
  return /^BK\d{3,6}$/i.test(code);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
