import type { BoardDetail, ChatMessage, StockDetail } from '../../shared/types';
import { getStocksenseApi } from '../../shared/stocksense-api';
import type { TStockLinkTarget } from './components/message-bubble';
import type { TSlashItem } from './components/quick-entry';

export type SlashItem = TSlashItem;

export function storeItemToSlashItem(item: {
  id: string;
  section: string;
  name: string;
  command?: string;
  description: string;
  argPlaceholder?: string;
}): SlashItem {
  return {
    id: item.id,
    section: item.section,
    label: item.name,
    command: item.command!,
    description: item.description,
    argPlaceholder: item.argPlaceholder ?? '[请输入参数]',
  };
}

export async function resolveStockLinkTarget(
  stock: TStockLinkTarget,
): Promise<Pick<StockDetail, 'code' | 'name'> | undefined> {
  if (stock.code) return { code: stock.code, name: stock.name };
  const results = await getStocksenseApi().searchStocks(stock.name);
  const matchedStock =
    results.find((item) => item.kind !== 'board' && item.name === stock.name) ??
    results.find((item) => item.kind !== 'board');
  return matchedStock ? { code: matchedStock.code, name: matchedStock.name } : undefined;
}

export function findMessageKline(messages: ChatMessage[], code: string) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const result = messages[i].result;
    if (result?.chart?.type === 'kline' && result.stocks?.some((stock) => stock.code === code))
      return result.chart.data;
  }
  return undefined;
}
