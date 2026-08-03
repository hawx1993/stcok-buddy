import { beforeEach, describe, expect, it } from 'vitest';
import { useAppDataStore, useAppUiStore } from '../app-store';
import type { AppConfig, ChatMessage, KlinePoint, MarketNewsItem } from '../../shared/types';

const TEST_CONFIG: AppConfig = {
  theme: 'dark',
  marketColorMode: 'red-up-green-down',
  model: {
    provider: 'deepseek',
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    model: 'test-model',
  },
};

const KLINE_2026_08_03: KlinePoint[] = [
  { time: '2026-08-03', timestamp: 1, open: 10, close: 11, high: 12, low: 9, volume: 100 },
];

const KLINE_2026_08_04: KlinePoint[] = [
  { time: '2026-08-04', timestamp: 2, open: 20, close: 21, high: 22, low: 19, volume: 200 },
];

function createAssistantMessage(id: string, content = '分析结果'): ChatMessage {
  return {
    id,
    role: 'assistant',
    content,
    createdAt: '2026-08-03T00:00:00.000Z',
  };
}

function createNewsItem(id: string, title = '测试新闻'): MarketNewsItem {
  return {
    id,
    title,
    time: '09:30',
    tags: ['测试'],
    source: '测试来源',
    url: `https://example.test/news/${id}`,
  };
}

beforeEach(() => {
  useAppUiStore.setState(useAppUiStore.getInitialState(), true);
  useAppDataStore.setState(useAppDataStore.getInitialState(), true);
});

describe('UI 状态', () => {
  it('重复打开板块 tab 时应和其他 tab 一样切换收缩状态', () => {
    useAppUiStore.getState().setRightPanelTab('board');

    expect(useAppUiStore.getState().rightPanelTab).toBe('board');
    expect(useAppUiStore.getState().isRightPanelCollapsed).toBe(false);

    useAppUiStore.getState().setRightPanelTab('board');

    expect(useAppUiStore.getState().rightPanelTab).toBe('board');
    expect(useAppUiStore.getState().isRightPanelCollapsed).toBe(true);
  });

  it('切换到不同右侧栏 tab 时应展开右侧栏', () => {
    useAppUiStore.getState().setRightPanelTab('board');
    useAppUiStore.getState().setRightPanelTab('stock');

    expect(useAppUiStore.getState().rightPanelTab).toBe('stock');
    expect(useAppUiStore.getState().isRightPanelCollapsed).toBe(false);
  });

  it('切换主侧栏分组时应清空搜索关键词', () => {
    useAppUiStore.getState().setSearch('银行');
    useAppUiStore.getState().setSidebarMainTab('hot');

    expect(useAppUiStore.getState().sidebarMainTab).toBe('hot');
    expect(useAppUiStore.getState().search).toBe('');
  });

  it('打开新闻阅读器时应记录来源视图，关闭后返回原视图', () => {
    useAppUiStore.getState().setMainView('discovery');

    const requestId = useAppUiStore.getState().openNewsReader(createNewsItem('news-1'));

    expect(useAppUiStore.getState().mainView).toBe('news-reader');
    expect(useAppUiStore.getState().newsReader?.requestId).toBe(requestId);
    expect(useAppUiStore.getState().newsReader?.previousView).toBe('discovery');

    useAppUiStore.getState().closeNewsReader();

    expect(useAppUiStore.getState().mainView).toBe('discovery');
    expect(useAppUiStore.getState().newsReader).toBeUndefined();
  });

  it('新闻阅读器只接受当前请求的详情和错误更新', () => {
    const firstRequestId = useAppUiStore.getState().openNewsReader(createNewsItem('news-1'));
    const secondSource = createNewsItem('news-2', '第二条新闻');
    const secondRequestId = useAppUiStore.getState().openNewsReader(secondSource);
    const staleDetail = createNewsItem('news-1', '过期新闻详情');
    const currentDetail = { ...secondSource, content: '第二条新闻详情' };

    useAppUiStore.getState().setNewsReaderItem(firstRequestId, staleDetail);

    expect(useAppUiStore.getState().newsReader?.item).toBeUndefined();
    expect(useAppUiStore.getState().newsReader?.loading).toBe(true);

    useAppUiStore.getState().setNewsReaderItem(secondRequestId, currentDetail);

    expect(useAppUiStore.getState().newsReader?.item).toEqual(currentDetail);
    expect(useAppUiStore.getState().newsReader?.loading).toBe(false);

    useAppUiStore.getState().setNewsReaderError(firstRequestId, '过期错误');

    expect(useAppUiStore.getState().newsReader?.error).toBeUndefined();
  });

  it('同步进度应按任务类型合并更新', () => {
    useAppUiStore.getState().setSyncProgress('kline', {
      status: 'running',
      processed: 1,
      total: 10,
      message: '同步中',
    });
    useAppUiStore.getState().setSyncProgress('kline', { processed: 5, message: '继续同步' });

    expect(useAppUiStore.getState().syncProgress.kline).toEqual({
      taskType: 'kline',
      status: 'running',
      processed: 5,
      total: 10,
      message: '继续同步',
    });
  });

  it('快捷打开右侧栏动作应设置正确 tab 并展开', () => {
    useAppUiStore.getState().openBoardPanel();

    expect(useAppUiStore.getState().rightPanelTab).toBe('board');
    expect(useAppUiStore.getState().isRightPanelCollapsed).toBe(false);

    useAppUiStore.getState().openAiMonitorPanel();

    expect(useAppUiStore.getState().rightPanelTab).toBe('ai-monitor');
    expect(useAppUiStore.getState().isRightPanelCollapsed).toBe(false);

    useAppUiStore.getState().openRightPanel();

    expect(useAppUiStore.getState().rightPanelTab).toBe('stock');
    expect(useAppUiStore.getState().isRightPanelCollapsed).toBe(false);
  });
});

