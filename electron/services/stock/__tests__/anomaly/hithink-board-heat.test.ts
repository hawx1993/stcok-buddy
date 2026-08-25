import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractRecords,
  resolveFuyaoIndexMcpConnection,
  toBoardCatalogItems,
  toBoardConstituentRows,
  toMarketBoardRows,
} from '../../anomaly/hithink-board-heat.js';

describe('同花顺板块热度数据适配', () => {
  it('打包环境可通过显式路径读取外部 MCP 配置中的扶摇指数连接信息', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stockbuddy-fuyao-index-empty-'));
    const configDir = await mkdtemp(join(tmpdir(), 'stockbuddy-fuyao-index-config-'));
    try {
      const configPath = join(configDir, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            'fuyao-a-share-index': {
              type: 'http',
              url: 'https://fuyao.example.test/mcp/a-share-index',
              headers: { 'X-api-key': 'index-config-test-key' },
            },
          },
        }),
        'utf8',
      );

      await expect(resolveFuyaoIndexMcpConnection({ cwd, env: {}, configPath })).resolves.toEqual({
        url: 'https://fuyao.example.test/mcp/a-share-index',
        apiKey: 'index-config-test-key',
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('未单独配置指数 MCP 时复用扶摇 A 股 Key 并使用指数默认地址', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'stockbuddy-fuyao-index-fallback-'));
    try {
      const configPath = join(cwd, '.mcp.json');
      await writeFile(
        configPath,
        JSON.stringify({
          mcpServers: {
            'fuyao-a-share': {
              type: 'http',
              url: 'https://fuyao.example.test/mcp/a-share',
              headers: { 'X-api-key': 'a-share-config-test-key' },
            },
          },
        }),
        'utf8',
      );

      await expect(resolveFuyaoIndexMcpConnection({ cwd, env: {} })).resolves.toEqual({
        url: 'https://fuyao.aicubes.cn/mcp/a-share-index',
        apiKey: 'a-share-config-test-key',
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it('读取真实 index.catalog 的 data.item 数组，避免把目录解析为空', () => {
    const rows = extractRecords({
      item: [
        { thscode: '881169.TI', name: '贵金属' },
        { thscode: '881155.TI', name: '银行' },
      ],
      timestamp: 1,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ thscode: '881169.TI', name: '贵金属' });
  });

  it('把同花顺行业和概念目录标记为对应板块类型，并过滤行业细分目录', () => {
    expect(
      toBoardCatalogItems(
        [
          { thscode: '881169.TI', name: '贵金属' },
          { thscode: '884215.TI', name: '稀土' },
          { thscode: '', name: '空代码' },
        ],
        'industry',
      ),
    ).toEqual([{ code: '881169.TI', name: '贵金属', boardKind: 'industry' }]);

    expect(toBoardCatalogItems([{ thscode: '885728.TI', name: '人工智能' }], 'cn_concept')).toEqual([
      { code: '885728.TI', name: '人工智能', boardKind: 'concept' },
    ]);
  });

  it('把 Fuyao 同花顺指数快照字段映射为行情页板块行', () => {
    const catalog = [
      { code: '881169.TI', name: '贵金属', boardKind: 'industry' as const },
      { code: '885728.TI', name: '人工智能', boardKind: 'concept' as const },
      { code: '886031.TI', name: 'ChatGPT概念', boardKind: 'concept' as const },
    ];
    const quotes = new Map<string, Record<string, unknown>>([
      [
        '881169.TI',
        {
          thscode: '881169.TI',
          last_price: 6074.562,
          price_change_ratio_pct: -4.820683,
          turnover: 42_254_410_000,
          volume: 1_562_754_600,
        },
      ],
      [
        '885728.TI',
        {
          thscode: '885728.TI',
          last_price: '1264.014',
          price_change_ratio_pct: '1.877869',
          turnover: '326251260000',
          volume: '19859537000',
        },
      ],
    ]);

    expect(toMarketBoardRows(catalog, quotes)).toEqual([
      {
        code: '885728.TI',
        name: '人工智能',
        boardKind: 'concept',
        price: 1264.014,
        changePercent: 1.877869,
        amount: 326_251_260_000,
        volume: 19_859_537_000,
        minutes: [],
      },
      {
        code: '881169.TI',
        name: '贵金属',
        boardKind: 'industry',
        price: 6074.562,
        changePercent: -4.820683,
        amount: 42_254_410_000,
        volume: 1_562_754_600,
        minutes: [],
      },
    ]);
  });

  it('真实快照缺行时不会构造假板块行情', () => {
    const rows = toMarketBoardRows([{ code: '881155.TI', name: '银行', boardKind: 'industry' }], new Map());

    expect(rows).toEqual([]);
  });

  it('把 Fuyao 同花顺指数成分股映射为板块详情成分股', () => {
    const rows = toBoardConstituentRows([
      { ticker: '000426', thscode: '000426.SZ', name: '兴业银锡' },
      { thscode: '600489.SH', name: '中金黄金' },
      { ticker: '', name: '空代码' },
    ]);

    expect(rows).toEqual([
      { code: '000426', name: '兴业银锡' },
      { code: '600489', name: '中金黄金' },
    ]);
  });
});
