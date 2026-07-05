import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { marked } from 'marked';
import { getStocksenseApi } from '../shared/stocksenseApi';
import type { AgentResultCard, ChatMessage, StockDetail } from '../shared/types';
import { useAppStore } from '../store/appStore';

const hints = ['选股', '诊股', '我的持仓', '北向资金', '热点板块'];

export function ChatView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const messages = useAppStore((state) => state.messages);
  const [now, setNow] = useState(Date.now());
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const isSending = useAppStore((state) => state.isSending);
  const addMessage = useAppStore((state) => state.addMessage);
  const replaceLastAssistant = useAppStore((state) => state.replaceLastAssistant);
  const setSending = useAppStore((state) => state.setSending);
  const setSelectedStock = useAppStore((state) => state.setSelectedStock);
  const openRightPanel = useAppStore((state) => state.openRightPanel);

  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-msg]', { opacity: 0, y: 12, stagger: 0.06, duration: 0.3, ease: 'power2.out' });
      gsap.from('[data-card]', { opacity: 0, y: 8, scale: 0.98, stagger: 0.05, duration: 0.3, delay: 0.15 });
      gsap.from('.input-hints .hint', { opacity: 0, y: 4, stagger: 0.02, duration: 0.15, delay: 0.2 });
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

  const openStockDetail = async (stock: StockDetail) => {
    openRightPanel();
    setSelectedStock(stock);
    try {
      setSelectedStock(await getStocksenseApi().getStockDetail(stock.code));
    } catch {
      setSelectedStock(stock);
    }
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
      content: '思考中…',
      createdAt: new Date().toISOString(),
      thinking: { startedAt: new Date().toISOString(), steps: createThinkingSteps(text) },
    });
    try {
      const api = getStocksenseApi();
      const response = await api.sendChat({ conversationId: activeConversationId ?? 'conv-1', message: text });
      replaceLastAssistant(response.message);
      const stock = response.events.find((event) => event.stock)?.stock;
      if (stock) {
        openRightPanel();
        setSelectedStock(stock);
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
      setSending(false);
    }
  };

  return (
    <div className="chat-wrap" ref={rootRef}>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? <QuickEntry onSubmit={send} /> : messages.map((message) => <MessageBubble key={message.id} message={message} now={now} onStockClick={openStockDetail} />)}
      </div>
      <div className="chat-input">
        <div className="input-hints">
          {hints.map((hint) => <button className="hint" key={hint} onClick={() => setInput(hint)} type="button">{hint}</button>)}
        </div>
        <div className="input-row">
          <input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void send(); }} placeholder="选股 诊股 持仓 北向资金 热点板块" />
          <button onClick={() => void send()} disabled={isSending} type="button">{isSending ? '分析中…' : '发送'}</button>
        </div>
      </div>
    </div>
  );
}

function QuickEntry({ onSubmit }: { onSubmit(text: string): void }) {
  const [value, setValue] = useState('');
  const examples = ['五粮液', '贵州茅台', '宁德时代', '招商银行', '比亚迪'];
  return (
    <div className="quick-entry" data-quickentry>
      <div className="qe-hero" aria-hidden="true">
        <svg viewBox="0 0 420 200" xmlns="http://www.w3.org/2000/svg">
          <rect width="420" height="200" fill="var(--bg)" rx="8" />
          <g stroke="var(--surface)" strokeWidth="0.5" opacity="0.75"><line x1="40" y1="30" x2="380" y2="30" /><line x1="40" y1="60" x2="380" y2="60" /><line x1="40" y1="90" x2="380" y2="90" /><line x1="40" y1="120" x2="380" y2="120" /><line x1="40" y1="150" x2="380" y2="150" /><line x1="108" y1="30" x2="108" y2="150" /><line x1="176" y1="30" x2="176" y2="150" /><line x1="244" y1="30" x2="244" y2="150" /><line x1="312" y1="30" x2="312" y2="150" /></g>
          <path className="qe-wave" d="M60 150 Q 95 110, 130 120 T 200 90 T 270 100 T 340 70 L 360 150 Z" fill="rgba(59,130,246,0.08)" />
          <path className="qe-trend" d="M60 150 Q 95 110, 130 120 T 200 90 T 270 100 T 340 70" stroke="var(--accent)" strokeWidth="2" fill="none" strokeLinecap="round" />
          {[80, 140, 200, 260, 320].map((x, index) => <g key={x} transform={`translate(${x},${index % 2 ? 112 : 82})`}><g className="qe-candle" style={{ animationDelay: `${index * -0.35}s` }}><line x1="6" y1="0" x2="6" y2="40" stroke={index % 2 ? 'var(--danger)' : 'var(--success)'} strokeWidth="1.5" /><rect x="1" y="10" width="10" height="20" fill={index % 2 ? 'var(--danger)' : 'var(--success)'} rx="1" /></g></g>)}
          <line x1="40" y1="150" x2="380" y2="150" stroke="var(--border)" strokeWidth="1" />
        </svg>
      </div>
      <div className="qe-title">开始新的投研分析</div>
      <div className="qe-sub">输入股票名称或代码，AI 将为你深度解读</div>
      <div className="qe-search-box">
        <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(value); }} placeholder="例如：五粮液、000858、贵州茅台……" autoFocus />
        <button onClick={() => onSubmit(value)} type="button">开始分析</button>
      </div>
      <div className="qe-hints">
        {examples.map((example) => <button key={example} className="qe-hint" onClick={() => setValue(example)} type="button">{example}</button>)}
      </div>
    </div>
  );
}

