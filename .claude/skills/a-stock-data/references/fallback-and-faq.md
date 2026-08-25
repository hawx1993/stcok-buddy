# 备用源、降级策略与 FAQ

> 从旧版单体 `a-stock-data/SKILL.md` 拆分而来。仅在当前任务命中本文件主题时读取；不要一次性读取整个 `references/` 目录。

## 备用源速查 & 降级策略（东财/主源被封时用）

**何时用：** 主源报错 403/连接重置（东财 IP 级风控）、返回空、或需权威一手数据交叉验证时。**东财系接口共用同一风控面，某台住宅 IP 被封会成片失联**——下表给**十类核心数据**各一条独立备胎（不同域名、不同风控面；打板/期权/舆情三层暂无独立备胎）。表内端点均经 2026-07-11 实测存活、零鉴权可用，其中 3 个备胎函数另以真实数据完整跑通。

| 数据类型 | 主源(本 skill) | 独立备胎 | 备胎端点 / 说明 |
|---|---|---|---|
| 实时行情+五档 | mootdx/腾讯 | 交易所官方 | 沪 `yunhq.sse.com.cn:32041/v1/sh1/snap/{code}`、深 `szse.cn/api/market/ssjjhq/getTimeData?marketId=1&code={code}`（一手五档） |
| K线(全历史) | mootdx/百度/腾讯 | 同花顺 | `d.10jqka.com.cn/v6/line/hs_{code}/01/last.js`（01日/11周/21月/30/60分；2001至今；JSONP剥壳） |
| K线(分钟) | mootdx | 腾讯 | `ifzq.gtimg.cn/appstock/app/kline/mkline?param={pre}{code},m5,,320`（m1/m5/m15/m30/m60，≤320根，需头 `Referer: https://gu.qq.com/`；mootdx 一挂时唯一的 5 分钟源）|
| 龙虎榜 | 东财 datacenter | 沪深交易所官方 | `dragon_tiger_backup()`（见下，含营业部席位） |
| 个股资金流 | 东财 push2 | 新浪 | `fund_flow_backup()`（见下，日度四档单净额） |
| 公告 | 巨潮 | 深交所官方/东财 | `announcements_backup()`（见下，深市深交所+PDF，沪市东财+PDF） |
| 财务三表 | 新浪/mootdx | 同花顺 F10 | `basic.10jqka.com.cn/api/stock/finance/{code}_debt.json`（`_benefit`利润/`_cash`现金流；仅 UA，5连发不封） |
| 个股新闻 | 东财 search | 新浪7x24 | `zhibo.sina.com.cn/api/zhibo/feed?zhibo_id=152&page_size=20&dire=f`（`ext.stocks` 带个股关联可过滤） |
| 快讯 | 东财7x24(§5.3) | 财联社(§5.2) | 两条已互备；再加金十 `jin10.com/flash_newest.js` |
| 券商评级+目标价 | 同花顺一致预期 | 巨潮 webapi | `p_sysapi1089?tdate=YYYY-MM-DD`，需头 `Accept-Enckey`=base64(AES-128-CBC(unix秒, key=iv=`1234567887654321`)) |
| 北向(权威) | 同花顺 hexin | HKEX 官方 | `hkex.com.hk/chi/csm/DailyStat/data_tab_daily_{YYYYMMDD}c.js`（成交额/额度/十大活跃股） |

> ⛔ **已死透别用**（2026-07 实测）：网易财经(126.net 整站下线)、和讯、凤凰行情、腾讯资金流(ff_ 已死)、雪球免登录深度数据(需 token)。mootdx **库**已烂尾(2024 停更)但**通达信 TCP 协议本身照常**——继续用，装不上就用 `tdx_client()`。
>
> ⚠️ **腾讯分钟 K 线字段坑**：返回数组 `[时间, 开, 收, 高, 低, 量(手), {}, 换手率基点]`——第 7 个字段**不是成交额，是换手率基点**（当日各根累加 ÷100 = 当日换手率%）。当成交额读会小三个数量级；成交额需自算 `量(手) × 100 × 均价`。

