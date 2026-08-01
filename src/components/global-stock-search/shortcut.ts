export function isMacPlatform(platform = typeof navigator === 'undefined' ? '' : navigator.platform) {
  return /Mac|iPhone|iPad|iPod/.test(platform);
}

export function getGlobalSearchShortcutLabel(platform = typeof navigator === 'undefined' ? '' : navigator.platform) {
  return isMacPlatform(platform) ? '⌘/' : 'Ctrl+/';
}

export function isGlobalSearchShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>, isMac: boolean) {
  return event.key === '/' && (isMac ? event.metaKey : event.ctrlKey);
}
