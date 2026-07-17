import type { AnalyticsProperties } from './types.js';

export function track(event: string, properties?: AnalyticsProperties) {
  window.stocksense?.captureAnalytics?.(event, properties).catch(() => undefined);
}

export function trackButtonClick(name: string, properties?: AnalyticsProperties) {
  track('button_clicked', { button_name: name, ...properties });
}

export function trackPageView(page: string, properties?: AnalyticsProperties) {
  track('page_viewed', { page, ...properties });
}
