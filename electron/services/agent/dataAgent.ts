import { getBoardSnapshot, getQuote } from '../stock/stockClient.js';

export async function fetchQuote(symbol: string) {
  return getQuote(symbol);
}

export async function fetchBoard(keyword: string) {
  return getBoardSnapshot(keyword);
}
