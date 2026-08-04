#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
a-stock-data 运行时执行器（只移植所需函数）

数据源：.claude/skills/a-stock-data/SKILL.md（唯一数据源）。
以下函数从 SKILL.md 按章节移植，来源章节见各函数 docstring；与 SKILL.md 同步时按注释对照。

依赖：仅 requests + stdlib（.venv 已装 requests，无需 pandas/mootdx）。

用途：`python a-stock-data.py <fn> [--key value ...]`，结果以
`print(json.dumps(result, ensure_ascii=False))` 输出 JSON；失败抛错非零退出。
"""
import json
import random
import sys
import time

import requests

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
DATACENTER_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"

# ── 东财防封：全局节流 + 会话复用（SKILL.md「数据源优先级 & 东财防封」章节）──────
EM_SESSION = requests.Session()
EM_SESSION.headers.update({"User-Agent": UA})
try:
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    EM_SESSION.mount(
        "https://",
        HTTPAdapter(
            max_retries=Retry(
                total=3,
                connect=3,
                backoff_factor=0.6,
                status_forcelist=[429, 500, 502, 503, 504],
                allowed_methods=["GET"],
            )
        ),
    )
except Exception:
    pass  # 老版本 urllib3 缺参数时降级为无重试，不影响主流程
EM_MIN_INTERVAL = 1.0  # 两次东财请求最小间隔(秒)
_em_last_call = [0.0]


def em_get(url: str, params: dict | None = None, headers: dict | None = None, timeout: int = 15, **kwargs):
    """东财统一请求入口：自动节流 + 复用 session + 默认 UA。所有 eastmoney.com 请求走它。"""
    wait = EM_MIN_INTERVAL - (time.time() - _em_last_call[0])
    if wait > 0:
        time.sleep(wait + random.uniform(0.1, 0.5))
    try:
        return EM_SESSION.get(url, params=params, headers=headers, timeout=timeout, **kwargs)
    finally:
        _em_last_call[0] = time.time()


def eastmoney_datacenter(
    report_name: str,
    columns: str = "ALL",
    filter_str: str = "",
    page_size: int = 50,
    sort_columns: str = "",
    sort_types: str = "-1",
) -> list[dict]:
    """东财数据中心统一查询（已内置限流）。"""
    params = {
        "reportName": report_name,
        "columns": columns,
        "filter": filter_str,
        "pageNumber": "1",
        "pageSize": str(page_size),
        "sortColumns": sort_columns,
        "sortTypes": sort_types,
        "source": "WEB",
        "client": "WEB",
    }
    r = em_get(DATACENTER_URL, params=params, timeout=15)
    d = r.json()
    if d.get("result") and d["result"].get("data"):
        return d["result"]["data"]
    return []


# ── 常量（SKILL.md §3.8 / §10.2）──────────────────────────────────────
_BOARD_FS = {"industry": "m:90+t:2", "concept": "m:90+t:3", "region": "m:90+t:1"}
# 周期 → (排序fid, 主力净额, 主力净占比, 涨跌幅, 领涨股name)；四档明细仅今日
_BOARD_PERIOD = {
    "today": ("f62", "f62", "f184", "f3", "f204"),
    "5d": ("f164", "f164", "f165", "f109", "f257"),
    "10d": ("f174", "f174", "f175", "f160", None),  # 10日领涨股名称字段不稳定，省略
}
EM_HOT_BODY = {"appId": "appId01", "globalId": "786e4c21-70dc-435a-93bb-38"}


# ── §4.3 股东户数变化 ──────────────────────────────────────────────────
def holder_num_change(code: str, page_size: int = 10) -> list[dict]:
    """股东户数变化（季度级）。返回: [{date, holder_num, change_num, change_ratio, avg_shares}]"""
    data = eastmoney_datacenter(
        "RPT_HOLDERNUMLATEST",
        filter_str=f'(SECURITY_CODE="{code}")',
        page_size=page_size,
        sort_columns="END_DATE",
        sort_types="-1",
    )
    rows = []
    for row in data:
        rows.append(
            {
                "date": str(row.get("END_DATE", ""))[:10],
                "holder_num": row.get("HOLDER_NUM", 0),
                "change_num": row.get("HOLDER_NUM_CHANGE", 0),
                "change_ratio": row.get("HOLDER_NUM_RATIO", 0),  # 环比%
                "avg_shares": row.get("AVG_FREE_SHARES", 0),  # 户均持股
            }
        )
    return rows


# ── §3.7 行业板块涨跌幅排名 ────────────────────────────────────────────
def industry_comparison(top_n: int = 20) -> dict:
    """全行业涨跌幅排名（东财行业板块，~100 个行业）。返回: {top, bottom, total}"""
    url = "https://push2.eastmoney.com/api/qt/clist/get"
    params = {
        "pn": "1",
        "pz": "100",
        "po": "1",
        "np": "1",
        "fltt": "2",
        "invt": "2",
        "fid": "f3",  # fid=f3 + po=1：按涨跌幅降序
        "fs": "m:90+t:2",
        "fields": "f2,f3,f4,f12,f13,f14,f104,f105,f128,f136,f140,f141,f207",
    }
    r = em_get(url, params=params, headers={"User-Agent": UA}, timeout=15)
    d = r.json()
    items = d.get("data", {}).get("diff", [])
    if not items:
        return {"top": [], "bottom": [], "total": 0}

    rows = []
    for i, item in enumerate(items):
        rows.append(
            {
                "rank": i + 1,
                "name": item.get("f14", ""),
                "change_pct": item.get("f3", 0),
                "code": item.get("f12", ""),
                "up_count": item.get("f104", 0),
                "down_count": item.get("f105", 0),
                "leader": item.get("f140", ""),
                "leader_change": item.get("f136", 0),
            }
        )
    return {"top": rows[:top_n], "bottom": rows[-top_n:], "total": len(rows)}


# ── §3.8 板块资金流向 ──────────────────────────────────────────────────
def board_fund_flow(board_type: str = "industry", period: str = "today", top_n: int = 20) -> dict:
    """板块资金流向排名（按主力净流入降序）。board_type: industry/concept/region；period: today/5d/10d。"""
    if board_type not in _BOARD_FS:
        raise ValueError(f"board_type 须为 {list(_BOARD_FS)}")
    if period not in _BOARD_PERIOD:
        raise ValueError(f"period 须为 {list(_BOARD_PERIOD)}")
    fid, f_main, f_pct, f_chg, f_leader = _BOARD_PERIOD[period]

    fields = ["f12", "f14", f_chg, f_main, f_pct]
    if f_leader:
        fields.append(f_leader)
    if period == "today":
        fields += ["f66", "f72", "f78", "f84"]  # 超大/大/中/小单净额

    url = "https://push2.eastmoney.com/api/qt/clist/get"
    base = {
        "pz": "200",
        "po": "1",
        "np": "1",
        "fltt": "2",
        "invt": "2",
        "fid": fid,  # fid + po=1：按该周期主力净额降序
        "fs": _BOARD_FS[board_type],
        "fields": ",".join(dict.fromkeys(fields)),  # 去重保序
    }

    def _page(pn: int):
        r = em_get(url, params={**base, "pn": str(pn)}, headers={"User-Agent": UA}, timeout=15)
        d = r.json().get("data") or {}
        return (d.get("diff") or []), int(d.get("total") or 0)

    _PAGE = 200
    items, total = _page(1)
    pn = 2
    while len(items) < top_n:
        if total and len(items) >= total:
            break
        more, _ = _page(pn)
        if not more:
            break
        items += more
        pn += 1
        if len(more) < _PAGE:
            break
    total = max(total, len(items))

    rows = []
    for i, it in enumerate(items):
        row = {
            "rank": i + 1,
            "name": it.get("f14", ""),
            "code": it.get("f12", ""),
            "change_pct": it.get(f_chg, 0),
            "main_net": it.get(f_main, 0),  # 主力净流入净额（元）
            "main_pct": it.get(f_pct, 0),  # 主力净流入净占比（%）
            "leader": it.get(f_leader, "") if f_leader else "",
        }
        if period == "today":
            row.update(
                {
                    "super_large_net": it.get("f66", 0),
                    "large_net": it.get("f72", 0),
                    "medium_net": it.get("f78", 0),
                    "small_net": it.get("f84", 0),
                }
            )
        rows.append(row)
    return {"board_type": board_type, "period": period, "total": total, "rows": rows[:top_n]}


# ── §10.2 同花顺热榜 + 东财人气榜 ──────────────────────────────────────
def ths_hot_list(period: str = "hour") -> list[dict]:
    """同花顺热榜（单接口拿名称+人气+概念标签+排名变化）。period: hour/day。"""
    try:
        r = requests.get(
            "https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock",
            params={"stock_type": "a", "type": period, "list_type": "normal"},
            headers={"User-Agent": UA},
            timeout=10,
        )
        lst = (r.json().get("data") or {}).get("stock_list") or []
    except Exception as e:
        print(f"[WARN] 同花顺热榜失败: {e}", file=sys.stderr)
        return []
    out = []
    for it in lst:
        tag = it.get("tag") or {}
        out.append(
            {
                "rank": it.get("order"),
                "code": it.get("code"),
                "name": it.get("name"),
                "heat": it.get("rate"),
                "pct": it.get("rise_and_fall"),
                "rank_chg": it.get("hot_rank_chg"),
                "concepts": tag.get("concept_tag") or [],
                "tag": tag.get("popularity_tag", ""),
            }
        )
    return out


def em_hot_rank(top: int = 50) -> list[dict]:
    """东财人气榜（排名 + 排名变化 + 名称/价格）。返回 rank/code/name/price/pct/rank_chg。"""
    try:
        r = requests.post(
            "https://emappdata.eastmoney.com/stockrank/getAllCurrentList",
            json={**EM_HOT_BODY, "marketType": "", "pageNo": 1, "pageSize": top},
            headers={"User-Agent": UA},
            timeout=10,
        )
        data = r.json().get("data") or []
        if not data:
            return []
        # 人气榜只给带前缀代码，用 push2 ulist.np 批量补名称/价格
        secids = [("0." if it["sc"].startswith("SZ") else "1.") + it["sc"][2:] for it in data]
        u = requests.get(
            "https://push2.eastmoney.com/api/qt/ulist.np/get",
            params={
                "ut": "f057cbcbce2a86e2866ab8877db1d059",
                "fltt": 2,
                "invt": 2,
                "fields": "f14,f3,f12,f2",
                "secids": ",".join(secids),
            },
            headers={"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"},
            timeout=10,
        )
        diff = (u.json().get("data") or {}).get("diff") or []
        if isinstance(diff, dict):  # push2 的 diff 有时是 dict
            diff = list(diff.values())
        nm = {x["f12"]: (x.get("f14"), x.get("f2"), x.get("f3")) for x in diff}
    except Exception as e:
        print(f"[WARN] 东财人气榜失败: {e}", file=sys.stderr)
        return []
    out = []
    for it in data:
        code = it["sc"][2:]
        name, price, pct = nm.get(code, ("", None, None))
        out.append(
            {
                "rank": it["rk"],
                "code": code,
                "name": name,
                "price": price,
                "pct": pct,
                "rank_chg": it.get("hisRc"),
            }
        )
    return out


# ── §1.2 腾讯财经实时行情 ─────────────────────────────────────────────
def tencent_quote(codes):
    """批量拉取腾讯财经实时行情（不封IP，无需限流）。codes 支持逗号分隔字符串/数字/列表。
    返回: {code: {name, price, change_pct, pe_ttm, pb, mcap_yi, turnover_pct, ...}}"""
    if isinstance(codes, str):
        codes = [c.strip() for c in codes.split(",") if c.strip()]
    elif isinstance(codes, (int, float)):
        codes = [str(codes)]
    codes = [str(c) for c in codes]

    SH_INDEX = {"000300", "000905", "000016", "000688", "000852", "000010"}  # 沪指数白名单
    prefixed = []
    key_of = {}  # 带前缀的查询键 → 调用方原始写法
    for c in codes:
        low = c.lower()
        if low.startswith(("sh", "sz", "bj")):
            p = low
        elif c.startswith("92"):  # 北交所 920 号段须先于 9x 判断
            p = f"bj{c}"
        elif c in SH_INDEX or c.startswith(("5", "6", "9")):
            p = f"sh{c}"
        elif c.startswith(("4", "8")):
            p = f"bj{c}"
        else:
            p = f"sz{c}"
        prefixed.append(p)
        key_of[p] = c

    url = "https://qt.gtimg.cn/q=" + ",".join(prefixed)
    r = requests.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
    r.encoding = "gbk"
    data = r.text

    result = {}
    for line in data.strip().split(";"):
        if not line.strip() or "=" not in line or '"' not in line:
            continue
        key = line.split("=")[0].split("_")[-1]
        vals = line.split('"')[1].split("~")
        if len(vals) < 53:
            continue
        code = key_of.get(key, key[2:])
        result[code] = {
            "name": vals[1],
            "price": float(vals[3]) if vals[3] else 0,
            "last_close": float(vals[4]) if vals[4] else 0,
            "open": float(vals[5]) if vals[5] else 0,
            "change_amt": float(vals[31]) if vals[31] else 0,
            "change_pct": float(vals[32]) if vals[32] else 0,
            "high": float(vals[33]) if vals[33] else 0,
            "low": float(vals[34]) if vals[34] else 0,
            "amount_wan": float(vals[37]) if vals[37] else 0,
            "turnover_pct": float(vals[38]) if vals[38] else 0,
            "pe_ttm": float(vals[39]) if vals[39] else 0,
            "amplitude_pct": float(vals[43]) if vals[43] else 0,
            "float_mcap_yi": float(vals[44]) if vals[44] else 0,
            "mcap_yi": float(vals[45]) if vals[45] else 0,
            "pb": float(vals[46]) if vals[46] else 0,
            "limit_up": float(vals[47]) if vals[47] else 0,
            "limit_down": float(vals[48]) if vals[48] else 0,
            "vol_ratio": float(vals[49]) if vals[49] else 0,
            "pe_static": float(vals[52]) if vals[52] else 0,
        }
        # 僵尸报价检测：腾讯对已迁移的北交所老码 / 长期停牌股照样返回 HTTP 200 + 定格报价
        q = result[code]
        q["is_stale"] = q["amount_wan"] == 0 and q["price"] == q["last_close"] and q["price"] > 0
        if q["is_stale"] and key[2:4] in ("43", "83", "87"):
            q["stale_reason"] = "北交所老号段，多数已迁至 920xxx，请按名称反查现行代码"
        elif q["is_stale"]:
            q["stale_reason"] = "成交量为 0（停牌 / 未开盘 / 废码），报价非当日真实成交"
    return result


# ── §1.3 百度股市通 K线（自带均线）────────────────────────────────────
def baidu_kline_with_ma(code: str, start_time: str = "") -> dict:
    """百度股市通K线 — 独有能力: 返回时自带 ma5/ma10/ma20 均价。返回 {keys, rows}。"""
    code = str(code)
    url = "https://finance.pae.baidu.com/selfselect/getstockquotation"
    params = {
        "all": "1", "isIndex": "false", "isBk": "false", "isBlock": "false",
        "isFutures": "false", "isStock": "true", "newFormat": "1",
        "group": "quotation_kline_ab", "finClientType": "pc",
        "code": code, "start_time": start_time, "ktype": "1",
    }
    headers = {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/vnd.finance-web.v1+json",
        "Origin": "https://gushitong.baidu.com",
        "Referer": "https://gushitong.baidu.com/",
    }
    r = requests.get(url, params=params, headers=headers, timeout=10)
    d = r.json()
    result = d.get("Result", {})
    md = result.get("newMarketData", {})
    keys = md.get("keys", [])
    rows = md.get("marketData", "").split(";")
    return {"keys": keys, "rows": rows}


# ── §3.4 东财 push2 个股资金流（分钟级）────────────────────────────────
def eastmoney_fund_flow_minute(code: str) -> list[dict]:
    """个股资金流向（分钟级，当日盘中）。返回: [{time, main_net, small_net, mid_net, large_net, super_net}] 单位元。"""
    code = str(code)
    secid = f"1.{code}" if code.startswith("6") else f"0.{code}"
    url = "https://push2.eastmoney.com/api/qt/stock/fflow/kline/get"
    params = {
        "secid": secid, "klt": 1,
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57",
    }
    headers = {"User-Agent": UA, "Referer": "https://quote.eastmoney.com/", "Origin": "https://quote.eastmoney.com"}
    try:
        r = em_get(url, params=params, headers=headers, timeout=10)
        d = r.json()
    except Exception as e:
        print(f"[WARN] push2 资金流请求失败: {e}", file=sys.stderr)
        return []

    rows = []
    for line in d.get("data", {}).get("klines", []):
        parts = line.split(",")
        if len(parts) >= 6:
            rows.append(
                {
                    "time": parts[0],
                    "main_net": float(parts[1]),
                    "small_net": float(parts[2]),
                    "mid_net": float(parts[3]),
                    "large_net": float(parts[4]),
                    "super_net": float(parts[5]),
                }
            )
    return rows


# ── §4.4 分红送转历史 ─────────────────────────────────────────────────
def dividend_history(code: str, page_size: int = 20) -> list[dict]:
    """分红送转历史。返回: [{date, bonus_rmb(每股派息), transfer_ratio(每10股转增), bonus_ratio(每10股送股), plan}]"""
    data = eastmoney_datacenter(
        "RPT_SHAREBONUS_DET",
        filter_str=f'(SECURITY_CODE="{code}")',
        page_size=page_size,
        sort_columns="EX_DIVIDEND_DATE",
        sort_types="-1",
    )
    rows = []
    for row in data:
        rows.append(
            {
                "date": str(row.get("EX_DIVIDEND_DATE", ""))[:10],
                "bonus_rmb": row.get("PRETAX_BONUS_RMB", 0),  # 每股派息(税前)
                "transfer_ratio": row.get("TRANSFER_RATIO", 0),  # 每10股转增
                "bonus_ratio": row.get("BONUS_RATIO", 0),  # 每10股送股
                "plan": row.get("ASSIGN_PROGRESS", ""),  # 进度
            }
        )
    return rows


FUNCS = {
    "holder_num_change": holder_num_change,
    "dividend_history": dividend_history,
    "tencent_quote": tencent_quote,
    "baidu_kline_with_ma": baidu_kline_with_ma,
    "eastmoney_fund_flow_minute": eastmoney_fund_flow_minute,
    "industry_comparison": industry_comparison,
    "board_fund_flow": board_fund_flow,
    "ths_hot_list": ths_hot_list,
    "em_hot_rank": em_hot_rank,
}


def _coerce(value: str):
    if value == "true":
        return True
    if value == "false":
        return False
    # 纯数字无前导零 → int；有前导零（股票代码如 000858）或其余 → 保持字符串
    if value.isdigit():
        return int(value) if (value == "0" or not value.startswith("0")) else value
    return value


def main() -> None:
    if len(sys.argv) < 2:
        sys.stderr.write("用法: a-stock-data.py <fn> [--key value ...]\n")
        sys.exit(2)
    fn_name = sys.argv[1]
    fn = FUNCS.get(fn_name)
    if not fn:
        sys.stderr.write(f"未知函数: {fn_name}，可选: {sorted(FUNCS)}\n")
        sys.exit(2)
    args: dict = {}
    i = 2
    while i < len(sys.argv):
        if sys.argv[i].startswith("--") and i + 1 < len(sys.argv):
            args[sys.argv[i][2:]] = _coerce(sys.argv[i + 1])
            i += 2
        else:
            i += 1
    result = fn(**args)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
