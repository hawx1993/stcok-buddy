import { useCallback, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import { createThinkingSteps, isGreeting } from '../components/thinking-steps';
import type { AgentRunEvent, BoardDetail, ChatMessage, StockDetail } from '../../../shared/types';
import { useAppDataStore } from '../../../store/app-store';
import { useAppUiStore } from '../../../store/app-ui-store';
import { track, trackButtonClick } from '../../../shared/analytics';
import { CHAT_MESSAGE_PAGE_SIZE } from '../../../shared/chat-message-pagination';
import { resolveStockLinkTarget, findMessageKline } from '../utils';
import type { TStockLinkTarget } from '../components/message-bubble';

import type { ScrollToBottom } from 'use-stick-to-bottom';

interface IUseChatSendOptions {
  stickToBottom: ScrollToBottom;
}

export function useChatSend({ stickToBottom }: IUseChatSendOptions) {
  const activeRequestRef = useRef<string>();
  const activeRequestConversationRef = useRef<string>();
  const loadingEarlierRef = useRef(false);
  const noMoreEarlierConversationRef = useRef<string>();
  const [isLoadingEarlierMessages, setIsLoadingEarlierMessages] = useState(false);

  // Store selectors
  const activeConversationId = useAppDataStore((state) => state.activeConversationId);
  const isMessagesLoading = useAppDataStore((state) => state.isMessagesLoading);
  const messagesLoadingConversationId = useAppDataStore((state) => state.messagesLoadingConversationId);
  const isSending = useAppDataStore((state) => state.isSending);
  const messages = useAppDataStore((state) => state.messages);
  const selectedBoard = useAppDataStore((state) => state.selectedBoard);

  // Store actions
  const addMessage = useAppDataStore((state) => state.addMessage);
  const prependMessages = useAppDataStore((state) => state.prependMessages);
  const replaceLastAssistant = useAppDataStore((state) => state.replaceLastAssistant);
  const stopLastAssistant = useAppDataStore((state) => state.stopLastAssistant);
  const finalizeLastAssistant = useAppDataStore((state) => state.finalizeLastAssistant);
  const appendToLastAssistant = useAppDataStore((state) => state.appendToLastAssistant);
  const applyRunEventToLastAssistant = useAppDataStore((state) => state.applyRunEventToLastAssistant);
  const setSending = useAppDataStore((state) => state.setSending);
  const rememberStockKline = useAppDataStore((state) => state.rememberStockKline);
  const setSelectedStock = useAppDataStore((state) => state.setSelectedStock);
  const setSelectedBoard = useAppDataStore((state) => state.setSelectedBoard);

  // UI store actions
  const openRightPanel = useAppUiStore((state) => state.openRightPanel);
  const openBoardPanel = useAppUiStore((state) => state.openBoardPanel);

  const isActiveConversationLoading = isMessagesLoading && messagesLoadingConversationId === activeConversationId;

  // ── load earlier messages ───────────────────────────────────────────
  const loadEarlierMessages = useCallback(async () => {
    if (
      !activeConversationId ||
      isActiveConversationLoading ||
      loadingEarlierRef.current ||
      noMoreEarlierConversationRef.current === activeConversationId ||
      !messages.length
    )
      return;
    const firstMessage = messages[0];
    if (!firstMessage) return;
    loadingEarlierRef.current = true;
    setIsLoadingEarlierMessages(true);
    const listElement = document.querySelector<HTMLDivElement>('[data-chat-scroll]');
    const previousScrollHeight = listElement?.scrollHeight ?? 0;
    try {
      const olderMessages = await getStocksenseApi().listMessages(activeConversationId, {
        limit: CHAT_MESSAGE_PAGE_SIZE,
        beforeCreatedAt: firstMessage.createdAt,
        beforeId: firstMessage.id,
      });
      if (useAppDataStore.getState().activeConversationId !== activeConversationId) return;
      if (olderMessages.length < CHAT_MESSAGE_PAGE_SIZE) noMoreEarlierConversationRef.current = activeConversationId;
      if (!olderMessages.length) return;
      prependMessages(activeConversationId, olderMessages);
      window.requestAnimationFrame(() => {
        const currentListElement = document.querySelector<HTMLDivElement>('[data-chat-scroll]');
        if (!currentListElement) return;
        currentListElement.scrollTop += currentListElement.scrollHeight - previousScrollHeight;
      });
    } catch (error) {
      antdMessage.error(error instanceof Error ? error.message : '加载更早消息失败');
    } finally {
      loadingEarlierRef.current = false;
      setIsLoadingEarlierMessages(false);
    }
  }, [activeConversationId, isActiveConversationLoading, messages, prependMessages]);

  // ── flush pending run-events (batched via rAF) ─────────────────────
  // ponytail: rAF batching prevents UI freeze when agent fires 100+
  // runEvents in rapid succession during complex multi-DAG-node analysis.
  const pendingEventsRef = useRef<AgentRunEvent[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const flushPendingEvents = useCallback(
    (conversationId: string) => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      const events = pendingEventsRef.current;
      pendingEventsRef.current = [];
      for (const evt of events) {
        applyRunEventToLastAssistant(evt, conversationId);
      }
    },
    [applyRunEventToLastAssistant],
  );

  // ── stop ────────────────────────────────────────────────────────────
  const stopThinking = useCallback(() => {
    trackButtonClick('stop_thinking');
    const conversationId = activeRequestConversationRef.current ?? activeConversationId ?? 'conv-1';
    activeRequestRef.current = undefined;
    activeRequestConversationRef.current = undefined;
    stopLastAssistant(conversationId);
    setSending(false, conversationId);
  }, [activeConversationId, stopLastAssistant, setSending]);

  // ── open stock / board detail ───────────────────────────────────────
  const openStockDetail = useCallback(
    async (stock: TStockLinkTarget) => {
      let resolvedStock: Pick<StockDetail, 'code' | 'name'> | undefined;
      try {
        resolvedStock = await resolveStockLinkTarget(stock);
      } catch {
        antdMessage.error(`未能解析 ${stock.name} 的股票代码，请稍后重试。`);
        return;
      }
      if (!resolvedStock) {
        antdMessage.warning(`未找到 ${stock.name} 的股票代码。`);
        return;
      }
      trackButtonClick('open_stock_detail', { code: resolvedStock.code, name: resolvedStock.name });
      const kline = findMessageKline(messages, resolvedStock.code);
      openRightPanel();
      setSelectedStock({ ...resolvedStock, kline } as StockDetail);
      try {
        const detail = await getStocksenseApi().getStockDetail(resolvedStock.code);
        setSelectedStock({ ...detail, kline: kline?.length ? kline : detail.kline });
      } catch {
        setSelectedStock({ ...resolvedStock, kline } as StockDetail);
      }
    },
    [messages, openRightPanel, setSelectedStock],
  );

  const openBoardDetail = useCallback(
    async (board: Pick<BoardDetail, 'code' | 'name'>) => {
      trackButtonClick('open_board_detail', { code: board.code, name: board.name });
      openBoardPanel();
      if (selectedBoard?.code !== board.code) setSelectedBoard(board as BoardDetail);
      try {
        setSelectedBoard(await getStocksenseApi().getBoardDetail(board.code, false, board.name));
      } catch {
        if (selectedBoard?.code !== board.code) setSelectedBoard(board as BoardDetail);
      }
    },
    [openBoardPanel, selectedBoard?.code, setSelectedBoard],
  );

  // ── send ────────────────────────────────────────────────────────────
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;
      stickToBottom({ animation: 'instant' });

      const conversationId = activeConversationId ?? 'conv-1';
      const command = trimmed.startsWith('/') ? trimmed.split(/\s+/, 1)[0] : undefined;
      trackButtonClick('send_chat', { command, message_length: trimmed.length, has_stock_code: /\d{6}/.test(trimmed) });
      track('stock_query_entered', {
        query_kind: /^\d{6}$/.test(trimmed) ? 'code' : command ? 'command' : 'text',
        command,
        has_stock_code: /\d{6}/.test(trimmed),
      });

      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      addMessage(userMessage);

      if (isGreeting(trimmed)) {
        const assistantMessage: ChatMessage = {
          id: `assistant-greeting-${Date.now()}`,
          role: 'assistant',
          content:
            '你好！我是 StockBuddy。本条是本地欢迎语，不会调用大模型厂商。若要测试模型配置，请在系统设置中保存并完成模型连接校验；也可以直接输入股票代码或投研命令开始分析。',
          createdAt: new Date().toISOString(),
        };
        addMessage(assistantMessage);
        const api = getStocksenseApi();
        await api.saveMessage(conversationId, userMessage);
        await api.saveMessage(conversationId, assistantMessage);
        api.listConversations().then(useAppDataStore.getState().setConversations).catch(console.error);
        return;
      }

      setSending(true, conversationId);
      addMessage({
        id: `assistant-thinking-${Date.now()}`,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        thinking: { startedAt: new Date().toISOString(), steps: createThinkingSteps(trimmed) },
      });

      const requestId = `chat-${Date.now()}`;
      const api = getStocksenseApi();
      try {
        activeRequestRef.current = requestId;
        activeRequestConversationRef.current = conversationId;
        await api.testModelConfig(await api.getConfig());
      } catch (error) {
        replaceLastAssistant(
          {
            id: `assistant-error-${Date.now()}`,
            role: 'assistant',
            content: error instanceof Error ? error.message : '模型配置校验失败，请检查 API 配置。',
            createdAt: new Date().toISOString(),
          },
          conversationId,
        );
        activeRequestRef.current = undefined;
        activeRequestConversationRef.current = undefined;
        setSending(false, conversationId);
        return;
      }

      let offToken: (() => void) | undefined;
      try {
        offToken = api.onChatToken?.((event) => {
          if (event.requestId !== requestId || activeRequestRef.current !== requestId) return;
          // ponytail: batch runEvents via rAF to avoid UI freeze from rapid-fire
          // agent events during complex multi-node DAG execution (e.g. institution
          // buying analysis can emit 100+ events). Tokens stream immediately.
          if (event.runEvent) {
            pendingEventsRef.current.push(event.runEvent);
            if (rafIdRef.current === null) {
              rafIdRef.current = requestAnimationFrame(() => {
                rafIdRef.current = null;
                const batch = pendingEventsRef.current;
                pendingEventsRef.current = [];
                for (const evt of batch) {
                  applyRunEventToLastAssistant(evt, conversationId);
                }
              });
            }
          }
          if (event.token) appendToLastAssistant(event.token, conversationId);
        });

        const response = await api.sendChat({ conversationId, message: trimmed, requestId });
        if (activeRequestRef.current !== requestId) return;

        // flush any batched events before finalizing
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
          const batch = pendingEventsRef.current;
          pendingEventsRef.current = [];
          for (const evt of batch) {
            applyRunEventToLastAssistant(evt, conversationId);
          }
        }

        finalizeLastAssistant(response.message, conversationId);
        const stock = response.events.find((event) => event.stock)?.stock;
        if (stock) {
          const resultStock = response.message.result?.stocks?.find((item) => item.code === stock.code);
          const chartData =
            response.message.result?.chart?.type === 'kline' ? response.message.result.chart.data : undefined;
          rememberStockKline(stock.code, chartData);
          openRightPanel();
          setSelectedStock({ ...stock, ...resultStock, kline: chartData });
        }
        api.listConversations().then(useAppDataStore.getState().setConversations).catch(console.error);
      } catch (error) {
        if (activeRequestRef.current !== requestId) return;
        replaceLastAssistant(
          {
            id: `assistant-error-${Date.now()}`,
            role: 'assistant',
            content: error instanceof Error ? error.message : '请求失败，请稍后重试。',
            createdAt: new Date().toISOString(),
          },
          conversationId,
        );
      } finally {
        // flush any remaining batched events
        if (rafIdRef.current !== null) {
          cancelAnimationFrame(rafIdRef.current);
          rafIdRef.current = null;
          const batch = pendingEventsRef.current;
          pendingEventsRef.current = [];
          for (const evt of batch) {
            applyRunEventToLastAssistant(evt, conversationId);
          }
        }
        offToken?.();
        if (activeRequestRef.current === requestId) {
          activeRequestRef.current = undefined;
          activeRequestConversationRef.current = undefined;
        }
        setSending(false, conversationId);
      }
    },
    [
      isSending,
      stickToBottom,
      activeConversationId,
      addMessage,
      setSending,
      replaceLastAssistant,
      appendToLastAssistant,
      applyRunEventToLastAssistant,
      finalizeLastAssistant,
      rememberStockKline,
      setSelectedStock,
      openRightPanel,
    ],
  );

  return {
    send,
    stopThinking,
    loadEarlierMessages,
    isLoadingEarlierMessages,
    openStockDetail,
    openBoardDetail,
    loadingEarlierRef,
    noMoreEarlierConversationRef,
    flushPendingEvents,
  };
}
