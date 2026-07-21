import type { ChatMessage } from '../../../shared/types';

// ponytail: references builtInSlashItems from parent; keep close to avoid import cycle
type TSingleAgentItem = { section: string; command: string; label: string; id: string };

let _builtInSlashItems: TSingleAgentItem[] | undefined;

export function setBuiltInSlashItems(items: TSingleAgentItem[]) {
  _builtInSlashItems = items;
}

let _isStockAnalysisQueryFn: ((text: string) => boolean) | undefined;

export function setIsStockAnalysisQuery(fn: (text: string) => boolean) {
  _isStockAnalysisQueryFn = fn;
}

export function isGreeting(text: string) {
  return /^(你好|您好|hi|hello|hey|嗨|哈喽)[!！。\s]*$/i.test(text.trim());
}

function isStockAnalysisQuery(text: string) {
  if (_isStockAnalysisQueryFn) return _isStockAnalysisQueryFn(text);
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /\d{6}/.test(normalized) && /分析|诊断|怎么样|如何|帮我|看看/.test(normalized);
}

function getSingleAgentCommand(text: string) {
  if (!_builtInSlashItems) return undefined;
  const command = _builtInSlashItems.find(
    (item) => item.section === 'Sub Agents' && text.startsWith(`${item.command} `),
  );
  return command;
}

export function createThinkingSteps(text: string): NonNullable<ChatMessage['steps']> {
  const commandSteps = getCommandThinkingSteps(text);
  if (commandSteps) return commandSteps;

  const singleAgent = getSingleAgentCommand(text);
  if (singleAgent) {
    return [
      { id: 'quote', agent: 'DataAgent', description: '0/3 获取实时行情', status: 'running' as const },
      { id: 'market-data', agent: 'DataAgent', description: '1/3 拉取K线、指标与新闻样本', status: 'pending' as const },
      {
        id: `analysis-${singleAgent.id}`,
        agent: singleAgent.label.replace('agent', ''),
        description: `2/3 调用${singleAgent.label}`,
        status: 'pending' as const,
      },
    ];
  }

  if (isStockAnalysisQuery(text)) {
    return [
      { id: 'quote', agent: 'DataAgent', description: '0/8 获取实时行情', status: 'running' as const },
      { id: 'market-data', agent: 'DataAgent', description: '1/8 拉取K线、技术指标与新闻样本', status: 'pending' as const },
      { id: 'analysis-technical', agent: '技术面分析', description: '2/8 调用技术面子Agent', status: 'pending' as const },
      { id: 'analysis-fundamental', agent: '基本面分析', description: '3/8 调用基本面子Agent', status: 'pending' as const },
      { id: 'analysis-capital', agent: '资金面分析', description: '4/8 调用资金面子Agent', status: 'pending' as const },
      { id: 'analysis-sentiment', agent: '情绪面分析', description: '5/8 调用情绪面子Agent', status: 'pending' as const },
      { id: 'analysis-chip', agent: '筹码分析', description: '6/8 调用筹码分析子Agent', status: 'pending' as const },
      { id: 'analysis-overview', agent: '汇总分析Agent', description: '7/8 汇总五维结果并生成报告', status: 'pending' as const },
    ];
  }
  const hasStock = /[一-龥]{2,}|\d{6}/.test(text);
  return [
    {
      id: 'understand',
      agent: '理解问题',
      description: `识别用户意图：${text.slice(0, 28)}${text.length > 28 ? '…' : ''}`,
      status: 'running' as const,
    },
    {
      id: 'collect',
      agent: '采集数据',
      description: hasStock ? '准备拉取行情、财务、估值与资金面数据' : '准备检索相关市场、板块与资金线索',
      status: 'pending' as const,
    },
    { id: 'analyze', agent: '生成结论', description: '汇总基本面、技术面与风险点，组织可执行回答', status: 'pending' as const },
    { id: 'risk', agent: '风险核查', description: '检查异常波动、估值偏离与潜在风险提示', status: 'pending' as const },
  ];
}

