import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  formatModalChangePercent,
  getModalChangeTone,
  KlineModalFrame,
} from '../kline-modal-frame';
import { createKlineModalQuotePoller } from '../use-kline-modal-quote';

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('K 线弹窗实时行情刷新', () => {
  it('打开后立即刷新，并在交易时段每 15 秒继续刷新', async () => {
    const callbacks: Array<() => void> = [];
    const clearIntervalFn = vi.fn();
    const onQuote = vi.fn();
    const load = vi.fn().mockResolvedValue({ price: 15.2, changePercent: '2.50%' });
    const poller = createKlineModalQuotePoller({
      code: '300017',
      load,
      onQuote,
      onError: vi.fn(),
      shouldPoll: () => true,
      setIntervalFn: (callback, milliseconds) => {
        expect(milliseconds).toBe(15_000);
        callbacks.push(callback);
        return 1;
      },
      clearIntervalFn,
    });

    await flushPromises();
    expect(load).toHaveBeenCalledTimes(1);
    expect(onQuote).toHaveBeenCalledWith({ price: 15.2, changePercent: '2.50%' });

    callbacks[0]?.();
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);

    poller.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(1);
  });

  it('无股票代码时不发起实时行情请求', () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const setIntervalFn = vi.fn();
    const poller = createKlineModalQuotePoller({
      code: '',
      load,
      onQuote: vi.fn(),
      onError: vi.fn(),
      shouldPoll: () => true,
      setIntervalFn,
    });

    expect(load).not.toHaveBeenCalled();
    expect(setIntervalFn).not.toHaveBeenCalled();
    poller.stop();
  });

  it('请求未完成时不重叠刷新，关闭后忽略延迟响应', async () => {
    const callbacks: Array<() => void> = [];
    let resolveQuote: ((quote: { price: number; changePercent: string }) => void) | undefined;
    const onQuote = vi.fn();
    const load = vi.fn(() => new Promise<{ price: number; changePercent: string }>((resolve) => {
      resolveQuote = resolve;
    }));
    const clearIntervalFn = vi.fn();
    const poller = createKlineModalQuotePoller({
      code: '300017',
      load,
      onQuote,
      onError: vi.fn(),
      shouldPoll: () => true,
      setIntervalFn: (callback) => {
        callbacks.push(callback);
        return 2;
      },
      clearIntervalFn,
    });

    callbacks[0]?.();
    expect(load).toHaveBeenCalledTimes(1);

    poller.stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(2);
    resolveQuote?.({ price: 15.3, changePercent: '3.00%' });
    await flushPromises();
    expect(onQuote).not.toHaveBeenCalled();
  });
});

describe('K 线弹窗涨跌幅展示', () => {
  it('格式化涨跌幅并识别上涨、下跌和横盘方向', () => {
    expect(formatModalChangePercent('4.4%')).toBe('+4.40%');
    expect(formatModalChangePercent('-1.25')).toBe('-1.25%');
    expect(formatModalChangePercent('--')).toBeUndefined();
    expect(getModalChangeTone('4.4%')).toBe('up');
    expect(getModalChangeTone('-1.25%')).toBe('down');
    expect(getModalChangeTone('0')).toBe('flat');
  });

  it('在现价旁展示实时涨跌幅', () => {
    const markup = renderToStaticMarkup(createElement(KlineModalFrame, {
      stock: { code: '300017', name: '网宿科技', price: 15.1, changePercent: '4.4%', pe: 48.63 },
      data: [],
      chipsOpen: true,
      onClose: () => undefined,
      renderChart: () => null,
    }));

    expect(markup).toContain('现价 15.1');
    expect(markup).toContain('涨跌幅 +4.40%');
    expect(markup).toContain('PE 48.63');
  });
});
