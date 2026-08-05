import { BrowserWindow, Notification, systemPreferences } from '../electron-runtime.js';

const MAX_NOTIFICATION_BODY_LENGTH = 120;

export type DesktopNotificationResult = { delivered: true } | { delivered: false; reason: string };

export function notifyAiResponseCompleted(content: string) {
  return showDesktopNotification('StockBuddy', summarizeResponse(content) || 'AI 已完成回答。');
}

export function notifyAiResponseTest() {
  return showDesktopNotification(
    'StockBuddy 通知测试',
    'AI 回答完成通知已开启。若未看到通知，请在系统通知设置中允许 StockBuddy 发送通知。',
  );
}

export function isAppFocused(): boolean {
  const focused = BrowserWindow.getFocusedWindow();
  return focused?.isFocused() ?? false;
}

export function getNotificationState(): {
  supported: boolean;
  permission: NotificationPermission | 'unknown';
  likelyVisible: boolean;
  reason?: string;
} {
  const supported = Notification.isSupported();
  if (!supported) {
    return { supported, permission: 'unknown', likelyVisible: false, reason: '当前系统不支持桌面通知。' };
  }

  const permission = getNotificationPermission();
  if (permission === 'denied') {
    return {
      supported,
      permission,
      likelyVisible: false,
      reason: '系统通知权限被拒绝，请前往系统设置 > 通知中允许 StockBuddy。',
    };
  }

  // macOS: 若应用处于前台，横幅通知通常不会弹出，而是静默进入通知中心
  if (process.platform === 'darwin' && isAppFocused()) {
    return {
      supported,
      permission,
      likelyVisible: false,
      reason: '应用当前处于前台，macOS 默认不弹横幅通知。',
    };
  }

  return { supported, permission, likelyVisible: true };
}

function showDesktopNotification(title: string, body: string): DesktopNotificationResult {
  const state = getNotificationState();
  if (!state.supported) return { delivered: false, reason: state.reason ?? '当前系统不支持桌面通知。' };
  if (state.permission === 'denied') {
    return { delivered: false, reason: state.reason ?? '系统通知权限被拒绝。' };
  }

  try {
    // 触发一次权限申请（若尚未决定），macOS 会在首次 show 时弹出系统授权提示
    const notification = new Notification({
      title,
      body,
      silent: false,
    });
    notification.show();
    return { delivered: true };
  } catch (error) {
    console.warn('[desktop-notification] failed to show notification', error);
    return { delivered: false, reason: '系统通知发送失败，请检查系统通知设置。' };
  }
}

function getNotificationPermission(): NotificationPermission | 'unknown' {
  try {
    if ('permission' in Notification) {
      return (Notification as unknown as { permission: NotificationPermission }).permission;
    }
  } catch {
    // ignore
  }

  if (process.platform === 'darwin') {
    try {
      const alertStyle = systemPreferences.getUserDefault('NSUserNotificationAlertStyle', 'string');
      if (alertStyle === 'none') return 'denied';
    } catch {
      // ignore
    }
  }

  return 'default';
}

export function summarizeResponse(content: string) {
  const text = content
    // 去掉 HTML 标签
    .replace(/<[^>]*>/g, '')
    // 去掉代码块
    .replace(/```[\s\S]*?```/g, ' ')
    // 去掉行内代码
    .replace(/`([^`]+)`/g, '$1')
    // 去掉链接 [text](url)，保留 text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // 去掉图片 ![alt](url)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    // 去掉 Markdown 标记符号
    .replace(/[*_~`>|#]/g, ' ')
    // 去掉 emoji 短码 :smile:
    .replace(/:[a-z_]+:/g, '')
    // 合并空白
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= MAX_NOTIFICATION_BODY_LENGTH) return text;
  return `${text.slice(0, MAX_NOTIFICATION_BODY_LENGTH - 1)}…`;
}
