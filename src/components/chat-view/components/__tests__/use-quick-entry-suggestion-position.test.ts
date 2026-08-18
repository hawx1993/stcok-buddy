import { describe, expect, it } from 'vitest';
import { resolveQuickEntrySuggestionPosition } from '../use-quick-entry-suggestion-position';

describe('Quick Entry 搜索建议位置', () => {
  it('在下方空间充足时为面板保留 20px 的视口底部间距', () => {
    const position = resolveQuickEntrySuggestionPosition({ anchorTop: 480, anchorBottom: 520, viewportHeight: 800 });

    expect(position).toEqual({ placement: 'below', maxHeight: 252 });
  });

  it('下方空间不足时将面板翻转到输入框上方', () => {
    const position = resolveQuickEntrySuggestionPosition({ anchorTop: 430, anchorBottom: 470, viewportHeight: 600 });

    expect(position).toEqual({ placement: 'above', maxHeight: 260 });
  });

  it('在受限视口中压缩高度而不突破安全边距', () => {
    const position = resolveQuickEntrySuggestionPosition({ anchorTop: 40, anchorBottom: 80, viewportHeight: 130 });

    expect(position).toEqual({ placement: 'below', maxHeight: 22 });
  });
});
