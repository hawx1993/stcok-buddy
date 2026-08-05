import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import { useVirtualizer } from '@tanstack/react-virtual';
import gsap from 'gsap';
import { getStocksenseApi } from '../../shared/stocksense-api';
import { trackButtonClick } from '../../shared/analytics';
import { setBuiltInSlashItems } from './components/thinking-steps';
import { MessageBubble } from './components/message-bubble';
import { QuickEntry } from './components/quick-entry';
import { SlashCommandMenu } from './components/slash-command-menu';
import { findSearchTargetMessageId } from './components/search-highlight';
import { AppStoreBar } from './components/app-store-bar';
import { AppStoreModal } from './components/app-store-modal';
import { storeItemToSlashItem } from './utils';
import { useChatSend } from './hooks/use-chat-send';
import type { StoreItem } from '../../shared/types';
import { useAppDataStore, useAppUiStore } from '../../store/app-store';
import { useStickToBottom } from 'use-stick-to-bottom';
import cx from '../../shared/cx';
import styles from './index.module.scss';

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
    id: 'market-review',
    section: 'Commands',
    label: '复盘今日行情',
    command: '/复盘今日行情',
    description: '基于真实全市场数据复盘最近可用交易日行情',
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
    label: '消息面分析agent',
    command: '/消息面分析',
    description: '仅调用消息面Agent 分析股票',
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
] satisfies Array<{
  id: string;
  section: string;
  label: string;
  command: string;
  description: string;
  argPlaceholder: string;
}>;

type SlashItem = (typeof builtInSlashItems)[number];

setBuiltInSlashItems(builtInSlashItems);

type TAppliedSearchHighlight = {
  messageId: string;
  query: string;
  requestedAt: number;
};