export function getCommandThinkingSteps(text: string): NonNullable<ChatMessage['steps']> | undefined {
  const command = text.trim().split(/\s+/, 1)[0];
  const stockTarget = text.trim().slice(command.length).trim() || '目标股票';
  const map: Record<string, NonNullable<ChatMessage['steps']>> = {
    '/网页内容总结': [
      {
        id: 'understand',
        agent: '理解问题',
        description: `识别网页总结任务：${text.slice(0, 36)}${text.length > 36 ? '…' : ''}`,
        status: 'running' as const,
      },
      {
        id: 'collect-web',
        agent: '采集网页数据',
        description: '使用 Crawl4AI 提取网页正文、标题与可读内容',
        status: 'pending' as const,
      },
      {
        id: 'summarize-web',
        agent: '汇总网页数据',
        description: '清洗正文并生成中文 Markdown 摘要',
        status: 'pending' as const,
      },
    ],
    '/行业轮动': [
      { id: 'understand', agent: '理解问题', description: '识别行业轮动命令', status: 'running' as const },
      { id: 'collect-sector', agent: '采集行业数据', description: '拉取行业涨幅榜与板块资金流', status: 'pending' as const },
      {
        id: 'summarize-sector',
        agent: '汇总行业数据',
        description: '整理强势行业、资金流向与轮动风险',
        status: 'pending' as const,
      },
    ],
    '/龙虎榜': [
      { id: 'understand', agent: '理解问题', description: `识别个股龙虎榜命令：${stockTarget}`, status: 'running' as const },
      {
        id: 'collect-lhb',
        agent: '采集龙虎榜数据',
        description: '拉取个股近30日上榜记录与买卖席位',
        status: 'pending' as const,
      },
      {
        id: 'summarize-lhb',
        agent: '汇总龙虎榜数据',
        description: '整理净买入、营业部席位与短线风险',
        status: 'pending' as const,
      },
    ],
    '/全市场龙虎榜': [
      { id: 'understand', agent: '理解问题', description: '识别全市场龙虎榜命令', status: 'running' as const },
      {
        id: 'collect-market-lhb',
        agent: '采集龙虎榜数据',
        description: '拉取全市场龙虎榜净买入排名',
        status: 'pending' as const,
      },
      {
        id: 'summarize-market-lhb',
        agent: '汇总龙虎榜数据',
        description: '整理买入席位、热门个股与短线风险',
        status: 'pending' as const,
      },
    ],
    '/题材归因': [
      { id: 'understand', agent: '理解问题', description: '识别题材归因命令', status: 'running' as const },
      {
        id: 'collect-theme',
        agent: '采集题材数据',
        description: '拉取强势股、热点题材与资金流数据',
        status: 'pending' as const,
      },
      {
        id: 'summarize-theme',
        agent: '汇总题材数据',
        description: '归纳上涨题材、代表个股与持续性风险',
        status: 'pending' as const,
      },
    ],
    '/新闻公告': [
      { id: 'understand', agent: '理解问题', description: `识别新闻公告命令：${stockTarget}`, status: 'running' as const },
      { id: 'collect-news', agent: '采集新闻公告', description: '拉取个股最近新闻、公告与事件线索', status: 'pending' as const },
      {
        id: 'summarize-news',
        agent: '汇总新闻公告',
        description: '解读利好利空、事件影响与信息风险',
        status: 'pending' as const,
      },
    ],
    '/综合投研报告': [
      { id: 'understand', agent: '理解问题', description: `识别综合投研报告命令：${stockTarget}`, status: 'running' as const },
      {
        id: 'collect-stock',
        agent: '采集个股数据',
        description: '拉取行情、K线、新闻、资金与筹码数据',
        status: 'pending' as const,
      },
      {
        id: 'summarize-stock',
        agent: '汇总投研结论',
        description: '调用多维分析 Agent 并生成综合投研报告',
        status: 'pending' as const,
      },
    ],
  };
  return map[command];
}
