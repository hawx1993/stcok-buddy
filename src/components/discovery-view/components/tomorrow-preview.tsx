interface ITomorrowProps {
  items?: Array<{ category: string; condition: string; baseline?: number | null }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  leader: '🐉 龙头追踪',
  theme: '🌐 热点接力',
  liquidity: '💰 流动性观察',
  sentiment: '📈 情绪观察',
  risk: '⚠️ 风险监控',
  northbound: '🧭 北向资金',
};

export function TomorrowPreview({ items }: ITomorrowProps) {
  if (!items?.length) return <div className="empty-block">收盘后将生成明日预判</div>;

  return (
    <div className="tm-grid">
      {items.map((item) => (
        <div className="tm-card" key={item.category}>
          <div className="tm-main">
            <div className="tm-title">{CATEGORY_LABELS[item.category] ?? item.category}</div>
            <div className="tm-logic">{item.condition}</div>
          </div>
          {item.baseline !== null && item.baseline !== undefined ? (
            <span className="tm-conf">{item.baseline}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
