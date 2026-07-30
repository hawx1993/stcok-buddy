import { AlertTriangle, Compass, Landmark, ShieldAlert, TrendingUp, Waves } from 'lucide-react';

interface ITomorrowProps {
  items?: Array<{ category: string; condition: string; baseline?: number | null }>;
}

const CATEGORY_LABELS: Record<string, { label: string; Icon: typeof Landmark }> = {
  leader: { label: '龙头追踪', Icon: Landmark },
  theme: { label: '热点接力', Icon: Waves },
  liquidity: { label: '流动性观察', Icon: TrendingUp },
  sentiment: { label: '情绪观察', Icon: TrendingUp },
  risk: { label: '风险监控', Icon: AlertTriangle },
  northbound: { label: '北向资金', Icon: Compass },
};

export function TomorrowPreview({ items }: ITomorrowProps) {
  if (!items?.length) return <div className='empty-block'>收盘后将生成明日预判</div>;

  return (
    <div className='tm-grid'>
      {items.map((item) => {
        const category = CATEGORY_LABELS[item.category];
        const Icon = category?.Icon ?? ShieldAlert;
        return (
          <div className='tm-card' key={item.category}>
            <div className='tm-main'>
              <div className='tm-title'>
                <Icon size={13} />
                {category?.label ?? item.category}
              </div>
              <div className='tm-logic'>{item.condition}</div>
            </div>
            {item.baseline !== null && item.baseline !== undefined ? (
              <span className='tm-conf'>{item.baseline?.toFixed(2)}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
