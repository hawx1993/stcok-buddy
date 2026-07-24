import { message as antdMessage } from 'antd';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import { trackButtonClick } from '../../../shared/analytics';
import { useAppStore } from '../../../store/app-store';

export async function createChatConversation(): Promise<void> {
  const state = useAppStore.getState();
  trackButtonClick('create_conversation');
  state.setMainView('chat');
  if (state.activeConversationId === state.conversations[0]?.id && state.conversations[0]?.count === 0) {
    antdMessage.info('当前已处于最新会话');
    return;
  }
  const item = await getStocksenseApi().createConversation();
  state.setConversations([item, ...state.conversations]);
  state.setActiveConversation(item.id);
  state.setSelectedStock(undefined);
  state.clearMessages();
}