describe('数据状态', () => {
  it('设置主题时应只更新已有配置中的主题字段', () => {
    useAppDataStore.getState().setTheme('light');

    expect(useAppDataStore.getState().config).toBeUndefined();

    useAppDataStore.getState().setConfig(TEST_CONFIG);
    useAppDataStore.getState().setTheme('light');

    expect(useAppDataStore.getState().config).toEqual({ ...TEST_CONFIG, theme: 'light' });
  });

  it('设置会话列表时应初始化当前会话，但不覆盖已有当前会话', () => {
    const conversations = [
      { id: 'c-1', title: '会话 1', preview: '预览 1', date: '2026-08-03', updatedAt: '2026-08-03', tab: 'stock', count: 1 },
      { id: 'c-2', title: '会话 2', preview: '预览 2', date: '2026-08-04', updatedAt: '2026-08-04', tab: 'market', count: 2 },
    ] as const;

    useAppDataStore.getState().setConversations([...conversations]);

    expect(useAppDataStore.getState().activeConversationId).toBe('c-1');

    useAppDataStore.getState().setActiveConversation('c-2');
    useAppDataStore.getState().setConversations([...conversations]);

    expect(useAppDataStore.getState().activeConversationId).toBe('c-2');
  });

  it('切换当前会话时应同步回到聊天主视图', () => {
    useAppUiStore.getState().setMainView('discovery');

    useAppDataStore.getState().setActiveConversation('conversation-1');

    expect(useAppDataStore.getState().activeConversationId).toBe('conversation-1');
    expect(useAppUiStore.getState().mainView).toBe('chat');
  });

  it('设置选中个股时应复用已缓存的 K 线数据', () => {
    useAppDataStore.getState().rememberStockKline('600000', KLINE_2026_08_03);
    useAppDataStore.getState().setSelectedStock({ code: '600000', name: '浦发银行' });

    expect(useAppDataStore.getState().selectedStock?.kline).toEqual(KLINE_2026_08_03);
  });

  it('设置消息时应从 K 线结果卡片缓存图表数据', () => {
    const messages: ChatMessage[] = [
      {
        ...createAssistantMessage('assistant-1'),
        result: {
          title: 'K 线分析',
          stocks: [{ code: '000001', name: '平安银行' }],
          chart: { type: 'kline', data: KLINE_2026_08_04 },
        },
      },
    ];

    useAppDataStore.getState().setMessages(messages);

    expect(useAppDataStore.getState().stockKlines['000001']).toEqual(KLINE_2026_08_04);
  });

  it('空 K 线不应覆盖已有缓存', () => {
    useAppDataStore.getState().rememberStockKline('600000', KLINE_2026_08_03);
    useAppDataStore.getState().rememberStockKline('600000', []);

    expect(useAppDataStore.getState().stockKlines['600000']).toEqual(KLINE_2026_08_03);
  });

  it('选择板块时应清空个股选择和返回上下文', () => {
    useAppDataStore.getState().setSelectedStock({ code: '600000', name: '浦发银行' });
    useAppDataStore.getState().setStockReturnContext({ tab: 'stock', code: '600000' });

    useAppDataStore.getState().setSelectedBoard({ code: 'BK0001', name: '银行' });

    expect(useAppDataStore.getState().selectedBoard).toEqual({ code: 'BK0001', name: '银行' });
    expect(useAppDataStore.getState().selectedStock).toBeUndefined();
    expect(useAppDataStore.getState().stockReturnContext).toBeUndefined();
  });

  it('清空选中个股时应同时清空返回上下文', () => {
    useAppDataStore.getState().setSelectedStock({ code: '600000', name: '浦发银行' });
    useAppDataStore.getState().setStockReturnContext({ tab: 'ai-monitor', code: '600000' });

    useAppDataStore.getState().setSelectedStock(undefined);

    expect(useAppDataStore.getState().selectedStock).toBeUndefined();
    expect(useAppDataStore.getState().stockReturnContext).toBeUndefined();
  });

  it('添加、替换和追加 assistant 消息时应只影响最后一条 assistant 消息', () => {
    useAppDataStore.getState().addMessage({
      id: 'user-1',
      role: 'user',
      content: '用户问题',
      createdAt: '2026-08-03T00:00:00.000Z',
    });
    useAppDataStore.getState().replaceLastAssistant(createAssistantMessage('assistant-1', '初始回答'));
    useAppDataStore.getState().appendToLastAssistant('，追加内容');
    useAppDataStore.getState().replaceLastAssistant(createAssistantMessage('assistant-2', '替换回答'));

    expect(useAppDataStore.getState().messages).toEqual([
      {
        id: 'user-1',
        role: 'user',
        content: '用户问题',
        createdAt: '2026-08-03T00:00:00.000Z',
      },
      createAssistantMessage('assistant-2', '替换回答'),
    ]);
  });

  it('运行事件应合并到最后一条 assistant 消息的步骤、工具调用和事件列表', () => {
    useAppDataStore.getState().addMessage(createAssistantMessage('assistant-1'));

    useAppDataStore.getState().applyRunEventToLastAssistant({
      type: 'step_completed',
      step: { id: 'step-1', agent: 'planner', description: '完成规划', status: 'completed' },
      toolCall: {
        id: 'tool-1',
        toolName: 'read-file',
        input: { path: 'src/store/app-data-store.ts' },
        startedAt: '2026-08-03T00:00:00.000Z',
      },
    });

    const message = useAppDataStore.getState().messages[0];

    expect(message.steps).toEqual([{ id: 'step-1', agent: 'planner', description: '完成规划', status: 'completed' }]);
    expect(message.toolCalls?.[0]?.id).toBe('tool-1');
    expect(message.runEvents?.[0]?.type).toBe('step_completed');
  });

  it('最终 assistant 消息应保留已有运行事件并清理 thinking 状态', () => {
    useAppDataStore.getState().addMessage({
      ...createAssistantMessage('assistant-1', '处理中'),
      thinking: {
        startedAt: '2026-08-03T00:00:00.000Z',
        steps: [{ id: 'step-1', agent: 'planner', description: '规划中', status: 'running' }],
      },
      runEvents: [{ type: 'step_started', title: '开始' }],
    });

    useAppDataStore.getState().finalizeLastAssistant(createAssistantMessage('assistant-1', '最终回答'));

    const message = useAppDataStore.getState().messages[0];

    expect(message.content).toBe('最终回答');
    expect(message.thinking).toBeUndefined();
    expect(message.runEvents).toEqual([{ type: 'step_started', title: '开始' }]);
    expect(message.processedSeconds).toBeGreaterThanOrEqual(0.1);
  });
});
