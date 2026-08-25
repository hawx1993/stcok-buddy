# 涨停、连板、炸板与异动

> 从旧版单体 `a-stock-data/SKILL.md` 拆分而来。仅在当前任务命中本文件主题时读取；不要一次性读取整个 `references/` 目录。

## Layer 8: 打板层（涨停 / 炸板 / 跌停 / 题材情绪，V3.3.0 新增）

> 连板梯队、炸板率、晋级率、涨停原因题材——打板与题材跟踪的高频需求（#23 / #15）。东财四池走 `push2ex.eastmoney.com`（与现有 push2 同源，已纳入 `em_get()` 限流）；涨停原因题材增强用同花顺。**全部免登录、零鉴权。**

### 8.1 东财涨停板池 — 涨停 / 炸板 / 跌停 / 昨日涨停

```python
import requests

ZTB_UT = "7eea3edcaed734bea9cbfc24409ed989"

def _fmt_zt_time(t) -> str:
    """涨停板时间整数 → HH:MM:SS（92500 → 09:25:00）。"""
    s = str(t).zfill(6)
    return f"{s[0:2]}:{s[2:4]}:{s[4:6]}"

def _em_zt_api(endpoint: str, sort: str, date: str) -> list[dict]:
    """东财涨停板行情中心通用请求（push2ex，走 em_get 限流）。
    endpoint: getTopicZTPool / getTopicZBPool / getTopicDTPool / getYesterdayZTPool
    返回 data.pool 原始列表（data 为 null = 非交易日 / 参数错）。"""
    url = f"https://push2ex.eastmoney.com/{endpoint}"
    params = {"ut": ZTB_UT, "dpt": "wz.ztzt", "Pageindex": 0,
              "pagesize": 10000, "sort": sort, "date": date}
    headers = {"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"}
    try:
        r = em_get(url, params=params, headers=headers, timeout=10)
        return (r.json().get("data") or {}).get("pool") or []
    except Exception as e:
        print(f"[WARN] 涨停板池 {endpoint} 请求失败: {e}")
        return []

def em_zt_pool(date: str) -> list[dict]:
    """涨停池。date=YYYYMMDD（交易日）。
    返回每只: code/name/price/pct/amount/float_cap/turnover/limit_days(连板数)/
    first_seal/last_seal(封板时间)/seal_fund(封板资金,元)/break_times(炸板次数)/
    industry/zt_stat(N天M板)"""
    out = []
    for p in _em_zt_api("getTopicZTPool", "fbt:asc", date):
        out.append({"code": p["c"], "name": p["n"], "price": p["p"] / 1000,
            "pct": round(p["zdp"], 2), "amount": p["amount"], "float_cap": p["ltsz"],
            "turnover": round(p["hs"], 2), "limit_days": p["lbc"],
            "first_seal": _fmt_zt_time(p["fbt"]), "last_seal": _fmt_zt_time(p["lbt"]),
            "seal_fund": p["fund"], "break_times": p["zbc"], "industry": p.get("hybk", ""),
            "zt_stat": f'{(p.get("zttj") or {}).get("days","?")}天{(p.get("zttj") or {}).get("ct","?")}板'})
    return out

def em_zb_pool(date: str) -> list[dict]:
    """炸板池（涨停后开板）。返回 code/name/price/limit_price(涨停价)/pct/turnover/
    first_seal/break_times/amplitude(振幅)/speed(涨速)/industry/zt_stat"""
    out = []
    for p in _em_zt_api("getTopicZBPool", "fbt:asc", date):
        out.append({"code": p["c"], "name": p["n"], "price": p["p"] / 1000,
            "limit_price": p["ztp"] / 1000, "pct": round(p["zdp"], 2),
            "turnover": round(p["hs"], 2), "first_seal": _fmt_zt_time(p["fbt"]),
            "break_times": p["zbc"], "amplitude": round(p["zf"], 2),
            "speed": round(p["zs"], 2), "industry": p.get("hybk", ""),
            "zt_stat": f'{(p.get("zttj") or {}).get("days","?")}天{(p.get("zttj") or {}).get("ct","?")}板'})
    return out

def em_dt_pool(date: str) -> list[dict]:
    """跌停池。返回 code/name/price/pct/turnover/pe/seal_fund(封单资金)/last_seal/
    board_amount(板上成交额)/dt_days(连续跌停)/open_times(开板次数)/industry"""
    out = []
    for p in _em_zt_api("getTopicDTPool", "fund:asc", date):
        out.append({"code": p["c"], "name": p["n"], "price": p["p"] / 1000,
            "pct": round(p["zdp"], 2), "turnover": round(p["hs"], 2), "pe": p.get("pe"),
            "seal_fund": p["fund"], "last_seal": _fmt_zt_time(p["lbt"]),
            "board_amount": p.get("fba"), "dt_days": p.get("days"),
            "open_times": p.get("oc"), "industry": p.get("hybk", "")})
    return out

def em_yzt_pool(date: str) -> list[dict]:
    """昨日涨停池（昨涨停今表现，算晋级率/赚钱效应）。返回 code/name/price/
    pct(今日涨幅)/turnover/amplitude/speed/y_first_seal(昨封板时间)/
    y_limit_days(昨连板)/industry/zt_stat"""
    out = []
    for p in _em_zt_api("getYesterdayZTPool", "zs:desc", date):
        out.append({"code": p["c"], "name": p["n"], "price": p["p"] / 1000,
            "pct": round(p["zdp"], 2), "turnover": round(p["hs"], 2),
            "amplitude": round(p["zf"], 2), "speed": round(p["zs"], 2),
            "y_first_seal": _fmt_zt_time(p["yfbt"]), "y_limit_days": p["ylbc"],
            "industry": p.get("hybk", ""), "zt_stat": f'{(p.get("zttj") or {}).get("days","?")}天{(p.get("zttj") or {}).get("ct","?")}板'})
    return out

# 用法
zt = em_zt_pool("20260626")
print(f"今日涨停 {len(zt)} 只")
for s in zt[:3]:
    print(f"  {s['name']} {s['zt_stat']} 封板{s['seal_fund']/1e8:.2f}亿 {s['industry']}")
```

