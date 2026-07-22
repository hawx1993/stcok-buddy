import { Notification } from 'electron';

const MAX_NOTIFICATION_BODY_LENGTH = 120;

export type DesktopNotificationResult =
  | { delivered: true }
  | { delivered: false; reason: string };

export function notifyAiResponseCompleted(content: string) {
  return showDesktopNotification('StockBuddy', summarizeResponse(content) || 'AI 已完成回答。');
}

export function notifyAiResponseTest() {
  return showDesktopNotification('StockBuddy 通知测试', 'AI 回答完成通知已开启。若未看到通知，请在系统通知设置中允许 StockBuddy 发送通知。');
}

function showDesktopNotification(title: string, body: string): DesktopNotificationResult {
  if (!Notification.isSupported()) return { delivered: false, reason: '当前系统不支持桌面通知。' };

  try {
    new Notification({ title, body }).show();
    return { delivered: true };
  } catch (error) {
    console.warn('[desktop-notification] failed to show notification', error);
    return { delivered: false, reason: '系统通知发送失败，请检查系统通知设置。' };
  }
}

function summarizeResponse(content: string) {
  const text = content
    .replace(/[\[\]#*_`>|\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= MAX_NOTIFICATION_BODY_LENGTH) return text;
  return `${text.slice(0, MAX_NOTIFICATION_BODY_LENGTH - 1)}…`;
}
