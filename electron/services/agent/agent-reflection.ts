import type {
  EvidenceItem,
  IAgentDataGap,
  IAgentDataStatus,
  IAgentPlan,
  IAgentPlanRevision,
  IAgentReflectionResult,
} from '../../../src/shared/types.js';
import { findPlanItemIdsByDataName, markPlanItemsByDataGap } from './agent-planning.js';
import type { IAgentContext } from './orchestrator-types.js';

const GAP_STATUSES = new Set<IAgentDataStatus['status']>(['empty', 'failed', 'partial', 'stale', 'skipped']);

export function createDataGapFromStatus(status: IAgentDataStatus, plan?: IAgentPlan): IAgentDataGap | undefined {
  if (!GAP_STATUSES.has(status.status) || status.status === 'available') return undefined;
  const gapStatus = status.status;
  return {
    id: `gap-${status.dataName}-${gapStatus}`,
    dataName: status.dataName,
    status: gapStatus,
    reason: status.reason,
    affectedPlanItemIds: status.relatedPlanItemIds.length
      ? status.relatedPlanItemIds
      : findPlanItemIdsByDataName(plan, status.dataName),
    impact: impactForDataName(status.dataName, status.status),
    userMessage: `${status.dataName}数据${statusText(status.status)}，${impactMessage(status.dataName)}。`,
  };
}

export function reflectOnPlanAfterData(context: IAgentContext, reason: string): IAgentReflectionResult {
  const gaps = collectDataGaps(context);
  const revisions = createRevisions(gaps, reason, context.plan?.revisions ?? []);
  updateContextPlan(context, gaps, revisions);
  return {
    passed: gaps.length === 0,
    issues: gaps.map((gap) => gap.userMessage),
    dataGaps: gaps,
    revisions,
  };
}

export function reflectBeforeFinalReport(context: IAgentContext, complianceIssues: string[]): IAgentReflectionResult {
  const gaps = collectDataGaps(context);
  const revisions = createRevisions(gaps, 'final-report', context.plan?.revisions ?? []);
  updateContextPlan(context, gaps, revisions);
  const issues = [...complianceIssues, ...inspectFinalEvidenceSupport(context, gaps)];
  const result: IAgentReflectionResult = {
    passed: issues.length === 0 && gaps.length === 0,
    issues,
    dataGaps: gaps,
    revisions,
  };
  context.finalReflection = result;
  return result;
}

export function formatDataGapsForPrompt(gaps: IAgentDataGap[] = []): string {
  if (!gaps.length) return '无明确数据缺口。';
  return gaps
    .map(
      (gap) =>
        `- ${gap.dataName}：${gap.userMessage} 影响范围：${gap.affectedPlanItemIds.join('、') || '未绑定计划项'}；影响等级：${gap.impact}`,
    )
    .join('\n');
}

export function formatPlanRevisionsForPrompt(revisions: IAgentPlanRevision[] = []): string {
  if (!revisions.length) return '暂无计划调整。';
  return revisions.map((revision) => `- ${revision.reason}：${revision.changes.join('；')}`).join('\n');
}

function collectDataGaps(context: IAgentContext): IAgentDataGap[] {
  const fromStatuses = (context.dataStatuses ?? [])
    .map((status) => createDataGapFromStatus(status, context.plan))
    .filter((gap): gap is IAgentDataGap => Boolean(gap));
  const fromEvidence = fallbackEvidenceGaps(context.evidence, context.plan);
  return dedupeGaps([...(context.plan?.dataGaps ?? []), ...fromStatuses, ...fromEvidence]);
}

function fallbackEvidenceGaps(evidence: EvidenceItem[], plan?: IAgentPlan): IAgentDataGap[] {
  return evidence
    .filter((item) => item.source === 'fallback')
    .map((item) => {
      const dataName = dataNameFromFallbackEvidence(item);
      return {
        id: `gap-${dataName}-fallback-evidence`,
        dataName,
        status: 'empty' as const,
        reason: item.summary ?? item.title,
        affectedPlanItemIds: findPlanItemIdsByDataName(plan, dataName),
        impact: impactForDataName(dataName, 'empty'),
        userMessage: `${dataName}数据未返回可用样本，相关结论已降低置信度。`,
      };
    });
}

function dataNameFromFallbackEvidence(item: EvidenceItem): string {
  const text = `${item.id} ${item.title} ${item.summary ?? ''}`;
  if (/行情|quote/.test(text)) return '行情';
  if (/K线|日线|kline|local-kline/.test(text)) return 'K线';
  if (/技术|指标|technical/.test(text)) return '技术指标';
  if (/新闻|news/.test(text)) return '新闻';
  if (/公告|announcement/.test(text)) return '公告';
  if (/资金流|fund-flow/.test(text)) return '资金流';
  if (/筹码|chip/.test(text)) return '筹码集中度';
  if (/龙虎榜|lhb/.test(text)) return '龙虎榜';
  if (/热点|hot/.test(text)) return '热点/特大单';
  if (/行业|板块|board|industry/.test(text)) return '板块排行';
  return item.title;
}

