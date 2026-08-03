import type { MessagePort, Worker } from 'node:worker_threads';
import type { Endpoint } from 'comlink';

type TNodeMessageEndpoint = Pick<Worker | MessagePort, 'postMessage' | 'on' | 'off'> & { start?: () => void };
type TNodeMessageListener = (message: unknown) => void;

export function nodeEndpoint(endpoint: TNodeMessageEndpoint): Endpoint {
  const listeners = new WeakMap<EventListenerOrEventListenerObject, TNodeMessageListener>();
  return {
    postMessage: (message, transfer) => endpoint.postMessage(message, transfer as never[]),
    addEventListener: (_type, listener) => {
      const wrapped = (data: unknown) => {
        const event = { data } as MessageEvent;
        if ('handleEvent' in listener) listener.handleEvent(event);
        else listener(event);
      };
      endpoint.on('message', wrapped);
      listeners.set(listener, wrapped);
    },
    removeEventListener: (_type, listener) => {
      const wrapped = listeners.get(listener);
      if (!wrapped) return;
      endpoint.off('message', wrapped);
      listeners.delete(listener);
    },
    start: endpoint.start ? () => endpoint.start?.() : undefined,
  };
}