> **坑：** ① 价格字段 `price`/`limit_price` 已 ÷1000（原始值是 ×1000 整数）。② 四池只有 `sort` 不同（涨停/炸板=`fbt:asc`、跌停=`fund:asc`、昨涨停=`zs:desc`），`dpt` 都是 `wz.ztzt`。③ `date` 必须传交易日，非交易日 `data` 返回 null。④ 金额单位均为**元**。

### 8.2 同花顺涨停揭秘 — 涨停原因题材 + 封板成功率 + 板型

```python
from datetime import datetime

def ths_limit_up_pool(date: str) -> list[dict]:
    """同花顺涨停揭秘（涨停原因 + 封板质量增强源）。date=YYYYMMDD。
    返回每只: code/name/price/pct/reason(涨停原因题材)/board_type(换手板/一字板/T字板)/
    seal_rate(封板成功率,0~1)/break_times(炸板次数)/seal_amount(封单额,元)/
    high_days(几天几板)/first_time(首次涨停时间)/is_again(是否回封 0/1)"""
    url = "https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool"
    params = {"page": 1, "limit": 200,
              "field": "199112,10,9001,330323,330324,330325,9002,330329,133971,133970,1968584,3475914,9003,9004",
              "filter": "HS,GEM2STAR", "order_field": "330324", "order_type": "0", "date": date}
    try:
        r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=10)
        info = (r.json().get("data") or {}).get("info", [])
    except Exception as e:
        print(f"[WARN] 同花顺涨停揭秘请求失败: {e}")
        return []
    out = []
    for it in info:
        ft = it.get("first_limit_up_time")
        out.append({"code": it.get("code"), "name": it.get("name"),
            "price": it.get("latest"), "pct": it.get("change_rate"),
            "reason": it.get("reason_type", ""), "board_type": it.get("limit_up_type", ""),
            "seal_rate": it.get("limit_up_suc_rate"), "break_times": it.get("open_num") or 0,
            "seal_amount": it.get("order_amount"), "high_days": it.get("high_days", ""),
            "first_time": datetime.fromtimestamp(int(ft)).strftime("%H:%M:%S") if ft else "",
            "is_again": it.get("is_again_limit")})
    return out

# 用法: 涨停原因题材归因
for s in ths_limit_up_pool("20260626")[:5]:
    print(f"  {s['name']} {s['high_days']} | {s['reason']} | 封板率{s['seal_rate']}")
```

