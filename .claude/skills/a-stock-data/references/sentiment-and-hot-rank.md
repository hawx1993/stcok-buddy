# 互动易、热榜与人气榜

> 从旧版单体 `a-stock-data/SKILL.md` 拆分而来。仅在当前任务命中本文件主题时读取；不要一次性读取整个 `references/` 目录。

## Layer 10: 舆情互动层（互动易问答 + 热榜 + 人气榜，V3.3.0 新增）

> 投资者互动问答 + 市场热度——AI 问答与选题的独家信源。**互动易**（巨潮）能答"公司怎么回应某传闻/利好"，别处拿不到；**同花顺热榜 / 东财人气榜**给"当下最热个股 + 被归到什么概念在炒"。全部免登录、零鉴权。

### 10.1 互动易问答（巨潮 — 投资者提问 + 公司回复）

```python
import requests
from datetime import datetime

def cninfo_irm(code: str, page_size: int = 30, page_num: int = 1) -> list[dict]:
    """互动易问答（深沪统一走巨潮）。code: 6位代码。
    返回每条: code/company/question(投资者提问)/answer(公司回复,None=未回复)/
    answerer(回答方)/ask_time。"""
    try:
        r1 = requests.post("https://irm.cninfo.com.cn/newircs/index/queryKeyboardInfo",
            data={"keyWord": code}, headers={"User-Agent": UA}, timeout=10)
        d1 = r1.json().get("data") or []
        if not d1:
            return []
        org_id = d1[0].get("secid")
        # ⚠️ 第二步参数必须放 query string（POST 但 body 空），否则 HTTP 400
        params = {"_t": 1, "stockcode": code, "orgId": org_id, "pageSize": page_size,
                  "pageNum": page_num, "keyWord": "", "startDay": "", "endDay": ""}
        r2 = requests.post("https://irm.cninfo.com.cn/newircs/company/question",
            params=params, headers={"User-Agent": UA}, timeout=10)
        rows = r2.json().get("rows") or []
    except Exception as e:
        print(f"[WARN] 互动易请求失败: {e}")
        return []
    out = []
    for it in rows:
        pd = it.get("pubDate")
        out.append({"code": it.get("stockCode"), "company": it.get("companyShortName"),
            "question": it.get("mainContent"), "answer": it.get("attachedContent"),
            "answerer": it.get("attachedAuthor"),
            "ask_time": datetime.fromtimestamp(pd / 1000).strftime("%Y-%m-%d %H:%M") if pd else ""})
    return out

# 用法: 看公司怎么回应投资者关切
for q in cninfo_irm("002594", page_size=30):
    if q["answer"]:
        print(f"  Q: {q['question'][:30]}\n  A[{q['answerer']}]: {q['answer'][:50]}")
```

> **坑：** ① 第二步参数放 **query string**（不是 body），否则 400。② `orgId` 取自第一步的 `secid`（即便前缀是 `gshk`，靠 `stockcode` 过滤照样拿 A 股问答）。③ 最新提问常未回复（`answer=None`），回复率因公司而异（实测立讯精密 002475 回复多、京东方 000725 几乎不回）。④ 时间是毫秒时间戳。

### 10.2 同花顺热榜 + 东财人气榜（市场热度 + 概念命中）

