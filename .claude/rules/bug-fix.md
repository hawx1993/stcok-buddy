# Bug Fix Rules

## 修复原则

修复 Bug 时必须优先定位根因（Root Cause）。

禁止：

- 绕过问题
- 隐藏错误
- 删除业务逻辑
- 注释掉功能
- 用 mock 数据代替真实数据
- 用 fallback 数据掩盖问题

必须：

- 找到根因
- 修复根因
- 保持原有功能完整

---

## 禁止的修复方式

禁止：

```ts
catch {
  return []
}
```

```ts
catch {
  return null
}
```

```ts
catch {
  return {}
}
```

```ts
// @ts-ignore
```

```ts
// eslint-disable
```

```ts
const data = apiData ?? fakeData
```

```ts
if (!data) {
  return mockData
}
```

```ts
if (error) {
  return []
}
```

错误必须暴露并处理。

不得通过伪造数据解决问题。

---

## 行情系统特殊规则

股票数据异常时：

允许：

- Loading
- Empty State
- Error State

禁止：

- fakeQuote
- fakeNews
- fakeBoard
- fakeSector
- fakeKline
- previewData

不得生成虚假行情。

---

## TypeScript 规则

禁止：

- any
- unknown as XXX
- as any

除非已有代码大量使用且无法避免。

优先：

- 修正类型
- 补充接口定义
- 补充泛型

---

## React 规则

修 Bug 时：

不得：

- 删除 Hook
- 删除依赖项
- 删除 Effect

例如禁止：

```ts
useEffect(() => {
  load()
}, [])
```

仅为了消除依赖警告而删除依赖。

必须分析：

- 闭包问题
- 依赖问题
- 状态同步问题

---



## SQLite 规则

禁止：

收到每条行情立即写库

例如：

```ts
ws.onmessage = msg => {
  db.insert(msg)
}
```

优先检查：

- Memory Cache
- Batch Flush
- Transaction

---

## 修复前检查

修改代码前必须回答：

1. Bug 的根因是什么？
2. 为什么会发生？
3. 为什么当前实现失效？
4. 修复是否影响其他功能？
5. 是否引入新的性能问题？
6. 是否改动了需求之外的地方？
7. 是否引入了新的问题

---

## 提交要求

完成修复后必须说明：

### Root Cause

根因分析

### Fix

修复方案

### Impact

影响范围

### Risk

潜在风险

### Verification

验证方式