function inspectFinalEvidenceSupport(context: IAgentContext, gaps: IAgentDataGap[]): string[] {
  const issues: string[] = [];
  const evidenceIds = new Set(context.evidence.map((item) => item.id));
  for (const finding of context.findings) {
    if (!finding.evidenceIds.length || finding.evidenceIds.some((id) => !evidenceIds.has(id))) {
      issues.push(`发现 ${finding.id} 缺少有效证据引用。`);
    }
    if (gapAffectsFinding(gaps, finding.dimension) && finding.confidence > 0.4 && finding.stance !== 'unknown') {
      issues.push(`发现 ${finding.id} 引用了缺失维度但置信度偏高，已要求降低结论强度。`);
    }
  }
  const text = `${context.analysisOverview ?? ''} ${context.findings.map((finding) => finding.summary).join(' ')}`;
  if (/必须买入|立即加仓|立即买入|立即卖出|清仓|必涨|稳赚/.test(text)) issues.push('最终文案存在确定性买卖建议，需要替换为观察框架。');
  if (/[🚀🔥💎🌙🤑🎉]/u.test(text)) issues.push('最终文案存在禁用娱乐化 Emoji，需要替换为专业表述。');
  return issues;
}

function gapAffectsFinding(gaps: IAgentDataGap[], dimension: string): boolean {
  const namesByDimension: Record<string, string[]> = {
    technical: ['K线', '技术指标'],
    fundamental: ['行情'],
    capital: ['资金流', '热点/特大单'],
    sentiment: ['新闻', '公告'],
    chip: ['筹码集中度'],
  };
  const names = namesByDimension[dimension] ?? [];
  return gaps.some((gap) => names.some((name) => gap.dataName.includes(name) || name.includes(gap.dataName)));
}

function createRevisions(
  gaps: IAgentDataGap[],
  reason: string,
  existing: IAgentPlanRevision[],
): IAgentPlanRevision[] {
  if (!gaps.length) return existing;
  const key = `revision-${reason}-${gaps.map((gap) => `${gap.dataName}:${gap.status}`).join('-')}`;
  if (existing.some((revision) => revision.id === key)) return existing;
  const critical = gaps.filter((gap) => gap.impact !== 'low');
  return [
    ...existing,
    {
      id: key,
      reason: reason === 'final-report' ? '最终报告前数据缺口复核' : '数据采集后计划反思',
      changes: [
        `${(critical.length ? critical : gaps).map((gap) => `${gap.dataName}${statusText(gap.status)}`).join('、')}，相关维度降低置信度。`,
        '最终报告需列明数据缺口与影响，不使用缺失数据输出确定性判断。',
      ],
      createdAt: new Date().toISOString(),
    },
  ];
}

function updateContextPlan(context: IAgentContext, gaps: IAgentDataGap[], revisions: IAgentPlanRevision[]) {
  if (!context.plan) return;
  context.plan = markPlanItemsByDataGap({ ...context.plan, dataGaps: gaps, revisions }, gaps);
}

function dedupeGaps(gaps: IAgentDataGap[]): IAgentDataGap[] {
  const seen = new Set<string>();
  const result: IAgentDataGap[] = [];
  for (const gap of gaps) {
    const key = `${gap.dataName}:${gap.status}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(gap);
  }
  return result;
}

function impactForDataName(dataName: string, status: IAgentDataStatus['status']): IAgentDataGap['impact'] {
  if (status === 'partial' || status === 'stale') return 'medium';
  if (/行情|K线|技术指标|资金流|市场复盘/.test(dataName)) return 'high';
  if (/新闻|公告|筹码|热点|龙虎榜|板块/.test(dataName)) return 'medium';
  return 'low';
}

function statusText(status: IAgentDataGap['status'] | IAgentDataStatus['status']): string {
  if (status === 'failed') return '获取失败';
  if (status === 'empty') return '为空';
  if (status === 'partial') return '不完整';
  if (status === 'stale') return '可能过期';
  if (status === 'skipped') return '已跳过';
  return '可用';
}

function impactMessage(dataName: string): string {
  if (/行情/.test(dataName)) return '行情基础判断不可直接下结论';
  if (/K线|技术指标/.test(dataName)) return '技术形态和关键价位判断需降级';
  if (/资金流/.test(dataName)) return '资金方向和主力行为不可做确定性判断';
  if (/新闻|公告/.test(dataName)) return '事件风险不能视为已排除';
  if (/筹码/.test(dataName)) return '筹码结构和控盘判断不可做确定性结论';
  return '相关分析维度需降低置信度';
}
