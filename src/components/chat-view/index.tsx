import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import gsap from 'gsap';
import { marked } from 'marked';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { KlineModal, StockKlineChart } from '../kline-chart';
import type { AgentResultCard, ChatMessage, StockDetail } from '../../shared/types';
import { useAppStore } from '../../store/app-store';
import styles from './index.module.scss';
import cx from '../../shared/cx';

const hints = ['选股', '诊股', '我的持仓', '北向资金', '热点板块'];

const slashItems = [
  { id: 'comprehensive-report', section: 'Commands', label: '综合投研报告', command: '/综合投研报告', description: '调用五个子 Agent，生成完整综合投资报告', argPlaceholder: '[输入股票代码或股票名称]' },
  { id: 'news-announcements', section: 'Commands', label: '新闻公告', command: '/新闻公告', description: '拉取指定个股最近的新闻和公告', argPlaceholder: '[输入股票代码或名称]' },
  { id: 'theme-attribution', section: 'Commands', label: '题材归因', command: '/题材归因', description: '今天哪些股票走强，主要是什么题材', argPlaceholder: '直接发送即可' },
  { id: 'technical-agent', section: 'Sub Agents', label: '技术面分析agent', command: '/技术面分析', description: '仅调用技术面Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
  { id: 'fundamental-agent', section: 'Sub Agents', label: '基本面分析agent', command: '/基本面分析', description: '仅调用基本面Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
  { id: 'capital-agent', section: 'Sub Agents', label: '资金面分析agent', command: '/资金面分析', description: '仅调用资金面Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
  { id: 'sentiment-agent', section: 'Sub Agents', label: '情绪面分析agent', command: '/情绪面分析', description: '仅调用情绪面Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
  { id: 'lhb-agent', section: 'Sub Agents', label: '龙虎榜分析agent', command: '/龙虎榜分析', description: '仅调用龙虎榜Agent 分析股票', argPlaceholder: '[请输入股票代码或名称]' },
];

export function ChatView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const messages = useAppStore((state) => state.messages);
  const [now, setNow] = useState(Date.now());
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const isSending = useAppStore((state) => state.isSending);
  const addMessage = useAppStore((state) => state.addMessage);
  const replaceLastAssistant = useAppStore((state) => state.replaceLastAssistant);
  const finalizeLastAssistant = useAppStore((state) => state.finalizeLastAssistant);
  const appendToLastAssistant = useAppStore((state) => state.appendToLastAssistant);
  const setSending = useAppStore((state) => state.setSending);
  const rememberStockKline = useAppStore((state) => state.rememberStockKline);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-msg]', { opacity: 0, y: 12, stagger: 0.06, duration: 0.3, ease: 'power2.out' });
      gsap.from('[data-card]', { opacity: 0, y: 8, scale: 0.98, stagger: 0.05, duration: 0.3, delay: 0.15 });
      gsap.from(`.${styles['input-hints']} .${styles.hint}`, { opacity: 0, y: 4, stagger: 0.02, duration: 0.15, delay: 0.2 });
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

  const slashOpen = input.startsWith('/') && !input.includes(' ');
  const activeCommand = slashItems.find((item) => input.startsWith(`${item.command} `));
  const commandArg = activeCommand ? input.slice(activeCommand.command.length + 1) : '';
  const selectSlashItem = (item = slashItems[selectedSlashIndex]) => {
    setInput(`${item.command} `);
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
    try {
      const api = getStocksenseApi();
      const requestId = `chat-${Date.now()}`;
      offToken = api.onChatToken?.((event) => {
        if (event.requestId === requestId) appendToLastAssistant(event.token);
      });
      const response = await api.sendChat({ conversationId: activeConversationId ?? 'conv-1', message: text, requestId });
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
      replaceLastAssistant({
        id: `assistant-error-${Date.now()}`,
        role: 'assistant',
        content: error instanceof Error ? error.message : '请求失败，请稍后重试。',
        createdAt: new Date().toISOString(),
      });
    } finally {
      offToken?.();
      setSending(false);
    }
  };

  useEffect(() => {
    const handleReport = (event: Event) => {
      const code = (event as CustomEvent<string>).detail;
      if (code) void send(`/综合投研报告 ${code}`);
    };
    window.addEventListener('stocksense:send-report', handleReport);
    return () => window.removeEventListener('stocksense:send-report', handleReport);
  });

  return (
    <div className={styles['chat-wrap']} ref={rootRef}>
      <div className={styles['chat-messages']} ref={listRef}>
        {messages.length === 0 ? <QuickEntry onSubmit={send} /> : messages.map((message) => <MessageBubble key={message.id} message={message} now={now} onStockClick={openStockDetail} />)}
      </div>
      {messages.length ? (
        <div className={styles['chat-input']}>
          {slashOpen ? <SlashCommandMenu selectedIndex={selectedSlashIndex} onSelect={selectSlashItem} /> : null}
          <div className={styles['input-hints']}>
            {hints.map((hint) => <button className={styles.hint} key={hint} onClick={() => setInput(hint)} type="button">{hint}</button>)}
          </div>
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
              }} placeholder="输入 / 查看 Commands 和 Skills，或直接输入股票名称/代码" />
            )}
            <button onClick={() => void send()} disabled={isSending} type="button">{isSending ? '分析中…' : '发送'}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SlashCommandMenu({ selectedIndex, onSelect }: { selectedIndex: number; onSelect(item?: typeof slashItems[number]): void }) {
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
              <span className={styles['slash-label']}>{item.label}</span>
              <span className={styles['slash-desc']}>{item.description}</span>
            </button>
          ) : null)}
        </div>
      ))}
    </div>
  );
}

