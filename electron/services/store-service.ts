import { app } from 'electron';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentRunEvent, ChatMessage, ChatResponse, StoreItem } from '../../src/shared/types.js';
import { installStoreItem, listInstalledStoreItems, uninstallStoreItem } from './config-store.js';
import { generateReport } from './llm/index.js';

const categoryDirs = ['commands', 'skills', 'sub-agents'] as const;

type StoreCommandResult = { content: string; result?: ChatMessage['result']; events?: AgentRunEvent[] };

export async function listStoreItems(): Promise<StoreItem[]> {
  const roots = storeRoots();
  const items: StoreItem[] = [];
  for (const category of categoryDirs) {
    for (const root of roots) {
      const dir = path.join(root, category);
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          items.push(await readStoreItem(path.join(dir, entry.name, 'index.json')));
        }
        break;
      } catch {
        // try the next root
      }
    }
  }
  return items;
}

export async function runStoreCommand(query: string): Promise<ChatResponse | undefined> {
  const text = query.trim();
  const item = (await listStoreItems()).find((candidate) => candidate.command && (text === candidate.command || text.startsWith(`${candidate.command} `)));
  if (!item?.handler) return undefined;

  const args = text.slice(item.command!.length).trim();
  const handlerPath = await resolveHandlerPath(item);
  const source = await readFile(handlerPath, 'utf8');
  const encoded = Buffer.from(`${source}\n//# sourceURL=${handlerPath}`).toString('base64');
  const mod = await import(`data:text/javascript;base64,${encoded}#${Date.now()}`) as { run?: (input: { args: string; query: string; item: StoreItem; llm?: { generate: typeof generateReport } }) => Promise<StoreCommandResult> };
  if (typeof mod.run !== 'function') throw new Error(`Store plugin ${item.id} missing run()`);
  const output = await mod.run({ args, query, item, llm: { generate: generateReport } });
  const planAgents = [
    { id: 'understand', agent: '理解问题', description: `识别${item.name ?? '命令'}` },
    { id: 'collect', agent: '采集数据', description: item.description ?? '拉取数据' },
    { id: 'summarize', agent: '汇总', description: '整理数据并生成报告' },
  ];
  const events = [
    { type: 'plan_created' as const, title: '分析计划', message: item.description ?? item.name, progress: { current: 0, total: 3 }, plan: { agents: planAgents } },
    ...(output.events ?? []),
    { type: 'final_answer' as const, message: output.content },
  ];
  return {
    events,
    message: {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: output.content,
      createdAt: new Date().toISOString(),
      steps: events.map((event) => event.step).filter((step): step is NonNullable<typeof step> => Boolean(step)),
      result: output.result,
    },
  };
}

export { installStoreItem, listInstalledStoreItems, uninstallStoreItem };

function storeRoots() {
  return [
    path.join(process.cwd(), 'public/store'),
    path.join(app.getAppPath(), 'public/store'),
    path.join(process.resourcesPath, 'public/store'),
  ];
}

async function readStoreItem(file: string): Promise<StoreItem> {
  return JSON.parse(await readFile(file, 'utf8')) as StoreItem;
}

async function resolveHandlerPath(item: StoreItem) {
  const handler = item.handler ?? 'index.js';
  if (handler.includes('..') || path.isAbsolute(handler)) throw new Error(`Invalid store handler: ${handler}`);
  for (const root of storeRoots()) {
    const pluginDir = path.resolve(root, item.category, item.id);
    const handlerPath = path.resolve(pluginDir, handler);
    if (!handlerPath.startsWith(`${pluginDir}${path.sep}`)) throw new Error(`Invalid store handler path: ${handler}`);
    try {
      await readFile(handlerPath);
      return handlerPath;
    } catch {
      // try the next root
    }
  }
  throw new Error(`Store handler not found: ${item.id}`);
}
