# 端点路由速查

> 从旧版单体 `a-stock-data/SKILL.md` 拆分而来。仅在当前任务命中本文件主题时读取；不要一次性读取整个 `references/` 目录。

## 端点路由速查（按需定位，不必通读全文）

只需一类数据时，按下表定位章节（§）局部读取。除 iwencai 需 API Key 外全部零 key。

| § | 函数 | 拿什么 | 源 |
|---|------|--------|----|
| 前置 | `norm_ticker(code)` | 任意写法→纯6位（`SH600519`/`600519.SH` 皆可；解析失败抛错不返空） | 本地 |
| 1.1 | `tdx_client()` → `.bars()` / `.quotes()` / `.transaction()` | K线(多周期,不复权) / 五档盘口 / 逐笔成交 | 通达信 |
| 1.2 | `tencent_quote(codes)` | 实时价/PE/PB/市值/换手/涨跌停/指数/ETF（带 `is_stale` 僵尸报价标志） | 腾讯 |
| 1.3 | `baidu_kline_with_ma(code)` | 日K线带 MA5/10/20 | 百度 |
| 2.1 | `eastmoney_reports(code)` / `download_pdf(rec)` | 个股研报+评级+三年EPS / 研报PDF | 东财 |
| 2.1 | `eastmoney_industry_reports(industry_code)` | 行业研报 | 东财 |
| 2.2 | `ths_eps_forecast(code)` | 机构一致预期 EPS | 同花顺 |
| 2.3 | `iwencai_search(query)` / `iwencai_query(query)` | NL 语义搜研报/选股（需 Key） | iwencai |
| 3.1 | `ths_hot_reason()` | 当日强势股+题材归因 | 同花顺 |
| 3.2 | `hsgt_realtime()` | 北向分钟流向（hgt 可用 / sgt 仅参考） | 同花顺 |
| 3.3 | `eastmoney_concept_blocks(code)` | 个股所属板块/概念归属 | 东财 |
| 3.4 | `eastmoney_fund_flow_minute(code)` | 个股资金流（分钟级） | 东财 |
| 3.5 | `dragon_tiger_board(code, date)` | 个股龙虎榜+买卖席位 TOP5 | 东财 |
| 3.6 | `lockup_expiry(code, date)` | 解禁历史+未来90天待解禁 | 东财 |
| 3.7 | `industry_comparison()` | 行业板块涨跌排名 | 东财 |
| 3.8 | `board_fund_flow(board_type, period)` | 板块资金流向（行业/概念/地域 × 今日/5日/10日，主力+四档） | 东财 |
| 3.9 | `daily_dragon_tiger(date)` | 全市场龙虎榜+净买额排名 | 东财 |
| 4.1 | `margin_trading(code)` | 融资融券明细 | 东财 |
| 4.2 | `block_trade(code)` | 大宗交易+营业部 | 东财 |
| 4.3 | `holder_num_change(code)` | 股东户数变化 | 东财 |
| 4.4 | `dividend_history(code)` | 分红送转历史 | 东财 |
| 4.5 | `stock_fund_flow_120d(code)` | 个股资金流（120日，日级） | 东财 |
| 5.1 | `eastmoney_stock_news(code)` | 个股新闻 | 东财 |
| 5.2 | `cls_telegraph()` | 财联社电报（7×24，本地签名零key） | 财联社 |
| 5.3 | `eastmoney_global_news()` | 全球资讯（7×24） | 东财 |
| 6.1 | `client.finance(symbol)` | 季报快照 37 字段 | 通达信 |
| 6.2 | `client.F10(symbol, name)` | 公司资料 9 大类文本 | 通达信 |
| 6.3 | `eastmoney_stock_info(code)` | 行业/股本/市值/上市日期 | 东财 |
| 6.4 | `sina_financial_report(code, type)` | 财报三表 | 新浪 |
| 7.1 | `cninfo_announcements(code)` | 公告检索+PDF 下载 | 巨潮 |
| 7.2 | `client.F10(symbol, name='最新提示')` | 最新公告摘要 | 通达信 |
| 8.1 | `em_zt_pool` / `em_zb_pool` / `em_dt_pool` / `em_yzt_pool` | 涨停/炸板/跌停/昨涨停四池 | 东财 |
| 8.2 | `ths_limit_up_pool(date)` | 涨停原因题材+封板成功率+板型 | 同花顺 |
| 8.3 | `limit_up_sentiment(date)` | 炸板率/连板高度/连板梯队 | 东财(四池组合) |
| 8.4 | `em_stock_monitor()` | 重点监控池（风险警示名单+生效时间窗） | 东财 |
| 8.5 | `em_price_anomaly()` / `em_price_anomaly_count()` | 日内异动明细 / 按标的聚合异动统计（严重异常波动） | 东财 |
| 9.1 | `sina_option_codes` / `sina_option_tquote` / `sina_option_greeks` | ETF期权合约清单 / T型报价 / 希腊字母+IV | 新浪 |
| 10.1 | `cninfo_irm(code)` | 互动易问答（提问+公司回复） | 巨潮 |
| 10.2 | `ths_hot_list()` / `em_hot_rank()` / `em_hot_concept(code)` | 热榜/人气榜/概念命中 | 同花顺+东财 |
| 备用源速查 | `dragon_tiger_backup` / `fund_flow_backup` / `announcements_backup` | 龙虎榜/资金流/公告官方备胎（主源被封时降级） | 交易所官方+新浪+东财(沪市公告) |
| 估值公式 | `forward_pe` / `pe_digestion` / `calc_peg` / `full_valuation(code)` | 前向PE / PE消化时间 / PEG / 单票估值全景 | 本地计算 |