> **坑：** `first_limit_up_time` 是 **Unix 秒时间戳**（要 `datetime.fromtimestamp`），不是 HHMMSS。`field` 那串是同花顺内部字段 ID，照抄即可。`filter=HS,GEM2STAR` 控制板块范围（沪深主板 + 创业板 + 科创板）。

### 8.3 打板情绪速算 — 炸板率 / 连板高度 / 连板梯队

```python
def limit_up_sentiment(date: str) -> dict:
    """打板情绪温度计：连板梯队 + 炸板率 + 涨跌停对比。"""
    zt, zb, dt = em_zt_pool(date), em_zb_pool(date), em_dt_pool(date)
    ladder = {}
    for s in zt:
        ladder[s["limit_days"]] = ladder.get(s["limit_days"], 0) + 1
    zt_n, zb_n = len(zt), len(zb)
    return {"date": date, "zt_count": zt_n, "zb_count": zb_n, "dt_count": len(dt),
        "break_rate": round(zb_n / (zt_n + zb_n) * 100, 1) if (zt_n + zb_n) else 0,  # 炸板率%
        "max_height": max((s["limit_days"] for s in zt), default=0),                 # 最高连板
        "ladder": dict(sorted(ladder.items()))}                                       # 连板梯队 {板数:家数}

# 用法
s = limit_up_sentiment("20260626")
print(f"涨停{s['zt_count']} 炸板{s['zb_count']}(炸板率{s['break_rate']}%) "
      f"跌停{s['dt_count']} 最高{s['max_height']}连板")
print(f"连板梯队: {s['ladder']}")
```

> 晋级率（昨涨停今仍涨停 / 昨涨停总数）可用 `em_yzt_pool()` 的 `pct >= 9.8` 计数除以总数自算。

### 8.4 东财重点监控池（V3.6.0 新增 · #15）

东财 App「重点监控」名单：被交易所风险警示 / 重点监控的标的及其**生效时间窗**。零鉴权静态 JSON，全量返回不分页。

```python
from datetime import datetime, timedelta, timezone   # 不要 import datetime 模块：§8.2 的 `from datetime import datetime` 会遮蔽它

# A 股的"今天"按北京时间算。用本机 date.today() 在海外时区会错开一天
# （如新西兰比北京早 4~5 小时，北京傍晚时本机已跨到次日），
# 监控窗口首日/末日会因此提前纳入或提前剔除。
CN_TZ = timezone(timedelta(hours=8))

def cn_today() -> str:
    """北京时间的今天（YYYY-MM-DD）。"""
    return datetime.now(CN_TZ).date().isoformat()

MONITOR_URL = "https://mobappconfig.securities.eastmoney.com/emcfg/stock_monitor.json"

# ⚠️ MARKET 是三值且**含字母 "B"**（北交所），不是 0/1 二值。
# 写成 `"SH" if MARKET=="1" else "SZ"` 会把北交所标的整片错标成 SZ——
# 实测 2026-07-31 全量 16 只里就有 3 只 MARKET="B"（*ST康乐 920575 等）。
_MONITOR_MARKET = {"1": "SH", "0": "SZ", "B": "BJ"}

def em_stock_monitor(only_active: bool = True) -> list[dict]:
    """东财重点监控池。
    only_active=True 只留今天仍在监控窗口内的（按 VALIDATESTARTDATE~VALIDATEENDDATE 过滤）。
    返回: [{code, name, market, start, end, link}]
    """
    r = em_get(MONITOR_URL, headers={"Referer": "https://vipmoney.eastmoney.com/"}, timeout=20)
    rows = r.json() or []
    today = cn_today()
    out = []
    for x in rows:
        start, end = x.get("VALIDATESTARTDATE", ""), x.get("VALIDATEENDDATE", "")
        if only_active and not (start <= today <= end):
            continue
        raw_mkt = str(x.get("MARKET", "")).upper()
        out.append({
            "code":   x.get("STKCODE", ""),
            "name":   x.get("STKNAME", ""),
            # 未知取值不猜市场，原样带出（`?<原值>`），避免静默标错
            "market": _MONITOR_MARKET.get(raw_mkt, f"?{raw_mkt}"),
            "start":  start, "end": end,
            "link":   x.get("LINK_URL", ""),
        })
    return out

# 用法
pool = em_stock_monitor()
print(f"当前重点监控 {len(pool)} 只")
for s in pool[:5]:
    print(f"  {s['code']} {s['name']}({s['market']}) 监控期 {s['start']}~{s['end']}")
```

