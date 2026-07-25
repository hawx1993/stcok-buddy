# A 股筹码分布图（成本分布图）计算公式详解

> **数据来源**：基于 a-stock-data 工具包（mootdx + 腾讯财经 + 东财 push2/datacenter）
>
> **适用场景**：个股筹码分析、主力建仓/出货判断、支撑位/压力位识别、成本集中度筛选

---

## 一、什么是筹码分布图

筹码分布图（Chip Distribution / Cost Distribution）由台湾指南针公司发明，现为东方财富、通达信、同花顺等主流软件的标配分析工具。它的核心思想是：

> **跟踪每只流通股在每一个价位上的持仓数量，回答"持股人当前的成本价分布在什么位置"。**

它不是线形图（如 K 线、均线），而是一个沿着价格轴的水平直方图——**横轴是持仓量，纵轴是价格**。筹码峰（密集区）代表大量成交过的价位，是天然的支撑/压力位。

```
价格 ↑
     │                            ████
     │                       ████████████
     │                  ████████████████████     ← 筹码峰（密集成交区 = 强力支撑）
     │           ████████████████████████████
     │      ██████████████████████████████████
     │  ████████████████████████████████████████
     │  ██████████████████████████████████████████  ← 当前价（获利盘/套牢盘分界线）
     │     ██████████████████████████████████
     │        ████████████████████████████
     │           ████████████████████████
     │              ████████████████████
     └────────────────────────────────────────────→ 持仓量
```

---

## 二、输入数据（a-stock-data 数据源全映射）

| 数据                               | a-stock-data 函数                                                                        | 返回字段                                 |
| ---------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- |
| **日 K 线**（开/高/低/收/成交量）  | `client.bars(symbol, frequency=9, offset=N)`                                             | `open, close, high, low, vol`            |
| **换手率**（每交易日）             | `tencent_quote([code])[code]["turnover_pct"]`                                            | 当日换手率 `%`                           |
| **流通股本**                       | `client.finance(symbol)["liutongguben"]` 或 `eastmoney_stock_info(code)["float_shares"]` | 流通股数（股）                           |
| **当日成交额**                     | `client.bars(...)["amount"]`                                                             | 成交额（元）                             |
| **当前股价**                       | `tencent_quote([code])[code]["price"]`                                                   | 实时最新价                               |
| **逐笔成交**（精确模式）           | `client.transaction(symbol, date)`                                                       | 每笔 `time, price, vol, buyorsell`       |
| **分红送转历史**（复权校验）       | `dividend_history(code)`                                                                 | `bonus_rmb, transfer_ratio, bonus_ratio` |
| **股东户数**（辅助判断筹码集中度） | `holder_num_change(code)`                                                                | `holder_num, change_ratio`               |

### 必备条件

```bash
pip install mootdx requests pandas
```

```python
from mootdx.quotes import Quotes
client = Quotes.factory(market='std')   # 通达信 TCP 连接，不封 IP
```

---

## 三、核心算法：四步推导

### Step 1 ── 单日成交量在价格轴上的三角分布模型

对某一个交易日，已知：开盘价 $O$、收盘价 $C$、最高价 $H$、最低价 $L$、成交量 $V$。

成交密集区在 $\left[\min(O,C), \max(O,C)\right]$ 区间内。价格偏离这个区间的成交概率线性递减直到 $H$ 或 $L$。

#### ① 阳线（$C \ge O$，收盘高于开盘）

```
权重 w(p)
  1 ──────┬────────────────────
          │                    ↘
          │                     ↘
          │                      ↘
  0 ──────┴──┬─────┬─────┬────┬──→ 价格 p
            L     O    C    H
```

对于价位 $p \in [L, H]$，权重函数为：

$$
w(p) =
\begin{cases}
\dfrac{p - L}{O - L} & (L \le p \le O) \\[8pt]
1 & (O < p \le C) \\[8pt]
\dfrac{H - p}{H - C} & (C < p \le H)
\end{cases}
$$

#### ② 阴线（$C < O$，收盘低于开盘）

