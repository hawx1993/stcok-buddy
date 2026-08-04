import { describe, expect, it } from 'vitest';

import {
  applyStockAgentRouting,
  classifyIntent,
  intentLabel,
  isStockRelatedQuestion,
  needsSymbol,
  parseSlashCommand,
} from '../intent-routing.js';

describe('普通问题意图识别（classifyIntent）', () => {
  it('命中股东户数/筹码意图 shareholder-chip', () => {
    expect(classifyIntent('000858 股东户数在增加还是减少，筹码集中吗')).toBe('shareholder-chip');
  });

  it('命中热门股+概念意图 hot-concepts', () => {
    expect(classifyIntent('今天哪些票最热门，被归到什么概念在炒')).toBe('hot-concepts');
  });

  it('命中行业涨幅意图 industry-ranking，且不被 board 抢走', () => {
    expect(classifyIntent('今天哪些行业涨幅最大')).toBe('industry-ranking');
    expect(classifyIntent('今天哪些行业涨跌居前')).toBe('industry-ranking');
  });

  it('不含涨幅词的行业提问仍回归 board 意图', () => {
    expect(classifyIntent('今天哪些行业比较强')).toBe('board');
  });

  it('既有意图不因新增正则而回归异常', () => {
    expect(classifyIntent('000858 综合投研分析')).toBe('analysis');
    expect(classifyIntent('今天市场怎么样')).toBe('chat');
    expect(classifyIntent('000858 最近有什么新闻')).toBe('news-announcements');
    expect(classifyIntent('复盘今日行情')).toBe('market-review');
  });
});

describe('needsSymbol', () => {
  it('shareholder-chip 需要股票代码，hot-concepts / industry-ranking 不需要', () => {
    expect(needsSymbol('shareholder-chip')).toBe(true);
    expect(needsSymbol('hot-concepts')).toBe(false);
    expect(needsSymbol('industry-ranking')).toBe(false);
  });
});

describe('isStockRelatedQuestion 股票相关性判断', () => {
  it('股票 / A 股相关问题判断为相关', () => {
    expect(isStockRelatedQuestion('茅台为什么涨')).toBe(true);
    expect(isStockRelatedQuestion('今天大盘怎么样')).toBe(true);
    expect(isStockRelatedQuestion('600036 现在多少钱')).toBe(true);
    expect(isStockRelatedQuestion('什么是市盈率')).toBe(true);
    expect(isStockRelatedQuestion('白酒板块资金流向')).toBe(true);
  });

  it('与股票无关的问题判断为不相关', () => {
    expect(isStockRelatedQuestion('你好')).toBe(false);
    expect(isStockRelatedQuestion('帮我写一段 Python 代码')).toBe(false);
    expect(isStockRelatedQuestion('今天天气怎么样')).toBe(false);
    expect(isStockRelatedQuestion('推荐一本好书')).toBe(false);
  });
});

describe('applyStockAgentRouting 非 slash 股票问题统一路由', () => {
  it('示例问题被 quote 意图抢走，但路由修正为 a-stock-data-agent', () => {
    const q1 = '茅台历年分红派息多少';
    expect(classifyIntent(q1)).toBe('quote');
    expect(applyStockAgentRouting(classifyIntent(q1), q1, false)).toBe('a-stock-data-agent');

    const q2 = '今天涨停多少家、最高几连板、炸板率多少';
    expect(classifyIntent(q2)).toBe('quote');
    expect(applyStockAgentRouting(classifyIntent(q2), q2, false)).toBe('a-stock-data-agent');
  });

  it('纯股票代码或名称保持 analysis，走综合投研报告工作流', () => {
    const stockCode = '000858';
    const stockName = '贵州茅台';

    expect(classifyIntent(stockCode)).toBe('analysis');
    expect(applyStockAgentRouting(classifyIntent(stockCode), stockCode, false)).toBe('analysis');
    expect(classifyIntent(stockName)).toBe('analysis');
    expect(applyStockAgentRouting(classifyIntent(stockName), stockName, false)).toBe('analysis');
  });

  it('普通行情问句也路由到 a-stock-data-agent', () => {
    const q = '600036 现在多少钱';
    expect(applyStockAgentRouting(classifyIntent(q), q, false)).toBe('a-stock-data-agent');
  });

  it('非股票问题保持 chat，由大模型直接回答', () => {
    const q = '你好';
    expect(applyStockAgentRouting(classifyIntent(q), q, false)).toBe('chat');
  });

  it('slash 命令意图不被改写', () => {
    expect(applyStockAgentRouting('analysis', '/综合投研报告 000858', true)).toBe('analysis');
    expect(applyStockAgentRouting('market-review', '/复盘今日行情', true)).toBe('market-review');
  });

  it('portfolio 个人持仓记忆保留，不路由到智能体', () => {
    expect(applyStockAgentRouting('portfolio', '我买的股票', false)).toBe('portfolio');
  });
});

describe('intentLabel', () => {
  it('新意图有中文标签', () => {
    expect(intentLabel('shareholder-chip')).toBe('股东户数/筹码');
    expect(intentLabel('hot-concepts')).toBe('热门题材');
    expect(intentLabel('industry-ranking')).toBe('行业涨幅');
    expect(intentLabel('a-stock-data-agent')).toBe('A股智能投研');
  });
});

describe('parseSlashCommand 回归', () => {
  it('既有斜杠命令不受影响', () => {
    expect(parseSlashCommand('/复盘今日行情')?.intent).toBe('market-review');
    expect(parseSlashCommand('/题材归因')?.intent).toBe('theme-attribution');
    expect(parseSlashCommand('/综合投研报告 000858')?.args).toBe('000858');
  });
});
