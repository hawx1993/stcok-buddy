const FAVORITE_TIMELINE_SWITCH_STORAGE_KEY = 'stocksense-favorite-timeline-visible';

export function readFavoriteTimelineSwitchCache() {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(FAVORITE_TIMELINE_SWITCH_STORAGE_KEY) === 'true';
}

export function writeFavoriteTimelineSwitchCache(visible: boolean) {
  localStorage.setItem(FAVORITE_TIMELINE_SWITCH_STORAGE_KEY, String(visible));
}
