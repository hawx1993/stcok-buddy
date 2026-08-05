import type { IMonitorEvent, IMonitorFeed, TMonitorCategory } from '../../../shared/types';

export type TVisibleMonitorCategory = Exclude<TMonitorCategory, 'dragon-tiger'>;
export type TVisibleMonitorEvent = IMonitorEvent & { category: TVisibleMonitorCategory };

export function isVisibleMonitorEvent(event: IMonitorEvent): event is TVisibleMonitorEvent {
  return event.category !== 'dragon-tiger';
}

export function getLatestVisibleMonitorEvents(feed: IMonitorFeed) {
  return feed.events
    .filter(isVisibleMonitorEvent)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);
}