export function ChatView() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState('');
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);
  const [storeOpen, setStoreOpen] = useState(false);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [installedStoreItems, setInstalledStoreItems] = useState<string[]>([]);
  const [appliedSearchHighlight, setAppliedSearchHighlight] = useState<TAppliedSearchHighlight>();
  const [now, setNow] = useState(Date.now());

  const messages = useAppDataStore((state) => state.messages);
  const isMessagesLoading = useAppDataStore((state) => state.isMessagesLoading);
  const messagesLoadingConversationId = useAppDataStore((state) => state.messagesLoadingConversationId);
  const activeConversationId = useAppDataStore((state) => state.activeConversationId);
  const isSending = useAppDataStore((state) => state.isSending);
  const config = useAppDataStore((state) => state.config);
  const chatSearchHighlight = useAppUiStore((state) => state.chatSearchHighlight);
  const clearChatSearchHighlight = useAppUiStore((state) => state.clearChatSearchHighlight);
  const setSettingsOpen = useAppUiStore((state) => state.setSettingsOpen);

  const { contentRef, scrollRef, scrollToBottom: stickToBottom } = useStickToBottom({
    resize: 'instant',
    initial: 'instant',
  });

  const {
    send,
    stopThinking,
    loadEarlierMessages,
    isLoadingEarlierMessages,
    openStockDetail,
    openBoardDetail,
  } = useChatSend({ stickToBottom });

  const shouldSuppressConversationScrollRef = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const slashItems = useMemo(
    () => [
      ...builtInSlashItems,
      ...storeItems.filter((item) => installedStoreItems.includes(item.id) && item.command).map(storeItemToSlashItem),
    ],
    [installedStoreItems, storeItems],
  );

  const messageVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 240,
    getItemKey: (index) => messages[index]?.id ?? index,
    overscan: 4,
  });

  const setScrollRef = useCallback(
    (el: HTMLDivElement | null) => {
      listRef.current = el;
      scrollRef(el);
    },
    [scrollRef],
  );

  // ── store items ──────────────────────────────────────────────────────
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
    const installed = await getStocksenseApi().installStoreItem(id);
    setInstalledStoreItems(installed);
    antdMessage.success('安装成功');
  };

  const uninstallStoreCommand = async (id: string) => {
    const installed = await getStocksenseApi().uninstallStoreItem(id);
    setInstalledStoreItems(installed);
    antdMessage.success('已卸载');
  };

  // ── GSAP entrance animation ──────────────────────────────────────────
  useLayoutEffect(() => {
    if (!rootRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from('[data-msg]', { opacity: 0, y: 12, stagger: 0.06, duration: 0.3, ease: 'power2.out' });
      gsap.from('[data-card]', { opacity: 0, y: 8, scale: 0.98, stagger: 0.05, duration: 0.3, delay: 0.15 });
    }, rootRef);
    return () => ctx.revert();
  }, []);

  // ── conversation switch ──────────────────────────────────────────────
  useLayoutEffect(() => {
    shouldSuppressConversationScrollRef.current = true;
  }, [activeConversationId]);

  const isActiveConversationLoading = isMessagesLoading && messagesLoadingConversationId === activeConversationId;

  useLayoutEffect(() => {
    if (shouldSuppressConversationScrollRef.current) {
      if (!isActiveConversationLoading) {
        shouldSuppressConversationScrollRef.current = false;
        stickToBottom({ animation: 'instant' });
      }
      return;
    }
  }, [activeConversationId, isActiveConversationLoading, stickToBottom]);

  // ── search highlight ─────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!chatSearchHighlight || chatSearchHighlight.conversationId !== activeConversationId) return;
    const messageId = findSearchTargetMessageId(messages, chatSearchHighlight);
    if (!messageId) return;
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) return;
    setAppliedSearchHighlight({ messageId, query: chatSearchHighlight.query, requestedAt: chatSearchHighlight.requestedAt });
    messageVirtualizer.scrollToIndex(messageIndex, { align: 'center', behavior: 'smooth' });
    clearChatSearchHighlight();
  }, [activeConversationId, chatSearchHighlight, clearChatSearchHighlight, messageVirtualizer, messages]);

  useEffect(() => {
    if (!appliedSearchHighlight) return;
    const timer = window.setTimeout(() => {
      setAppliedSearchHighlight((current) =>
        current?.requestedAt === appliedSearchHighlight.requestedAt && current.messageId === appliedSearchHighlight.messageId
          ? undefined
          : current,
      );
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [appliedSearchHighlight]);

  // ── periodic timestamp ───────────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // ── AI response notification ─────────────────────────────────────────
  useEffect(() => {
    const api = getStocksenseApi();
    const unsubscribe = api.onAiResponseNotification?.((payload) => {
      antdMessage.info(
        <div>
          <strong>{payload.title}</strong>
          <div style={{ fontSize: 12, marginTop: 4 }}>{payload.body}</div>
        </div>,
        payload.source === 'in-app' ? 4 : 2.5,
      );
    });
    return () => unsubscribe?.();
  }, []);

  // ── slash command helpers ────────────────────────────────────────────
  const slashOpen = input.startsWith('/') && !input.includes(' ');
  const activeModelName = config?.model.customModel?.trim() || config?.model.model || '模型设置';
  const activeCommand = slashItems.find((item) => input.startsWith(`${item.command} `));
  const commandArg = activeCommand ? input.slice(activeCommand.command.length + 1) : '';

  const selectSlashItem = (item = slashItems[selectedSlashIndex]) => {
    if (item) {
      trackButtonClick('select_slash_command', { command: item.command });
      setInput(`${item.command} `);
    }
  };

  // ── scroll handler ───────────────────────────────────────────────────
  const handleMessagesScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      if (event.currentTarget.scrollTop <= 48) void loadEarlierMessages();
    },
    [loadEarlierMessages],
  );

  // ── external send triggers ───────────────────────────────────────────
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
    const pendingSectorChat = (window as typeof window & { __stocksensePendingSectorChat?: string })
      .__stocksensePendingSectorChat;
    if (pendingSectorChat) {
      delete (window as typeof window & { __stocksensePendingSectorChat?: string }).__stocksensePendingSectorChat;
      void send(pendingSectorChat);
    }
    return () => window.removeEventListener('stocksense:send-report', handleReport);
  });

  // ── render ───────────────────────────────────────────────────────────
  return (
    <div className={styles['chat-wrap']} ref={rootRef}>
      <div className={styles['chat-messages']} ref={setScrollRef} onScroll={handleMessagesScroll} data-chat-scroll>
        {isLoadingEarlierMessages ? <div className={styles['chat-loading-earlier']}>正在加载更早消息…</div> : null}
        {messages.length === 0 && !isMessagesLoading ? (
          <QuickEntry conversationId={activeConversationId} onSubmit={send} slashItems={slashItems} />
        ) : (
          <div ref={contentRef} style={{ height: messageVirtualizer.getTotalSize(), position: 'relative' }}>
            {messageVirtualizer.getVirtualItems().map((virtualMessage) => {
              const message = messages[virtualMessage.index];
              if (!message) return null;
              const isSearchHighlighted = appliedSearchHighlight?.messageId === message.id;
              return (
                <div
                  key={message.id}
                  data-index={virtualMessage.index}
                  ref={messageVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    paddingBottom: 18,
                    transform: `translateY(${virtualMessage.start}px)`,
                  }}
                >
                  <MessageBubble
                    message={message}
                    now={now}
                    slashItems={slashItems}
                    searchQuery={isSearchHighlighted ? appliedSearchHighlight?.query : undefined}
                    onStockClick={openStockDetail}
                    onBoardClick={openBoardDetail}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {isActiveConversationLoading ? (
        <div className={styles['chat-loading-overlay']} role='status' aria-live='polite'>
          <span className={styles['chat-loading-dot']} />
          正在加载会话…
        </div>
      ) : null}
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
                      if (event.key === 'Enter') void send(input);
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
                    if (event.key === 'Enter') void send(input);
                  }}
                  placeholder='输入 / 打开命令，或直接输入A股股票名称/代码'
                />
              )}
            </div>
            <div className={styles['composer-toolbar']}>
              <AppStoreBar onOpen={() => setStoreOpen(true)} />
              <div className={styles['composer-actions']}>
                <button
                  className={styles['model-pill']}
                  onClick={() => {
                    trackButtonClick('open_model_settings');
                    setSettingsOpen(true);
                  }}
                  type='button'
                  aria-label={`当前模型：${activeModelName}。打开模型设置`}
                  title={`当前模型：${activeModelName}。点击打开模型设置`}
                >
                  <span className={styles['model-pill-label']}>模型</span>
                  <span className={styles['model-pill-name']}>{activeModelName}</span>
                </button>
                <button
                  className={cx(styles['send-btn'], isSending && styles.sending)}
                  onClick={isSending ? stopThinking : () => void send(input)}
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