```
权重 w(p)
  1 ──────┬────────────────────
          │                    ↘
          │                     ↘
          │                      ↘
  0 ──────┴──┬─────┬─────┬────┬──→ 价格 p
            L     C    O    H
```

$$
w(p) =
\begin{cases}
\dfrac{p - L}{C - L} & (L \le p \le C) \\[8pt]
1 & (C < p \le O) \\[8pt]
\dfrac{H - p}{H - O} & (O < p \le H)
\end{cases}
$$

#### ③ 特殊情况处理

| 场景                      | 处理                                    |
| ------------------------- | --------------------------------------- |
| $O = H = C = L$（一字板） | 全部成交量分配到该单一价位 $w(p_0) = V$ |
| $O = L$（最低价开）       | $\frac{p-L}{O-L}$ 分支退化为 $w=1$      |
| $C = H$（最高价收）       | $\frac{H-p}{H-C}$ 分支退化为 $w=1$      |

#### ④ 归一化到成交量

设价格步长 $\Delta p = 0.01$ 元（即 1 分钱作为一个价位格点）：

$$
\alpha = \dfrac{V}{\sum_{p \in [L, H]} w(p) \cdot \Delta p}
$$

**当日价位 $p$ 的筹码量**：

$$
Q_t(p) = \alpha \cdot w(p) \cdot \Delta p
$$

> **检查**：$\sum_{p} Q_t(p) = V$（当日总成交量）

$$\\$$

---

### Step 2 ── 多日累积与换手衰减（最关键的一步）

> ❗ **不能简单地把所有历史日期的 $Q_t(p)$ 全部累加**。旧筹码会被后续交易不断"换手"出清。
>
> **核心原则**：一只流通股，累计换手率达到 100% 时，相当于全部筹码被换了一遍。

#### 100% 换手衰减法（Full Turnover Decay）

对日期 $t$ 的持仓，到今日 $T$ 的**存活比例**为：

$$
\text{survival}(t, T) = \max\!\left(0,\; 1 - \sum_{i=t+1}^{T} \tau_i \right)
$$

其中 $\tau_i$ 为第 $i$ 天的**换手率**（小数形式，如 2.3% → 0.023）。

#### 等价表述——滑动窗口

找到最早期限 $t_{\min}$，使得窗口内的累计换手率刚好覆盖全部流通股：

$$
t_{\min} = \max\left\{t \;\Big|\; \sum_{i=t}^{T} \tau_i \ge 1.0\right\}
$$

即：从今天往前推，直到累计换手率 $\ge$ 100%。窗口外的旧数据权重为 0。

#### 最终筹码分布函数

$$
\text{Chips}(p, T) = \sum_{t = t_{\min}}^{T} Q_t(p) \;.\; \text{survival}(t, T)
$$

#### 数值示例

假设今日（$T=5$），各日换手率和衰减因子：

|  日期 $t$  | 换手率 $\tau_t$ | 累计换手率（从 $t+1$ 到 $T$） | 存活比例  |
| :--------: | :-------------: | :---------------------------: | :-------: |
| 5（今天）  |      2.0%       |              0%               |   1.00    |
|     4      |      1.8%       |             2.0%              |   0.98    |
|     3      |      2.5%       |             3.8%              |   0.962   |
|     2      |      1.2%       |             6.3%              |   0.937   |
|     1      |      0.8%       |             7.5%              |   0.925   |
|     …      |        …        |               …               |     …     |
| $t_{\min}$ |        —        |          $\ge100\%$           | 0（淘汰） |

$$\\$$

---

### Step 3 ── 流通股本归一化

理论上所有价位的筹码之和应等于流通股本 $S_{\text{float}}$：

$$
\sum_{p_{\min}}^{p_{\max}} \text{Chips}(p, T) \xrightarrow{\text{应等于}} S_{\text{float}}
$$

实际因数据精度误差会有偏差，需要进行**等比例缩放**：

$$
\text{Chips}_{\text{norm}}(p, T) = \text{Chips}(p, T) \cdot \frac{S_{\text{float}}}{\displaystyle\sum_{p} \text{Chips}(p, T)}
$$

