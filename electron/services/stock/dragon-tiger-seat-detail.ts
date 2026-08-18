import { sdk, withTimeoutReject } from './shared.js';

const DRAGON_TIGER_SEAT_TIMEOUT_MS = 10_000;

type TStockSdkDragonTigerSeat = Awaited<ReturnType<typeof sdk.dragonTiger.seatDetail>>[number];

export interface IDragonTigerSeatDetail {
  rank: number | null;
  branchName: string;
  buyAmount: number | null;
  sellAmount: number | null;
  netAmount: number | null;
  side: 'buy' | 'sell';
}

export async function getDragonTigerSeatDetails(symbol: string, tradeDate: string): Promise<IDragonTigerSeatDetail[]> {
  const seats = await withTimeoutReject(
    sdk.dragonTiger.seatDetail(symbol, tradeDate),
    DRAGON_TIGER_SEAT_TIMEOUT_MS,
    '龙虎榜营业部席位明细加载超时',
  );
  return seats.map(toDragonTigerSeatDetail);
}

function toDragonTigerSeatDetail(seat: TStockSdkDragonTigerSeat): IDragonTigerSeatDetail {
  return {
    rank: seat.rank,
    branchName: seat.branchName,
    buyAmount: seat.buyAmount,
    sellAmount: seat.sellAmount,
    netAmount: seat.netAmount,
    side: seat.side,
  };
}
