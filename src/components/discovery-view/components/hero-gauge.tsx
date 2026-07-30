import { BarChart3 } from 'lucide-react';

interface IHeroGaugeProps {
  score?: number;
  scoreLabel?: string;
  scoreVerdict?: string;
  scoreTrend?: number[];
}

function sparklinePath(points: number[], width: number, height: number, min: number, max: number) {
  if (points.length < 2) return '';
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  let d = `M 0 ${height - ((points[0] - min) / range) * height}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${i * stepX} ${height - ((points[i] - min) / range) * height}`;
  }
  return d;
}

function renderHighlightedVerdict(text: string) {
  // Highlight numeric values with units (e.g. 8.6%, 6 板, 70 家) in the verdict.
  const parts = text.split(/(\d+(?:\.\d+)?\s*(?:%|板|亿|万|家|点|倍|只|支))/g);
  return parts.map((part, index) => {
    if (/^\d+(?:\.\d+)?\s*(?:%|板|亿|万|家|点|倍|只|支)$/.test(part)) {
      return (
        <span key={index} className="hero-highlight">
          {part}
        </span>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

export function HeroGauge({ score, scoreLabel, scoreVerdict, scoreTrend }: IHeroGaugeProps) {
  if (score === undefined || score === null) {
    return (
      <div className="hero-gauge-wrap" style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)' }}>
        <BarChart3 size={32} />
        <p style={{ marginTop: 12, fontSize: 13 }}>暂无机会评分</p>
      </div>
    );
  }

  const arcRadius = 90;
  const arcCircumference = Math.PI * arcRadius; // half circle perimeter
  const arcOffset = arcCircumference * (1 - score / 100);

  const hasTrend = Array.isArray(scoreTrend) && scoreTrend.length >= 2;
  const trendMin = hasTrend ? Math.min(...scoreTrend) - 2 : score - 2;
  const trendMax = hasTrend ? Math.max(...scoreTrend) + 2 : score + 2;
  const trendPath = hasTrend ? sparklinePath(scoreTrend, 120, 32, trendMin, trendMax) : '';
  const previousScore = hasTrend ? scoreTrend[scoreTrend.length - 2] : score;
  const scoreChange = score - previousScore;
  const trendRange = trendMax - trendMin || 1;
  const lastCy = 32 - ((score - trendMin) / trendRange) * 32;

  return (
    <div className="hero-gauge-wrap">
      <div className="hero-gauge">
        <svg width="200" height="120" viewBox="0 0 200 120">
          <path
            d="M10,100 A90,90 0 0 1 190,100"
            fill="none"
            stroke="var(--surface-hover)"
            strokeWidth="12"
            strokeLinecap="round"
          />
          <defs>
            <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#2FBF71" />
              <stop offset="55%" stopColor="#E8B84B" />
              <stop offset="100%" stopColor="#F5484B" />
            </linearGradient>
          </defs>
          <path
            d="M10,100 A90,90 0 0 1 190,100"
            fill="none"
            stroke="url(#gaugeGrad)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={arcCircumference}
            strokeDashoffset={arcOffset}
            style={{ transition: 'stroke-dashoffset 1s cubic-bezier(.2,.9,.25,1)' }}
          />
        </svg>
        <div className="hero-gauge-num">{score}</div>
        <div className="hero-gauge-sub">今日机会分 · 满分100</div>
        <div className="hero-gauge-label">{scoreLabel}</div>
      </div>
      <div className="hero-body">
        <div className="hero-eyebrow">AI 一句话研判</div>
        <div className="hero-text">{scoreVerdict ? renderHighlightedVerdict(scoreVerdict) : scoreLabel}</div>
        {hasTrend && (
          <div className="hero-trend">
            <div className="hero-trend-head">
              <span className="hero-trend-label">近7日机会分走势</span>
              <span className={scoreChange >= 0 ? 'hero-trend-change up' : 'hero-trend-change down'}>
                {scoreChange >= 0 ? '↑' : '↓'} 较昨日 {scoreChange >= 0 ? '+' : ''}
                {scoreChange}
              </span>
            </div>
            <svg className="hero-sparkline" width="120" height="32" viewBox="0 0 120 32">
              <path d={trendPath} fill="none" stroke="#E8B84B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="120" cy={lastCy} r="3" fill="#E8B84B" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}
