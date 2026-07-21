import type { ChatMessage, AgentRunEvent } from '../../../shared/types';

export function dedupeLabelPrefix(agent: string, description: string) {
  if (!agent || !description) return description;
  const cleanedAgent = agent.replace(/agent$/i, '').trim();
  if (!cleanedAgent) return description;
  const lowerAgent = cleanedAgent.toLowerCase();
  const lowerDesc = description.toLowerCase();
  if (lowerDesc.startsWith(lowerAgent)) {
    const rest = description.slice(cleanedAgent.length);
    return rest.replace(/^[\s：:]+/, '') || description;
  }
  return description;
}

export function lastStockMessageWithCode(messages: ChatMessage[], code: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' && message.content.includes(code)) return message;
  }
  return undefined;
}

export function formatMessageTime(createdAt: string, now: number) {
  const date = new Date(createdAt).getTime();
  const secondsAgo = (now - date) / 1000;
  if (secondsAgo < 60) return '刚刚';
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)} 分钟前`;
  const today = new Date(now);
  const msgDate = new Date(date);
  if (
    msgDate.getFullYear() === today.getFullYear() &&
    msgDate.getMonth() === today.getMonth() &&
    msgDate.getDate() === today.getDate()
  ) {
    return msgDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return msgDate.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export function formatTimeAgo(date: Date, now: Date) {
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

export function isStockAnalysisQuery(text: string) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  return /\d{6}/.test(normalized) && /分析|诊断|怎么样|如何|帮我|看看/.test(normalized);
}

export function isGreeting(text: string) {
  return /^(你好|您好|hi|hello|hey|嗨|哈喽)[!！。\s]*$/i.test(text.trim());
}
