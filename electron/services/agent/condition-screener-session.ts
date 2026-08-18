import type { IConditionScreenerState } from './condition-screener-compiler.js';

const sessionStateByConversation = new Map<string, IConditionScreenerState>();

export function getConditionScreenerSessionState(conversationId: string | undefined): IConditionScreenerState | undefined {
  return conversationId ? sessionStateByConversation.get(conversationId) : undefined;
}

export function setConditionScreenerSessionState(
  conversationId: string | undefined,
  state: IConditionScreenerState,
): void {
  if (!conversationId) return;
  sessionStateByConversation.set(conversationId, cloneState(state));
}

export function clearConditionScreenerSessionState(conversationId: string | undefined): void {
  if (!conversationId) return;
  sessionStateByConversation.delete(conversationId);
}

export function resetConditionScreenerSessionsForTest(): void {
  sessionStateByConversation.clear();
}

function cloneState(state: IConditionScreenerState): IConditionScreenerState {
  return {
    input: {
      ...state.input,
      marketScopes: state.input.marketScopes ? [...state.input.marketScopes] : undefined,
    },
    criteriaByKey: { ...state.criteriaByKey },
  };
}
