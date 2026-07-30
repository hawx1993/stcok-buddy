import { message as antdMessage } from 'antd';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import { trackButtonClick } from '../../../shared/analytics';
import { useAppStore } from '../../../store/app-store';

export async function createSectorConversation(sectorName: string, code?: string): Promise<void> {
  const state = useAppStore.getState();
  trackButtonClick('create_sector_conversation', { sector: sectorName, code });
  state.setMainView('chat');

  const item = await getStocksenseApi().createConversation();
  state.setConversations([item, ...state.conversations]);
  state.setActiveConversation(item.id);
  state.setSelectedStock(undefined);
  state.clearMessages();

  const text = `分析${sectorName}板块今日的资金流向和龙头股表现${code ? `（板块代码：${code}）` : ''}`;
  (window as typeof window & { __stocksensePendingSectorChat?: string }).__stocksensePendingSectorChat = text;
  antdMessage.info(`已创建会话：${text}`);
}
