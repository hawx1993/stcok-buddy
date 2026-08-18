import type { TStoreCommandRunner } from './types.js';

const builtInStoreCommandRunners = new Map<string, TStoreCommandRunner>([
  ['dragon-tiger', async (input) => (await import('./dragon-tiger-command.js')).runDragonTigerCommand(input)],
  ['industry-rotation', async () => (await import('./industry-rotation-command.js')).runIndustryRotationCommand()],
  ['web-page-summary', async (input) => (await import('./web-page-summary-command.js')).runWebPageSummaryCommand(input)],
]);

export function getBuiltInStoreCommandRunner(id: string): TStoreCommandRunner | undefined {
  return builtInStoreCommandRunners.get(id);
}