function QuickEntry({ onSubmit }: { onSubmit(text: string): void }) {
  const [value, setValue] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const examples = ['五粮液', '贵州茅台', '宁德时代', '招商银行', '比亚迪'];
  const slashOpen = value.startsWith('/') && !value.includes(' ');
  const selectSlashItem = (item = slashItems[selectedSlashIndex]) => setValue(`${item.command} `);
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
        {slashOpen ? <SlashCommandMenu selectedIndex={selectedSlashIndex} onSelect={selectSlashItem} /> : null}
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

function MessageBubble({ message, now, onStockClick }: { message: ChatMessage; now: number; onStockClick(stock: StockDetail): void }) {
  const copySelectedMessage = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (message.role !== 'user') return;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (!text || !selection?.anchorNode || !event.currentTarget.contains(selection.anchorNode)) return;
    await navigator.clipboard.writeText(text);
    antdMessage.success('复制成功');
  };

  const openLinkedStock = (event: React.MouseEvent<HTMLDivElement>) => {
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
            🐳
            <span className={styles['whale-eye']} />
            <span className={styles['whale-splash']}>
              <span />
              <span />
              <span />
            </span>
          </span>
        )}
      </div>
      <div className={styles['msg-body']} data-msgbody>
        {message.thinking ? <ThinkingBanner /> : message.processedSeconds ? <ProcessedBanner seconds={message.processedSeconds} /> : null}
        {message.content.trim() ? <div className="msg-text" onClick={openLinkedStock} onMouseUp={copySelectedMessage} dangerouslySetInnerHTML={{ __html: renderMarkdownWithStocks(renderCommandInText(message.content)) }} /> : null}
        {message.thinking ? <ThinkingTrace startedAt={message.thinking.startedAt} steps={message.thinking.steps} /> : null}
        {message.steps?.length ? <Trace steps={message.steps} /> : null}
        {message.result ? <ResultCard result={message.result} onStockClick={onStockClick} /> : null}
        <div className={styles['msg-time']}>{formatMessageTime(message.createdAt, now)}</div>
      </div>
    </div>
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
  return <div className="thinking-line"><span className="thinking-shimmer"><span>思</span><span>考</span><span>中</span><span>.</span><span>.</span><span>.</span></span></div>;
}

function ProcessedBanner({ seconds }: { seconds: number }) {
  return <div className="processed-line">已处理，共耗时 {seconds.toFixed(1)}s</div>;
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
            <span className={styles.desc}>{step.description}</span>
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
        <span>思考链路</span><span className={styles['trace-caret']}>{open ? '▾' : '▸'}</span>
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

function ResultCard({ result, onStockClick }: { result: AgentResultCard; onStockClick(stock: StockDetail): void }) {
  const [open, setOpen] = useState(!isNewsAnnouncementCard(result));
  const headers = result.rows?.[0] ? Object.keys(result.rows[0]) : [];
  const isCollapsible = isNewsAnnouncementCard(result);
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
        <table className={styles.tbl}>
          <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>
            {result.rows!.map((row, index) => (
              <tr key={index}>{headers.map((header) => <td key={header}>{renderCell(header, row, onStockClick)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {open && result.narrative && !isCollapsible ? <div className={styles['card-narrative']} dangerouslySetInnerHTML={{ __html: renderMarkdownWithStocks(result.narrative) }} /> : null}
    </div>
  );
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

function renderCell(header: string, row: Record<string, unknown>, onStockClick: (stock: StockDetail) => void) {
  const value = stringifyCell(row[header]);
  const name = pickCell(row, ['名称', 'name', 'title']);
  const code = pickCell(row, ['代码', 'code', 'symbol']);
  if (/^(名称|name|title)$/i.test(header) && code) return <button className="stock-link btn-link" onClick={() => onStockClick({ code, name: name || value })} type="button">{value}</button>;
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
  if (diff < 30_000) return '刚刚';
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
      { id: 'analysis-lhb', agent: '龙虎榜分析', description: '6/8 调用龙虎榜子Agent', status: 'pending' },
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

function getSingleAgentCommand(text: string) {
  const command = slashItems.find((item) => item.section === 'Sub Agents' && text.startsWith(`${item.command} `));
  return command;
}

function isStockAnalysisQuery(text: string) {
  return /^\s*(?:\d{6}|茅台|贵州茅台|五粮液|泸州老窖|洋河股份|宁德|宁德时代|宁王|招行|招商银行|比亚迪|中信证券)\s*$/.test(text)
    || (/分析|诊股|个股分析|帮我看看|看看/.test(text) && /\d{6}|茅台|贵州茅台|五粮液|泸州老窖|洋河股份|宁德|宁德时代|宁王|招行|招商银行|比亚迪|中信证券/.test(text));
}

function renderCommandInText(content: string) {
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
  const html = marked.parse(content, { async: false, breaks: true }) as string;
  return linkStocks(html);
}

function linkStocks(html: string) {
  const pattern = new RegExp(`(${stockAliases.map(([name]) => escapeRegExp(name)).join('|')})（(\\d{6})）|(\\d{6})`, 'g');
  return html.replace(pattern, (match, name: string | undefined, pairedCode: string | undefined, codeOnly: string | undefined) => {
    const code = pairedCode ?? codeOnly ?? stockAliases.find(([alias]) => alias === name)?.[1];
    const stockName = name ?? stockAliases.find(([, aliasCode]) => aliasCode === code)?.[0] ?? code;
    return `<a href="#" class="stock-link" data-stock-code="${code}" data-stock-name="${stockName}">${match}</a>`;
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