| 字段 | 含义 |
|------|------|
| STKCODE / STKNAME | 代码 / 名称 |
| MARKET | `"1"`=沪市，`"0"`=深市，**`"B"`=北交所**（三值且含字母，别当 0/1 二值处理） |
| VALIDATESTARTDATE / VALIDATEENDDATE | 监控生效起 / 止日（通常 14 天窗口） |
| LINK_URL | 东财 App 内详情页（可空） |

### 8.5 东财日内异动池 — 严重异常波动（V3.6.0 新增 · #15）

交易所「严重异常波动」口径的异动标的：连续 N 日同向异动、累计偏离值触发阈值等。两个端点同源，**零鉴权，但必须带 `team=h5` 等固定参数**，否则返回 `{"result":1001,"msg":"unknow team"}`。

```python
ANOMALY_BASE = "https://dycalchis.eastmoney.com/price-anomaly"
# 东财 H5 固定公共参数，缺 team 会被拒（unknow team）
HQ_PARAMS = {"team": "h5", "product": "EastMoney", "client": "WAP",
             "version": "9001", "name": "WAP", "user": "123"}

# 异动规则码（e 字段）→ 文字说明；s==6 且 e∈{4,5,6,7} 时按 e*10 取更严阈值那档
ANOMALY_RULES = {
    1:  "主板连续10个交易日内4次出现同向异常波动",
    2:  "创业板连续10个交易日内3次出现同向异常波动",
    3:  "科创板连续10个交易日内3次出现同向异常波动",
    4:  "连续十个交易日内日收盘价涨跌幅偏离值累计达到+100%",
    5:  "连续十个交易日内日收盘价涨跌幅偏离值累计达到-50%",
    6:  "连续三十个交易日内日收盘价涨跌幅偏离值累计达到+200%",
    7:  "连续三十个交易日内日收盘价涨跌幅偏离值累计达到-70%",
    8:  "北交所连续10个交易日内3次出现同向异常波动",
    40: "连续十个交易日内日收盘价涨跌幅偏离值累计达到+150%",
    50: "连续十个交易日内日收盘价涨跌幅偏离值累计达到-60%",
    60: "连续30个交易日内日收盘价涨跌幅偏离值累计达到+300%",
    70: "连续30个交易日内日收盘价涨跌幅偏离值累计达到-75%",
}

def _anomaly_market(code, m, board=None) -> str:
    """异动记录 → 交易所。
    ⚠️ 不能只看 m：东财体系里**北交所与深市同为 m=0**（拉北交所清单用的就是 `m:0+t:81`），
       只按 `m==1 else "SZ"` 会把北交所标的错标成 SZ——而异动规则码 8 正是北交所专用，
       说明北交所记录确实会出现在本接口。代码号段无歧义，优先用它判。
    """
    c = str(code or "")
    if c.startswith("920") or c[:2] in ("43", "83", "87") or board == 8:
        return "BJ"
    return "SH" if m == 1 else "SZ"

def _anomaly_get(path: str, page_size: int, page_no: int, **extra) -> dict:
    params = {**HQ_PARAMS, "pageSize": str(page_size), "pageNo": str(page_no), **extra}
    r = em_get(f"{ANOMALY_BASE}/{path}", params=params,
               headers={"Referer": "https://vipmoney.eastmoney.com/"}, timeout=20)
    d = r.json()
    if d.get("result") != 0:
        # 正向识别：接口用 result!=0 表达拒绝，不能当成「今天没异动」静默吞掉
        raise RuntimeError(f"东财异动接口拒绝: result={d.get('result')} msg={d.get('msg')!r}")
    return d

def em_price_anomaly(page_size: int = 200, page_no: int = 1) -> dict:
    """日内异动明细（price-anomaly/list）。返回 {date, items:[...]}"""
    d = _anomaly_get("list", page_size, page_no)
    items = []
    for x in d.get("data") or []:
        e = x.get("e")
        key = e * 10 if (x.get("s") == 6 and e in (4, 5, 6, 7)) else e
        items.append({
            "code": x.get("c"), "name": x.get("n"),
            "market": _anomaly_market(x.get("c"), x.get("m"), x.get("s")),
            "change_pct": x.get("a"),          # 当日涨跌幅%
            "deviation": x.get("x"),           # 累计偏离值%
            "days": x.get("d"),                # 统计窗口天数
            "board": x.get("s"),               # 板块码：1=主板 4=创业板 6=科创板(阈值加严) 8=北交所
            "rule_code": key,
            "rule": ANOMALY_RULES.get(key, f"未知规则码 {key}"),
            "is_today": x.get("o") != 2,
        })
    return {"date": str(d.get("date", "")), "pages": d.get("pages", 0), "items": items}

def em_price_anomaly_count(page_size: int = 50, page_no: int = 1,
                           sort_key: str = "", sort_dir: str = "") -> dict:
    """异动统计（price-anomaly/count）：按标的聚合的异动次数 + 现价。"""
    d = _anomaly_get("count", page_size, page_no, sortKey=sort_key, sortDir=sort_dir)
    items = [{
        "code": x.get("c"), "name": x.get("n"),
        "market": _anomaly_market(x.get("c"), x.get("m"), x.get("s")),
        "price": x.get("p"),                 # 最新价（已核对腾讯行情，3/3 一致）
        "change_pct": x.get("a"),            # 涨跌幅%（已核对腾讯行情，3/3 一致）
        "times": x.get("t"),                 # 窗口内异动次数
        "deviation": x.get("x"),             # 累计偏离值%
        "days": x.get("d"),                  # 统计窗口天数
        "board": x.get("s"),
    } for x in d.get("data") or []]
    return {"date": str(d.get("date", "")), "pages": d.get("pages", 0), "items": items}

# 用法
a = em_price_anomaly(page_size=200)
print(f"{a['date']} 日内异动 {len(a['items'])} 条")
for s in a["items"][:5]:
    print(f"  {s['code']} {s['name']} {s['change_pct']}% 偏离{s['deviation']}%/{s['days']}日 | {s['rule']}")

c = em_price_anomaly_count(page_size=50)
for s in c["items"][:5]:
    print(f"  {s['code']} {s['name']} {s['price']}元 {s['change_pct']}% 异动{s['times']}次")

# 与重点监控池交叉：异动 且 已在监控名单 = 最高风险
monitor_codes = {x["code"] for x in em_stock_monitor()}
hot = [s for s in a["items"] if s["code"] in monitor_codes]
print(f"异动且在监控池: {[(s['code'], s['name']) for s in hot]}")
```

> **字段来源说明：** `p`/`a`（最新价、涨跌幅）已与腾讯行情逐条核对（3/3 完全一致）；`m`/`c`/`n`/`e`/`x`/`d`/`o` 的语义取自东财前端 `formatNewData` 的字段映射（`x`→DEVUATION_VALUE、`d`→MAX_DAYS、`a`→CHANGE_RATE、`o`→IS_HAPPEN）。
>
> **两端点同名字母含义不同：** `list` 的 `t` 是涨跌幅目标值（浮点），`count` 的 `t` 是异动次数（整数）——不要跨端点复用解析逻辑。
>
> **`open` 字段**为盘口开闭标志；`date` 为交易日（`YYYYMMDD`）。非交易时段返回上一交易日数据，属正常。

---
