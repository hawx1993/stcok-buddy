import { message as antdMessage } from 'antd';
import { getStocksenseApi } from '../../../shared/stocksense-api';
import { trackButtonClick } from '../../../shared/analytics';
import { useAppDataStore, useAppUiStore } from '../../../store/app-store';

export async function createChatConversation(): Promise<void> {
  const uiState = useAppUiStore.getState();
  const dataState = useAppDataStore.getState();
  trackButtonClick('create_conversation');
  uiState.setMainView('chat');
  if (dataState.activeConversationId === dataState.conversations[0]?.id && dataState.conversations[0]?.count === 0) {
    antdMessage.info('当前已处于最新会话');
    return;
  }
  const item = await getStocksenseApi().createConversation();
  dataState.setConversations([item, ...dataState.conversations]);
  dataState.setActiveConversation(item.id);
  dataState.setSelectedStock(undefined);
  dataState.clearMessages();
}