#### 在 a-stock-data 中获取流通股本

```python
# 方式一：mootdx 财务快照（推荐，不经 HTTP，不封 IP）
fin = client.finance(symbol='688017')
float_shares = fin['liutongguben']

# 方式二：东财 push2
from a_stock_data import eastmoney_stock_info
info = eastmoney_stock_info('688017')
float_shares = info['float_shares']   # 单位：股
```

$$\\$$

---

### Step 4 ── 衍生指标

#### ① 获利盘比例（ASR — Across the Spread Ratio）

当前价 $P_{\text{current}}$ 以下所有筹码的占比：

$$
\text{ASR} = \frac{\displaystyle\sum_{p \le P_{\text{current}}} \text{Chips}_{\text{norm}}(p, T)}{S_{\text{float}}} \times 100\%
$$

|           ASR 值           | 含义                                           |
| :------------------------: | ---------------------------------------------- |
|          $>80\%$           | 绝大多数人盈利，上方压力轻，但获利回吐压力积聚 |
|        $50\%-80\%$         | 正常博弈区间                                   |
|          $<20\%$           | 绝大多数人亏损（深套），下方有较强的惜售支撑   |
| ASR 在某个筹码峰处突然增大 | 该价位是强力支撑/压力位                        |

#### ② 平均持仓成本（市场平均成本）

$$
\text{AvgCost} = \frac{\displaystyle\sum_{p} p \cdot \text{Chips}_{\text{norm}}(p, T)}{\displaystyle\sum_{p} \text{Chips}_{\text{norm}}(p, T)}
$$

当股价 > AvgCost 时，整体获利；反之整体亏损。

#### ③ 90% 成本集中度

去掉上下各 5% 的极端筹码后，剩余 90% 筹码的价差比率：

$$
\text{COST}_{90\%} = \frac{P_{95\%} - P_{5\%}}{P_{50\%}} \times 100\%
$$

其中 $P_{5\%}, P_{50\%}, P_{95\%}$ 是筹码累积量达到 5%、50%（中位数成本）、95% 时的对应价格。

|      集中度值      | 含义                                   |
| :----------------: | -------------------------------------- |
|      $<10\%$       | 筹码高度集中——可能是主力高度控盘       |
|    $10\%-20\%$     | 相对集中                               |
|      $>30\%$       | 筹码分散——多空分歧大，或主力已派发完毕 |
| 集中度从小到大剧增 | 主力可能在出货                         |

#### ④ 70% 成本集中度

同上，去掉上下 15% 的极端筹码：

$$
\text{COST}_{70\%} = \frac{P_{85\%} - P_{15\%}}{P_{50\%}} \times 100\%
$$

> 东方财富/通达信中常见的是 COST90 和 COST70 两个集中度指标。

---

## 四、精确模式（逐笔成交模式）

如果数据源提供**逐笔成交数据**（`mootdx.transaction()`），可以绕过三角分布假设：

$$
Q_t(p) = \sum_{\text{trade } j \text{ on day } t \atop \text{price}_j = p} \text{vol}_j
$$

即直接统计该日每一笔成交在 $p$ 价位的成交量，然后同样叠加上文的 Step 2（换手衰减）+ Step 3（流通股本归一化）。

**优缺点对比**：

|           模式           | 精度 |       计算量        |     数据时效     |
| :----------------------: | :--: | :-----------------: | :--------------: |
| **三角分布模式**（默认） | 较高 | 低（单日 1 次循环） |    盘后即可算    |
| **逐笔成交模式**（精确） | 最高 | 高（每笔一条记录）  | 仅交易日盘中可用 |

---

## 五、Python 完整实现（基于 a-stock-data）

