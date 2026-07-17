import assert from 'node:assert/strict';
import { getBoardDetail } from './stock-client.js';

for (const board of [
  { code: '0473', name: '证券II' },
  { code: 'BK0896', name: '白酒' },
]) {
  console.log(`board-detail candidate: ${board.name} (${board.code})`);
  const detail = await getBoardDetail(board.code, true, board.name);
  assert(detail.constituents?.length, `${board.name} 成分股为空`);
  assert(detail.kline?.length, `${board.name} 日K线为空`);
  assert.match(detail.code, /^BK\d{4}$/i, `${board.name} 板块代码异常: ${detail.code}`);
  console.log(`board-detail selfcheck passed: ${detail.name} (${detail.code}), ${detail.constituents.length} constituents, ${detail.kline.length} K-lines`);
}
