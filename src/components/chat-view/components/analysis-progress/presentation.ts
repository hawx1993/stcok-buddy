const leadingEmoji =
  /^\s*(?:(?:\p{Extended_Pictographic}️?[\u{1F3FB}-\u{1F3FF}]?|\p{Regional_Indicator}{1,2})(?:‍\p{Extended_Pictographic}️?[\u{1F3FB}-\u{1F3FF}]?)*\s*)+/u;

const READABLE_PROGRESS_NAMES: Record<string, string> = {
  DataCoverage: '数据覆盖检查',
  ConditionScreener: '条件选股',
  screenASharesByConditions: '全市场条件选股',
};

export function normalizeProgressLabel(label: string): string {
  const normalized = label.replace(leadingEmoji, '').trimStart();
  const readable = toReadableProgressLabel(normalized);
  return readable || label;
}

export function isAnalysisProgressRunning({
  preparing,
  pending,
  completed,
}: {
  preparing: boolean;
  pending: boolean;
  completed: boolean;
}): boolean {
  return !completed && (preparing || pending);
}

function toReadableProgressLabel(label: string): string {
  const toolStarted = /^正在调用工具：(.+)$/.exec(label);
  if (toolStarted) return `正在调用工具：${readableProgressName(toolStarted[1])}`;

  const toolCompleted = /^工具完成：(.+)$/.exec(label);
  if (toolCompleted) return `工具完成：${readableProgressName(toolCompleted[1])}`;

  const toolFailed = /^工具失败：(.+)$/.exec(label);
  if (toolFailed) return `工具失败：${readableProgressName(toolFailed[1])}`;

  const executing = /^正在执行 (.+)$/.exec(label);
  if (executing) return `正在执行 ${readableProgressName(executing[1])}`;

  const completed = /^(.+) completed$/.exec(label);
  if (completed) return `${readableProgressName(completed[1])} 已完成`;

  const available = /^(.+) 返回可用数据$/.exec(label);
  if (available) return `${readableProgressName(available[1])} 返回可用数据`;

  return readableProgressName(label);
}

function readableProgressName(label: string): string {
  return READABLE_PROGRESS_NAMES[label] ?? label;
}