```python
import numpy as np
from mootdx.quotes import Quotes
from collections import defaultdict

# ─── 初始化通达信客户端 ────────────────────────────────────────
client = Quotes.factory(market='std')


def chip_distribution(code: str, lookback: int = 240) -> dict:
    """
    计算个股筹码分布

    参数
    ----------
    code : str        6位股票代码，如 '600519'
    lookback : int    K线最大回溯天数（实际窗口由换手率决定）

    返回
    -------
    {
        'price_grid': {float price: float shares},  # 各价位持仓量
        'avg_cost': float,                          # 平均持仓成本
        'asr': float,                               # 获利盘比例(%)
        'cost_90': float,                           # 90%成本集中度
        'cost_70': float,                           # 70%成本集中度
        'p5': float, 'p50': float, 'p95': float     # 分位数价位
    }
    """

    # ─── 1. 获取日 K 线 ──────────────────────────────────────
    bars_df = client.bars(symbol=code, frequency=9, offset=lookback)
    # bars_df 字段: open, close, high, low, vol, amount

    # ─── 2. 获取流通股本 ─────────────────────────────────────
    fin = client.finance(symbol=code)
    float_shares = fin['liutongguben']
    if isinstance(float_shares, (list, np.ndarray)):
        float_shares = float(float_shares[0])

    # ─── 3. 获取每交易日换手率（需要逐日数据） ───────────────
    # 注意：mootdx.bars 不直接返回换手率，需要从腾讯接口按日获取
    # 或用简单的 vol / float_shares 估算（近似）
    # 这里用 vol / float_shares 作为换手率估算值
    turnover_rates = []
    for _, bar in bars_df.iterrows():
        tr = bar['vol'] / float_shares if float_shares > 0 else 0
        turnover_rates.append(min(tr, 1.0))  # 上限截断

    # ─── 4. 确定衰减窗口 N（累计换手 ≥ 100%） ────────────────
    total_turnover = 0.0
    N = 0
    for i in range(len(turnover_rates) - 1, -1, -1):
        total_turnover += turnover_rates[i]
        N += 1
        if total_turnover >= 1.0:
            break
    # 如果累计换手不够 100%，就用全部数据

    # ─── 5. 三角分布建模 ─────────────────────────────────────
    price_grid = defaultdict(float)
    start_idx = len(bars_df) - N

    for i in range(start_idx, len(bars_df)):
        bar = bars_df.iloc[i]
        o, c, h, l, v = (
            float(bar['open']), float(bar['close']),
            float(bar['high']), float(bar['low']),
            float(bar['vol'])
        )
        if v <= 0:
            continue

        # 价位步长 0.01 元
        step = 0.01
        # 从最低价向下取整到分，到最高价向上取整到分
        p_min = np.floor(l * 100) / 100
        p_max = np.ceil(h * 100) / 100

        prices = np.arange(p_min, p_max + step / 2, step)

        # 计算权重
        if c >= o:  # 阳线
            cond_l_o = (l <= prices) & (prices <= o)
            cond_o_c = (o < prices) & (prices <= c)
            cond_c_h = (c < prices) & (prices <= h)

            w = np.zeros_like(prices)
            if o != l:
                w[cond_l_o] = (prices[cond_l_o] - l) / (o - l)
            else:
                w[cond_l_o] = 1.0
            w[cond_o_c] = 1.0
            if h != c:
                w[cond_c_h] = (h - prices[cond_c_h]) / (h - c)
            else:
                w[cond_c_h] = 1.0
        else:  # 阴线
            cond_l_c = (l <= prices) & (prices <= c)
            cond_c_o = (c < prices) & (prices <= o)
            cond_o_h = (o < prices) & (prices <= h)

            w = np.zeros_like(prices)
            if c != l:
                w[cond_l_c] = (prices[cond_l_c] - l) / (c - l)
            else:
                w[cond_l_c] = 1.0
            w[cond_c_o] = 1.0
            if h != o:
                w[cond_o_h] = (h - prices[cond_o_h]) / (h - o)
            else:
                w[cond_o_h] = 1.0

        w = np.clip(w, 0, 1)

        # 归一化到成交量
        total_w = np.sum(w) * step
        alpha = v / total_w if total_w > 0 else 0

        # 换手衰减因子
        future_turnover = sum(turnover_rates[i+1:len(bars_df)])
        survival = max(0.0, 1.0 - future_turnover)

        # 叠加到全局价格网格
        for j, p in enumerate(prices):
            p_rounded = round(p, 2)
            price_grid[p_rounded] += alpha * w[j] * step * survival

    # ─── 6. 归一化到流通股本 ─────────────────────────────────
    total_chips = sum(price_grid.values())
    if total_chips > 0 and float_shares > 0:
        scale = float_shares / total_chips
    else:
        scale = 1.0
    price_grid = {p: s * scale for p, s in price_grid.items()}

    # ─── 7. 计算衍生指标 ─────────────────────────────────────
    # 按价格排序
    sorted_prices = sorted(price_grid.keys())
    cum = 0.0
    total = sum(price_grid.values())

    # 累计分布
    p5, p50, p95 = 0.0, 0.0, 0.0
    weighted_sum = 0.0
    hit_5, hit_50, hit_95 = False, False, False

    for p in sorted_prices:
        s = price_grid[p]
        cum += s
        weighted_sum += p * s

        if not hit_5 and cum >= 0.05 * total:
            p5 = p
            hit_5 = True
        if not hit_50 and cum >= 0.50 * total:
            p50 = p
            hit_50 = True
        if not hit_95 and cum >= 0.95 * total:
            p95 = p
            hit_95 = True

    avg_cost = weighted_sum / total if total > 0 else 0.0

    # 获利盘比例
    cum_below_current = sum(
        s for p, s in price_grid.items()
        if p <= sorted_prices[-1]  # 最后一个是最高价，需传入当前价
    )
    # 实际使用时应传入实时价格

    cost_90 = (p95 - p5) / p50 * 100 if p50 > 0 else 0
    cost_70_interp_15 = p5  # 近似，精确需算 15%/85% 分位
    cost_70_interp_85 = p95

    return {
        'price_grid': dict(price_grid),
        'avg_cost': round(avg_cost, 2),
        'p5': round(p5, 2),
        'p50': round(p50, 2),
        'p95': round(p95, 2),
        'cost_90': round(cost_90, 2),
        'total_chips': total,
        'float_shares': float_shares,
    }


# ─── 用法示例 ──────────────────────────────────────────────────
if __name__ == '__main__':
    result = chip_distribution('600519', lookback=240)  # 贵州茅台

    print(f"平均持仓成本: {result['avg_cost']} 元")
    print(f"90%成本集中度: {result['cost_90']}%")
    print(f"5%/50%/95%分位价: {result['p5']}/{result['p50']}/{result['p95']}")
    print(f"总筹码量: {result['total_chips']:.0f} 股")
    print(f"流通股本: {result['float_shares']:.0f} 股")

    # 打印筹码峰（持仓量最大的 10 个价位）
    top_10 = sorted(result['price_grid'].items(),
                    key=lambda x: x[1], reverse=True)[:10]
    print("\n🔝 筹码峰 TOP 10:")
    for price, shares in top_10:
        pct = shares / result['float_shares'] * 100
        print(f"  {price:>8.2f} 元 → {shares:>10,.0f} 股 ({pct:>5.2f}%)")
```

