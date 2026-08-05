import type {
  AgentRunEvent,
  AgentStep,
  ChatRequest,
  ChatResponse,
  IAgentPlanItem,
  IAgentReflectionResult,
  TPlanItemStatus,
} from '../../../src/shared/types.js';
import { isUnsupportedStockMarketQuery } from '../stock/stock-client.js';
import { runStoreCommand } from '../store-service.js';
import { callTool } from '../tools/tool-registry.js';
import { reviewComplianceStructured } from './compliance-critic.js';
import { executeDag } from './dag-executor.js';
import { enrichTechnicalCard, dataGaps, dedupeEvidence } from './agent-tool-runtime.js';
import { reflectBeforeFinalReport } from './agent-reflection.js';
import { quoteToCard } from './agent-result-cards.js';
import {
  applyStockAgentRouting,
  classifyIntent,
  extractBoardKeyword,
  extractUrls,
  intentLabel,
  isPossibleStockOnlyQuery,
  needsSymbol,
  parseSlashCommand,
} from './intent-routing.js';
import type { IAgentContext, TOnToken } from './orchestrator-types.js';
import { buildAgentWorkflow } from './agent-workflows.js';
import {
  attachPlanNodeCoverage,
  createInitialAgentPlan,
  createPlanAgentsFromNodes,
  formatPlanMessage,
  formatPlanUpdatedMessage,
} from './agent-planning.js';

export async function runOrchestrator(
  request: ChatRequest,
  onToken?: TOnToken,
  onEvent?: (event: AgentRunEvent) => void,
): Promise<ChatResponse> {
  const storeResponse = await runStoreCommand(request.message);
  if (storeResponse) {
    for (const event of storeResponse.events) onEvent?.(event);
    return { ...storeResponse, message: { ...storeResponse.message, runEvents: storeResponse.events } };
  }

  const events: AgentRunEvent[] = [];
  const emitEvent = (event: AgentRunEvent) => {
    events.push(event);
    onEvent?.(event);
  };
  const command = parseSlashCommand(request.message);
  const symbolText = command?.args ?? request.message;
  if (symbolText && (await isUnsupportedStockMarketQuery(symbolText))) return unsupportedMarketResponse();

  let intent = applyStockAgentRouting(
    command?.intent ?? classifyIntent(request.message),
    request.message,
    Boolean(command),
  );
  const resolvedSymbol =
    needsSymbol(intent) && symbolText ? await callTool('resolveStockSymbol', { query: symbolText }) : undefined;
  let symbol = readSymbol(resolvedSymbol?.output);
  let stockName = readStockName(resolvedSymbol?.output);
  if (!command && intent === 'chat' && isPossibleStockOnlyQuery(symbolText)) {
    const record = await callTool('resolveStockSymbol', { query: symbolText });
    const candidate = readSymbol(record.output);
    if (/^\d{6}$/.test(candidate ?? '')) {
      intent = 'analysis';
      symbol = candidate;
      stockName = readStockName(record.output);
    }
  }

  const context: IAgentContext = {
    query: request.message,
    intent,
    urls: extractUrls(request.message),
    symbol,
    boardKeyword: intent === 'board' ? extractBoardKeyword(request.message) : undefined,
    singleAgent: command?.singleAgent,
    evidence: [],
    toolCalls: [],
    findings: [],
    emitEvent,
  };
  if (command && !command.args && !command.allowEmptyArgs) return commandUsageResponse(command.usage);

  emitIntentEvent({ command, context, stockName, emitEvent });
  context.plan = createInitialAgentPlan(context);
  const nodes = buildAgentWorkflow(context, onToken);
  context.plan = attachPlanNodeCoverage(context.plan, nodes);
  const nodeStatusMap = new Map<string, AgentStep['status']>();
  const hasReportStep = context.intent !== 'quote' && context.intent !== 'chat';
  const hasDagReportStep = nodes.some((node) => node.id === 'analysis-report');
  emitPlanEvent(context, nodes, emitEvent);

  let completedSteps = 0;
  const totalWithReport = nodes.length + (hasReportStep && !hasDagReportStep ? 1 : 0);
  await executeDag(
    nodes,
    context,
    (step) => {
      nodeStatusMap.set(step.id, step.status);
      updatePlanForStep(context, nodes, nodeStatusMap, emitEvent);
      if (step.status === 'completed' || step.status === 'error') completedSteps += 1;
      const elapsedText = step.elapsed ? ` · ${step.elapsed.toFixed(1)}s` : '';
      if (step.status !== 'running') {
        console.log(`[agent-timing] ${step.agent} (${step.id}) ${step.status} in ${step.elapsed ?? 0}s`);
      }
      emitEvent({
        type: step.status === 'running' ? 'subagent_started' : 'subagent_completed',
        title: step.status === 'running' ? '子 Agent 启动' : '子 Agent 结果',
        message: step.description + elapsedText,
        step,
        subAgent: {
          name: step.agent,
          description: step.description,
          status: step.status,
          summary: step.detail,
          elapsed: step.elapsed,
        },
        progress: { current: completedSteps, total: totalWithReport },
      });
    },
    { concurrency: 5 },
  );

  if (hasReportStep && !hasDagReportStep) emitReportStep('running', completedSteps, totalWithReport, emitEvent);
  const draft =
    context.singleAgent && context.analysisResults?.[0]
      ? context.analysisResults[0].content
      : context.marketReview
        ? (context.analysisOverview ?? '')
        : (context.themeAttribution ?? context.analysisOverview ?? context.board?.narrative ?? '');
  const review = reviewComplianceStructured({
    text: draft,
    evidence: context.evidence,
    findings: context.findings,
    dataGaps: context.plan?.dataGaps ?? context.finalReflection?.dataGaps ?? [],
  });
  context.compliance = review;
  applyFinalReflection(context, nodes, reflectBeforeFinalReport(context, review.issues.map((issue) => issue.message)), emitEvent);
  const content = review.revisedText;
  await streamContent(content, hasReportStep, onToken);
  const result = context.board ?? enrichTechnicalCard(context.technical, context.quote) ?? quoteToCard(context.quote);

  if (hasReportStep && !hasDagReportStep) {
    completedSteps += 1;
    emitReportStep('completed', completedSteps, totalWithReport, emitEvent);
  }
  const finalGapNames = (context.finalReflection?.dataGaps ?? context.plan?.dataGaps ?? []).map((gap) => gap.dataName);
  emitEvent({
    type: 'summary_completed',
    title: '汇总完成',
    message: `工具调用：${context.toolCalls.length} 次\n子 Agent：${(context.analysisResults?.length ?? 0) || nodes.length} 个\n有效证据：${dedupeEvidence(context.evidence).length} 条\n数据缺口：${finalGapNames.join('、') || dataGaps(context).join('、') || '无明确缺口'}`,
    evidence: dedupeEvidence(context.evidence),
  });
  emitEvent({
    type: 'final_answer',
    title: '最终结论',
    message: content,
    result,
    marketReview: context.marketReview,
    stock: context.quote,
    evidence: context.evidence,
    findings: context.findings,
  });
  return {
    events,
    message: {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content,
      createdAt: new Date().toISOString(),
      runEvents: events,
      steps: events.map((event) => event.step).filter((step): step is NonNullable<typeof step> => Boolean(step)),
      result,
      marketReview: context.marketReview,
      evidence: context.evidence,
      findings: context.findings,
      toolCalls: context.toolCalls,
      compliance: context.compliance,
    },
  };
}

