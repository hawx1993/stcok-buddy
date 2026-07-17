
## 数据访问规则

所有股票数据必须通过统一 Provider 层访问。

禁止：

- React 组件直接请求第三方接口

- 页面直接 fetch 东方财富

- 页面直接 fetch 腾讯行情

- 页面直接 fetch Tushare

必须：

```mermaid
UI

 ↓

Service

 ↓

Provider

 ↓

Data Source
```
例如：
```md
marketService.getQuotes()
```
而不是：
```md
fetch('https://api.eastmoney.com/api/v1/quotes/list')
```

## 数据存储规则

实时行情：

Memory Cache
↓
批量写入 SQLite

禁止：

收到一条行情立即写库

推荐：

15~30秒批量写入 SQLite

行情展示：

Memory 优先
SQLite 次之
远程接口最后
禁止直接：
```ts
ws.onmessage = () => {
  db.insert(...)
}
```


## 禁止 Mock 规则

禁止以下行为：

- fallbackQuote
- fallbackMarket
- mockQuote
- previewData
- demoData
- sampleData
- fakeKline
- generatedChartData

如果真实数据不可用：

返回错误状态；
返回空状态；
展示加载状态；

不得自动生成替代数据。