---

## 六、衍生策略信号

基于筹码分布，可以派生出多种实战信号：

### 6.1 双峰锁定信号

当分布图上出现两个清晰的筹码峰（一个低位峰 + 一个高位峰），且中间地带筹码稀少时：

$$
\frac{\text{CHIPS}_{\text{peak\_low}}}{\text{CHIPS}_{\text{peak\_high}}} > 2.0
$$

**信号**：资金从低位移仓到高位 → 后市看涨；反之高位峰扩大低位峰缩小 → 主力出货。

### 6.2 筹码集中度突变

计算连续两期集中度的差值：

$$
\Delta\text{COST}_{90} = \text{COST}_{90}(T) - \text{COST}_{90}(T-20)
$$

| $\Delta\text{COST}_{90}$ |                  信号                   |
| :----------------------: | :-------------------------------------: |
|        $< -10\%$         | 集中度急剧收窄 → 主力吸筹完成，即将拉升 |
|        $> +15\%$         |   集中度急剧发散 → 主力正在派发，回避   |

### 6.3 成本偏离度

$$
\text{偏离度} = \frac{P_{\text{current}} - \text{AvgCost}}{\text{AvgCost}} \times 100\%
$$

|  偏离度   | 含义                                |
| :-------: | ----------------------------------- |
| $> +30\%$ | 严重高于市场成本 → 有回调压力       |
| $< -20\%$ | 严重低于市场成本 → 接近超跌反弹区域 |