function emitIntentEvent({
  command,
  context,
  stockName,
  emitEvent,
}: {
  command: ReturnType<typeof parseSlashCommand>;
  context: IAgentContext;
  stockName?: string;
  emitEvent: (event: AgentRunEvent) => void;
}) {
  emitEvent(
    command
      ? {
          type: 'command_detected',
          title: 'Command 识别',
          message: `${command.name}${command.args ? ` ${command.args}` : ''}`,
          command: {
            name: command.name,
            args: command.args,
            mode: command.singleAgent ? '单 Agent 分析' : '多 Agent 协同分析',
            label: stockName ? `${stockName}（${context.symbol}）` : undefined,
          },
        }
      : {
          type: 'intent_detected',
          title: '意图识别',
          message: `${intentLabel(context.intent)}${context.symbol ? `：${context.symbol}` : ''}`,
          intent: {
            name: intentLabel(context.intent),
            target: context.symbol ?? context.boardKeyword,
            mode: context.intent === 'analysis' ? '多 Agent 协同分析' : '单流程分析',
            label: stockName ? `${stockName}（${context.symbol}）` : undefined,
          },
        },
  );
}

function emitPlanEvent(
  context: IAgentContext,
  nodes: ReturnType<typeof buildAgentWorkflow>,
  emitEvent: (event: AgentRunEvent) => void,
) {
  emitEvent({
    type: 'plan_created',
    title: '分析计划',
    message: context.plan ? formatPlanMessage(context.plan) : '本轮将按当前意图检查可用真实数据，并标注数据缺口。',
    progress: { current: 0, total: nodes.length },
    plan: {
      agents: createPlanAgentsFromNodes(nodes),
      items: context.plan?.items,
      dataGaps: context.plan?.dataGaps,
      revisions: context.plan?.revisions,
      summary: context.plan?.summary,
    },
  });
}

