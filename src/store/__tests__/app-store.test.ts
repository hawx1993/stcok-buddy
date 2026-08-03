import { describe, expect, it } from 'vitest';
import { useAppStore } from '../app-store';

describe('右侧栏状态切换', () => {
  it('重复打开板块 tab 时应和其他 tab 一样切换收缩状态', () => {
    const initialState = useAppStore.getInitialState();
    useAppStore.setState(initialState, true);

    useAppStore.getState().setRightPanelTab('board');

    expect(useAppStore.getState().rightPanelTab).toBe('board');
    expect(useAppStore.getState().isRightPanelCollapsed).toBe(false);

    useAppStore.getState().setRightPanelTab('board');

    expect(useAppStore.getState().rightPanelTab).toBe('board');
    expect(useAppStore.getState().isRightPanelCollapsed).toBe(true);
  });
});