### 6.4 用 a-stock-data 辅助判断

```python
# 交叉验证：股东户数减少 = 筹码集中
from a_stock_data import holder_num_change

holders = holder_num_change(code)
if holders:
    latest = holders[0]
    print(f"股东户数: {latest['holder_num']} 环比: {latest['change_ratio']}%")
    # 股东户数持续减少 + COST90 下降 = 强力吸筹信号
```

---

## 七、常见问题

### Q1：为什么不同软件的筹码分布图不一样？

| 差异来源          | 通达信                   | 东方财富                  | 同花顺              |
| ----------------- | ------------------------ | ------------------------- | ------------------- |
| 价格步长          | 0.01 元（默认）          | 0.01 元                   | 0.01 元             |
| 衰减模型          | 100%换手衰减             | 100%换手衰减+日内分时修正 | 换手衰减+部分自适应 |
| 历史窗口          | 动态（直到累计换手100%） | 最长2年                   | 最长1年             |
| 是否考虑送转/分红 | ✅前复权                 | ✅前复权                  | ✅前复权            |
| 逐笔成交模式      | ✅日线正常时启用         | ✅仅Level-2               | ✅仅Level-2         |

**根本差异在于**：有些软件用了**日线三角模型**（本文公式），有的用了**逐笔成交累加模型**（更精确但需Level-2数据），还有一些混合了**分时成交分布**来细化单日分配。

### Q2：为什么换手率不够 100%？

对于**上市不久的新股**或**长期缩量横盘的庄股**，累计换手率可能远低于 100%。此时：

- 不清除任何历史数据
- 所有持仓的存活衰减因子 $\text{survival} > 0$，全部纳入分布
- 结果可能偏向早期成本

### Q3：送转/分红怎么处理？

**必须在复权价格体系下计算**，否则除权除息日前后价格断层会导致分布失真。

```python
# 方式一：用前复权 K 线（腾讯财经返回的已经是复权价）
# 方式二：手动复权
for div in dividend_history(code):
    if div['transfer_ratio'] > 0 or div['bonus_ratio'] > 0:
        # 除权日之前的 K 线全部按比例调整
        pass  # 具体用前复权公式：adjusted = old / (1 + bonus/10 + transfer/10)
```

### Q4：空头排列、贴权走势时的分布有效吗？

**依然有效**。筹码分布不预测方向，它只回答"现有筹码在什么价位"。在持续阴跌中：

- 高位套牢盘筹码峰持续衰减（被换手）
- 低位筹码峰逐渐堆积
- 直到高位筹码峰消失 → 解套压力消除 → 新的上涨周期开启

---

## 八、参考资料

1. **指南针筹码理论** — 陈浩，《筹码分布》
2. **东方财富筹码分布** — `https://quote.eastmoney.com/{code}.html` 页面 F11
3. **通达信成本分布算法** — `CCX` 公式引擎手册
4. **mootdx 文档** — `https://github.com/mootdx/mootdx`
5. **a-stock-data** — `https://github.com/simonlin1212/a-stock-data`

---

> **总结公式**
>
> $$
> \boxed{\text{Chips}(p,T) = S_{\text{float}} \cdot \frac{\displaystyle\sum_{t=t_{\min}}^{T} \alpha_t \cdot w_t(p) \cdot \max\!\left(0,\;1-\sum_{i=t+1}^{T}\tau_i\right)}{\displaystyle\sum_{p}\sum_{t=t_{\min}}^{T} \alpha_t \cdot w_t(p) \cdot \max\!\left(0,\;1-\sum_{i=t+1}^{T}\tau_i\right)}}
> $$
>
> 其中 $w_t(p)$ 为三角权重，$\alpha_t$ 为成交量归一化系数，$\tau_i$ 为换手率，$S_{\text{float}}$ 为流通股本。