function updatePlanForStep(
  context: IAgentContext,
  nodes: ReturnType<typeof buildAgentWorkflow>,
  nodeStatusMap: Map<string, AgentStep['status']>,
  emitEvent: (event: AgentRunEvent) => void,
) {
  if (!context.plan) return;
  const plan = context.plan;
  let hasChange = false;
  const items: IAgentPlanItem[] = plan.items.map((item) => {
    const statuses = item.relatedNodeIds
      .map((id) => nodeStatusMap.get(id))
      .filter((status): status is AgentStep['status'] => Boolean(status));
    if (!statuses.length) return item;
    if (item.status === 'skipped' || item.status === 'blocked' || item.status === 'failed') return item;
    const status: TPlanItemStatus = statuses.includes('error')
      ? 'failed'
      : statuses.includes('running')
        ? 'running'
        : item.relatedNodeIds.every((id) => nodeStatusMap.get(id) === 'completed')
          ? 'completed'
          : statuses.includes('completed')
            ? 'running'
            : item.status;
    if (item.status === status) return item;
    hasChange = true;
    return { ...item, status };
  });
  if (!hasChange) return;
  context.plan = { ...plan, items };
  emitEvent({
    type: 'plan_updated',
    title: '计划更新',
    message: formatPlanUpdatedMessage(context.plan),
    plan: {
      agents: createPlanAgentsFromNodes(nodes),
      items,
      dataGaps: context.plan.dataGaps,
      revisions: context.plan.revisions,
      summary: context.plan.summary,
    },
  });
}

function applyFinalReflection(
  context: IAgentContext,
  nodes: ReturnType<typeof buildAgentWorkflow>,
  reflection: IAgentReflectionResult,
  emitEvent: (event: AgentRunEvent) => void,
) {
  for (const gap of reflection.dataGaps) {
    emitEvent({
      type: 'data_gap_detected',
      title: '数据缺口',
      message: gap.userMessage,
      dataGap: gap,
    });
  }

  emitEvent({
    type: 'reflection_completed',
    title: '自检完成',
    message: reflection.passed
      ? '证据链、数据缺口与合规检查已通过。'
      : '已完成证据链、数据缺口与合规检查，相关缺口会在结论中降低置信度。',
    reflection,
    plan: {
      agents: createPlanAgentsFromNodes(nodes),
      items: context.plan?.items,
      dataGaps: context.plan?.dataGaps,
      revisions: context.plan?.revisions,
      summary: context.plan?.summary,
    },
  });
}

function emitReportStep(
  status: 'running' | 'completed',
  current: number,
  total: number,
  emitEvent: (event: AgentRunEvent) => void,
) {
  const step = { id: 'analysis-report', agent: '生成投研报告', description: '生成综合投研报告', status } as const;
  emitEvent({
    type: status === 'running' ? 'subagent_started' : 'subagent_completed',
    title: status === 'running' ? '子 Agent 启动' : '子 Agent 结果',
    message: '生成综合投研报告',
    step,
    subAgent: { name: step.agent, description: step.description, status },
    progress: { current, total },
  });
}

async function streamContent(content: string, hasReportStep: boolean, onToken?: TOnToken) {
  if (!onToken || !content || !hasReportStep) return;
  // 控制最终报告流式节奏约 20ms/4字符，避免 msg-text 打字效果过快
  for (const chunk of content.match(/[\s\S]{1,4}/g) ?? [content]) {
    onToken(chunk);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function readSymbol(output: unknown): string | undefined {
  if (typeof output === 'string') return output;
  return isResolvedSymbol(output) ? output.symbol : undefined;
}

function readStockName(output: unknown): string | undefined {
  return isResolvedSymbol(output) ? output.name : undefined;
}

function isResolvedSymbol(value: unknown): value is { symbol?: string; name?: string } {
  return typeof value === 'object' && value !== null;
}

function unsupportedMarketResponse(): ChatResponse {
  const content =
    '当前版本仅接入 A 股市场数据，暂不支持港股、美股及其他海外市场标的。请输入 A 股股票名称或 6 位代码继续查询。';
  const message: ChatResponse['message'] = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content,
    createdAt: new Date().toISOString(),
  };
  return { events: [{ type: 'final_answer', message: content }], message };
}

function commandUsageResponse(usage: string): ChatResponse {
  const message: ChatResponse['message'] = {
    id: `assistant-${Date.now()}`,
    role: 'assistant',
    content: usage,
    createdAt: new Date().toISOString(),
  };
  return { events: [{ type: 'final_answer', message: usage }], message };
}