```python
EM_HOT_BODY = {"appId": "appId01", "globalId": "786e4c21-70dc-435a-93bb-38"}

def ths_hot_list(period: str = "hour") -> list[dict]:
    """同花顺热榜（单接口拿名称+人气+概念标签+排名变化）。period: hour/day。
    返回每只: rank/code/name/heat(人气值)/pct/rank_chg(排名变化)/concepts(概念标签)/tag。"""
    try:
        r = requests.get("https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock",
            params={"stock_type": "a", "type": period, "list_type": "normal"},
            headers={"User-Agent": UA}, timeout=10)
        lst = (r.json().get("data") or {}).get("stock_list") or []
    except Exception as e:
        print(f"[WARN] 同花顺热榜失败: {e}")
        return []
    out = []
    for it in lst:
        tag = it.get("tag") or {}
        out.append({"rank": it.get("order"), "code": it.get("code"), "name": it.get("name"),
            "heat": it.get("rate"), "pct": it.get("rise_and_fall"), "rank_chg": it.get("hot_rank_chg"),
            "concepts": tag.get("concept_tag") or [], "tag": tag.get("popularity_tag", "")})
    return out

def em_hot_rank(top: int = 50) -> list[dict]:
    """东财人气榜（排名 + 排名变化 + 名称/价格）。返回 rank/code/name/price/pct/rank_chg。"""
    try:
        r = requests.post("https://emappdata.eastmoney.com/stockrank/getAllCurrentList",
            json={**EM_HOT_BODY, "marketType": "", "pageNo": 1, "pageSize": top},
            headers={"User-Agent": UA}, timeout=10)
        data = r.json().get("data") or []
        if not data:
            return []
        # 人气榜只给带前缀代码，用 push2 ulist.np 批量补名称/价格
        secids = [("0." if it["sc"].startswith("SZ") else "1.") + it["sc"][2:] for it in data]
        u = requests.get("https://push2.eastmoney.com/api/qt/ulist.np/get",
            params={"ut": "f057cbcbce2a86e2866ab8877db1d059", "fltt": 2, "invt": 2,
                    "fields": "f14,f3,f12,f2", "secids": ",".join(secids)},
            headers={"User-Agent": UA, "Referer": "https://quote.eastmoney.com/"}, timeout=10)
        diff = (u.json().get("data") or {}).get("diff") or []
        if isinstance(diff, dict):                       # push2 的 diff 有时是 dict
            diff = list(diff.values())
        nm = {x["f12"]: (x.get("f14"), x.get("f2"), x.get("f3")) for x in diff}
    except Exception as e:
        print(f"[WARN] 东财人气榜失败: {e}")
        return []
    out = []
    for it in data:
        code = it["sc"][2:]
        name, price, pct = nm.get(code, ("", None, None))
        out.append({"rank": it["rk"], "code": code, "name": name,
            "price": price, "pct": pct, "rank_chg": it.get("hisRc")})
    return out

def em_hot_concept(code: str) -> list[dict]:
    """东财个股热门概念命中（这只票当下被市场归到哪些概念在炒）。
    返回 [{concept, bk, hit(命中热度)}, ...]，按热度降序。"""
    try:
        prefix = "SH" if code.startswith("6") else "SZ"
        r = requests.post("https://emappdata.eastmoney.com/stockrank/getHotStockRankList",
            json={**EM_HOT_BODY, "srcSecurityCode": prefix + code},
            headers={"User-Agent": UA}, timeout=10)
        data = r.json().get("data") or []
    except Exception as e:
        print(f"[WARN] 东财个股概念失败: {e}")
        return []
    return [{"concept": x.get("conceptName"), "bk": x.get("conceptId"),
             "hit": x.get("hitCount")} for x in data]

# 用法
for s in ths_hot_list()[:5]:
    print(f"  #{s['rank']} {s['name']} 热度{s['heat']} {s['concepts']} {s['tag']}")
hot = em_hot_rank(10)        # 东财人气榜 TOP10
print("人气第一:", hot[0]["name"], "概念命中:", em_hot_concept(hot[0]["code"])[:3])
```

> **坑：** ① 东财人气榜 `getAllCurrentList` 只返回带前缀代码（SZ/SH），名称要再走 `ulist.np` 补（`SZ`→`0.`、`SH`→`1.`）。② `ulist.np` 的 `diff` 偶尔是 dict（按序号为键），已做 `list(values())` 归一化。③ 同花顺热榜 `type` 可选 `hour`/`day`。

---
