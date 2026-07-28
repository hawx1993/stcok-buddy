import type { AgentStep } from '../../../src/shared/types.js';

export interface DagNode<TContext> {
  id: string;
  agent: string;
  description: string;
  dependsOn?: string[];
  run(context: TContext): Promise<void>;
}

export interface DagExecuteOptions {
  /** 同一轮可并行执行的最大节点数，用于避免对下游 LLM/接口造成过大并发压力 */
  concurrency?: number;
}

export async function executeDag<TContext>(
  nodes: DagNode<TContext>[],
  context: TContext,
  onStep: (step: AgentStep) => void,
  options: DagExecuteOptions = {},
) {
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const pending = new Map(nodes.map((node) => [node.id, node]));
  const completed = new Set<string>();
  const running = new Map<string, number>(); // nodeId -> startTime

  while (pending.size) {
    const ready = [...pending.values()].filter((node) => (node.dependsOn ?? []).every((id) => completed.has(id)));
    if (!ready.length) throw new Error('DAG 依赖存在循环或缺失节点。');

    // 限制并发：本轮最多取 concurrency 个节点，其余留到下一轮
    const batch = ready.slice(0, concurrency);

    await Promise.all(
      batch.map(async (node) => {
        const progressBase = completed.size;
        const startedAt = Date.now();
        running.set(node.id, startedAt);
        onStep({
          id: node.id,
          agent: node.agent,
          description: node.description,
          status: 'running',
          detail: `进度 ${progressBase}/${nodes.length}`,
          startedAt: new Date(startedAt).toISOString(),
        });
        try {
          await node.run(context);
          const endedAt = Date.now();
          const elapsed = Math.max(0, Math.round((endedAt - startedAt) / 100) / 10);
          running.delete(node.id);
          onStep({
            id: node.id,
            agent: node.agent,
            description: node.description,
            status: 'completed',
            detail: `进度 ${Math.min(progressBase + 1, nodes.length)}/${nodes.length}`,
            elapsed,
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
          });
          completed.add(node.id);
          pending.delete(node.id);
        } catch (error) {
          const endedAt = Date.now();
          const elapsed = Math.max(0, Math.round((endedAt - startedAt) / 100) / 10);
          running.delete(node.id);
          onStep({
            id: node.id,
            agent: node.agent,
            description: node.description,
            status: 'error',
            detail: error instanceof Error ? error.message : '未知错误',
            elapsed,
            startedAt: new Date(startedAt).toISOString(),
            endedAt: new Date(endedAt).toISOString(),
          });
          completed.add(node.id);
          pending.delete(node.id);
        }
      }),
    );
  }
}
