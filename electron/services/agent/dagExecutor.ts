import type { AgentStep } from '../../../src/shared/types.js';

export interface DagNode<TContext> {
  id: string;
  agent: string;
  description: string;
  dependsOn?: string[];
  run(context: TContext): Promise<void>;
}

export async function executeDag<TContext>(
  nodes: DagNode<TContext>[],
  context: TContext,
  onStep: (step: AgentStep) => void,
) {
  const pending = new Map(nodes.map((node) => [node.id, node]));
  const completed = new Set<string>();

  while (pending.size) {
    const ready = [...pending.values()].filter((node) => (node.dependsOn ?? []).every((id) => completed.has(id)));
    if (!ready.length) throw new Error('DAG 依赖存在循环或缺失节点。');

    await Promise.all(
      ready.map(async (node) => {
        onStep({ id: node.id, agent: node.agent, description: node.description, status: 'running' });
        try {
          await node.run(context);
          onStep({ id: node.id, agent: node.agent, description: node.description, status: 'completed' });
          completed.add(node.id);
          pending.delete(node.id);
        } catch (error) {
          onStep({
            id: node.id,
            agent: node.agent,
            description: node.description,
            status: 'error',
            detail: error instanceof Error ? error.message : '未知错误',
          });
          completed.add(node.id);
          pending.delete(node.id);
        }
      }),
    );
  }
}
