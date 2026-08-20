import { describe, expect, it } from 'vitest';
import { getBuiltInStoreCommandRunner } from '../store-commands/registry.js';

describe('built-in store command registry', () => {
  it.each(['dragon-tiger', 'industry-rotation', 'web-page-summary'])(
    'registers %s without a JavaScript handler',
    (id) => {
      expect(getBuiltInStoreCommandRunner(id)).toEqual(expect.any(Function));
    },
  );

  it('does not claim external commands', () => {
    expect(getBuiltInStoreCommandRunner('external-command')).toBeUndefined();
  });
});