```python
import json, urllib.request, ssl
_ctx = ssl.create_default_context(); _ctx.check_hostname = False; _ctx.verify_mode = ssl.CERT_NONE

def dragon_tiger_backup(trade_date: str) -> dict:
    """龙虎榜官方备用源（东财被封时用）：上交所+深交所官方，零鉴权权威一手，含营业部席位。"""
    out = {"date": trade_date, "sse_raw": "", "szse": []}
    su = (f"https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON"
          f"&CATALOGID=1842_xxpl&TABKEY=tab1&txtStart={trade_date}&txtEnd={trade_date}&random=0.9")
    req = urllib.request.Request(su, headers={"User-Agent": UA,
          "Referer": "https://www.szse.cn/disclosure/supervision/dealinfo/index.html"})
    with urllib.request.urlopen(req, timeout=15, context=_ctx) as r:
        d = json.loads(r.read())
    for row in d[0].get("data", []):
        out["szse"].append({"code": row.get("zqdm"), "name": row.get("zqjc"),
                            "amount": row.get("cjje"), "reason": row.get("plyy")})
    eu = (f"https://query.sse.com.cn/infodisplay/showTradePublicFile.do?"
          f"jsonCallBack=cb&isPagination=false&dateTx={trade_date}")
    req = urllib.request.Request(eu, headers={"User-Agent": UA,
          "Referer": "https://www.sse.com.cn/disclosure/diclosure/public/"})
    with urllib.request.urlopen(req, timeout=15) as r:
        t = r.read().decode("utf-8", "ignore")
    out["sse_raw"] = "\n".join(json.loads(t[t.index("(")+1:t.rindex(")")]).get("fileContents", []))
    return out

def fund_flow_backup(code: str, days: int = 60) -> list:
    """个股资金流备用源（东财被封时用）：新浪，日度四档单净额。"""
    # 92 先判：920xxx 是北交所，误判成 sh/sz 时新浪返回空数组（实测 bj920002 有数据、sh/sz 为 []）
    pre = ("bj" if code.startswith(("92", "8"))
           else "sh" if code.startswith(("6", "9")) else "sz") + code
    u = (f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
         f"MoneyFlow.ssl_qsfx_zjlrqs?page=1&num={days}&sort=opendate&asc=0&daima={pre}")
    req = urllib.request.Request(u, headers={"User-Agent": UA, "Referer": "https://finance.sina.com.cn/"})
    with urllib.request.urlopen(req, timeout=15) as r:
        t = r.read().decode("utf-8", "ignore")
    arr = json.loads(t[t.index("["):t.rindex("]")+1])
    return [{"date": x.get("opendate"), "close": x.get("trade"),
             "net_amount": x.get("netamount"), "turnover": x.get("turnover")} for x in arr]

def announcements_backup(code: str, page_size: int = 20) -> list:
    """公告备用源（巨潮被封时用）：深市走深交所官方，沪市走东财，均带 PDF 直链。"""
    if code.startswith(("0", "3")):
        body = json.dumps({"channelCode": ["listedNotice_disc"], "pageSize": page_size,
                           "pageNum": 1, "stock": [code]}).encode()
        req = urllib.request.Request("https://www.szse.cn/api/disc/announcement/annList", data=body,
              headers={"User-Agent": UA, "Content-Type": "application/json",
                       "Referer": "https://www.szse.cn/disclosure/listed/notice/index.html"})
        with urllib.request.urlopen(req, timeout=15, context=_ctx) as r:
            d = json.loads(r.read())
        return [{"title": a.get("title"), "time": a.get("publishTime", "")[:10],
                 "pdf": "https://disc.static.szse.cn/download" + a.get("attachPath", "")}
                for a in d.get("data", [])]
    u = (f"https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size={page_size}"
         f"&page_index=1&ann_type=A&client_source=web&stock_list={code}&f_node=0&s_node=0")
    req = urllib.request.Request(u, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.loads(r.read())
    return [{"title": a.get("title"), "time": a.get("notice_date", "")[:10],
             "pdf": f"https://pdf.dfcfw.com/pdf/H2_{a.get('art_code','')}_1.pdf"}
            for a in d.get("data", {}).get("list", [])]

# 用法（主源失败时降级）
lhb = dragon_tiger_backup("2026-07-10")   # 深市结构化 + 沪市全文(含营业部)
flow = fund_flow_backup("600519", 60)     # 近60日资金流
anns = announcements_backup("000858")     # 深市走深交所, 沪市走东财
```

---

## FAQ

### Q: 东财接口 403 / 连接重置，是被封了吗，怎么办？
A: 东财系接口（datacenter/push2/push2ex/reportapi/search/np-weblist）共用同一套风控，IP 被封会成片失联。三步处理：① 停止请求等 30-60 分钟（IP 级临时封通常自动解除），或换网络（手机热点）立刻恢复；② 长批任务确认全部走 `em_get()`，并调大 `EM_MIN_INTERVAL`；③ 数据不能等 → 用上方「备用源速查 & 降级策略」的独立备胎（交易所官方/新浪/同花顺，不同风控面，东财被封时不受牵连）。