function MessageBubble({ message, now, onStockClick }: { message: ChatMessage; now: number; onStockClick(stock: StockDetail): void }) {
  return (
    <div className={`msg ${message.role === 'user' ? 'user' : 'agent'}`} data-msg>
      <div className="msg-avatar" data-avatar>{message.role === 'user' ? '我' : '股'}</div>
      <div className="msg-body" data-msgbody>
        <div className="msg-text" dangerouslySetInnerHTML={{ __html: renderMarkdownWithStocks(message.content, onStockClick) }} />
        {message.thinking ? <ThinkingTrace startedAt={message.thinking.startedAt} steps={message.thinking.steps} /> : null}
        {message.steps?.length ? <Trace steps={message.steps} /> : null}
        {message.result ? <ResultCard result={message.result} onStockClick={onStockClick} /> : null}
        <div className="msg-time">{formatMessageTime(message.createdAt, now)}</div>
      </div>
    </div>
  );
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
    <div className={`trace thinking-trace ${open ? 'open' : ''}`} data-trace>
      <button className="trace-header thinking-header" onClick={() => setOpen(!open)} type="button">
        <span>思考了 {seconds} 秒</span><span className="trace-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="trace-body thinking-body" data-tracebody>
          {steps.map((step) => (
          <div className="trace-step" key={step.id}>
            <span className="tag">{step.agent}</span>
            <span className="desc">{step.description}</span>
            {step.detail ? <span className="progress">{step.detail}</span> : null}
          </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Trace({ steps }: { steps: NonNullable<ChatMessage['steps']> }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`trace ${open ? 'open' : ''}`} data-trace>
      <button className="trace-header" onClick={() => setOpen(!open)} type="button">
        <span>思考链路</span><span className="trace-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className="trace-body" data-tracebody>
          {steps.map((step) => (
            <div className="trace-step" key={`${step.id}-${step.status}`}>
              <span className="tag">{step.agent}</span>
              <span className="desc">{step.description}</span>
              {step.detail ? <span className="progress">{step.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResultCard({ result, onStockClick }: { result: AgentResultCard; onStockClick(stock: StockDetail): void }) {
  const headers = result.rows?.[0] ? Object.keys(result.rows[0]) : [];
  return (
    <div className="card" data-card>
      <div className="card-title">{result.title}<span className="sub">{result.subtitle}</span></div>
      {result.metrics?.length ? (
        <div className="metric-row">
          {result.metrics.map((metric) => <div className="metric-item" key={metric.label}><div className="lbl">{metric.label}</div><div className={`val ${metric.tone ?? ''}`}>{metric.value}</div></div>)}
        </div>
      ) : null}
      {headers.length ? (
        <table className="tbl">
          <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>
            {result.rows!.map((row, index) => (
              <tr key={index}>{headers.map((header) => <td key={header}>{renderCell(header, row, onStockClick)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {result.narrative ? <div className="card-narrative">{result.narrative}</div> : null}
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

function isStockAnalysisQuery(text: string) {
  return /^\s*(?:\d{6}|茅台|贵州茅台|五粮液|泸州老窖|洋河股份|宁德|宁德时代|宁王|招行|招商银行|比亚迪|中信证券)\s*$/.test(text)
    || (/分析|诊股|个股分析|帮我看看|看看/.test(text) && /\d{6}|茅台|贵州茅台|五粮液|泸州老窖|洋河股份|宁德|宁德时代|宁王|招行|招商银行|比亚迪|中信证券/.test(text));
}

function renderMarkdownWithStocks(content: string, _onStockClick: (stock: StockDetail) => void) {
  return marked.parse(content, { async: false }) as string;
}