### Q: 财联社快讯不是 V3.2 标注下线了吗？
A: 已复活（V3.4.0，见 §5.2）。2026-05 死的是旧 `nodeapi` 系接口；官方新版 `v1/roll/get_roll_list` 一直可用，只是强制 `sign` 校验——而 sign 纯本地可算（`md5(sha1(按 key 字典序拼接的 query 串))`），零 key。与 §5.3 东财 7×24 互为独立备份。

### Q: mootdx 库听说停更了，还能用吗？
A: 库确实烂尾（最后 commit 2024-07，官网下线，BESTIP bug 无官方修复），但**通达信 TCP 协议本身照常运行**——烂尾的是封装库，不是数据源。本 skill 的 `tdx_client()` 已内置 IP 探测绕开 BESTIP bug，继续用没问题。若未来 mootdx 装不上，社区活跃替代是 easy_tdx（同协议，日常维护中）。

### Q: mootdx 和腾讯有什么区别？
A: 互补关系。mootdx = 交易层（价格+盘口+K线），腾讯 = 估值层（PE/PB/市值/换手率/涨跌停价）。两者都不封IP。

### Q: V3.0 为什么移除 akshare？
A: akshare 本质是对东财/同花顺/新浪等公开 API 的封装，中间层增加了故障点（版本兼容 bug、pandas 3.0 ArrowInvalid 等）。V3.0 直连底层 HTTP API，零中间依赖，更稳定可控。

### Q: iwencai 返回 401
A: 检查两点：(1) API Key 是否有效 (2) 是否携带了 X-Claw-* Headers。SkillHub 2.0 后必须带 X-Claw Headers，否则一律 401。

### Q: 同花顺一致预期 ths_eps_forecast 返回空
A: 该股票无机构覆盖。小盘/次新/ST 股常见。可 fallback 到东财 reportapi 里的 predictThisYearEps 字段。

### Q: 东财 PDF 下载 403
A: 必须带 `Referer: https://data.eastmoney.com/` header。

### Q: 腾讯 API 返回乱码
A: 编码是 GBK，必须 `decode("gbk")`。

### Q: 腾讯 API 字段 43 是 PB 吗？
A: **不是！** 43=振幅%，46=PB。网上很多教程写错了，这里是实测校准结果。

### Q: iwencai search 返回条数太少
A: `size` 参数默认 10，调到 50。隐藏参数，文档未写明但实测可用。

### Q: 哪些数据源需要 API Key？
A: 只有 iwencai 需要。mootdx / 腾讯 / 东财 / 同花顺 / 百度股市通 / 新浪 / 巨潮 / 财联社全部免费无 key。

### Q: 同花顺热点接口需要 cookie 吗？
A: **不需要**。仅 User-Agent 即可，零鉴权 73ms 拿到 ~125 只当日强势股。但**不要去打 search.10jqka.com.cn 的 iwencai NL 选股接口** —— 那个有 hexin-v cookie JS 签名鉴权，跟热点接口完全两码事。

### Q: 百度股市通 ResultCode 有时是 0 有时是 "0"？
A: 已知坑。`ResultCode` 返回类型不稳定——有时 int，有时 string。代码里必须用 `str(d.get("ResultCode", -1)) != "0"` 统一比较。

### Q: 北向资金历史数据为什么只有最近几天？
A: 本地自缓存模式。eastmoney 全系北向数据自 2024-08 起断供（净买额字段返回 NaN/0）。每次调用实时 API 后自动写入本地 CSV，历史越跑越丰富。

### Q: 行业板块为什么从同花顺换成东财？
A: 同花顺 `stock_board_industry_summary_ths` 接口 2026 年初加了反爬 401（需要登录态）。东财 push2 行业板块数据（`m:90+t:2`）是完美替代，零鉴权且字段更丰富。

### Q: 在海外服务器跑，mootdx 接口超时？
A: mootdx 走 TCP 直连通达信行情服务器，需国内 IP 才稳定。海外环境建议走代理。腾讯财经和百度股市通不受影响。

### Q: 不用 Claude Code，能用吗？
A: 能。SKILL.md 本质是 Markdown + 内嵌 Python 代码。Codex、OpenClaw 或任何 AI 编程助手都能读取。你也可以直接把 Python 代码段复制出来在自己的脚本里跑。

---
