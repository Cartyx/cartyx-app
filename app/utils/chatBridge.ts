// Window events bridge a component deep in the wiki (e.g. the spell view) to the
// realtime socket owner (InspectorSidebar), so it can post a chat message
// without threading the socket down. Same pattern as diceRollerBridge.

export interface ChatBroadcastRequest {
  requestId: string;
  text: string;
  channel: 'general' | 'gm';
}

export interface ChatDeliveryReport {
  requestId: string;
  delivered: boolean;
}

const BROADCAST_EVENT = 'cartyx:chat-broadcast-request';
const DELIVERY_EVENT = 'cartyx:chat-delivery-report';

export function requestChatBroadcast(detail: ChatBroadcastRequest): void {
  window.dispatchEvent(new CustomEvent(BROADCAST_EVENT, { detail }));
}

export function onChatBroadcastRequest(cb: (d: ChatBroadcastRequest) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ChatBroadcastRequest>).detail);
  window.addEventListener(BROADCAST_EVENT, handler);
  return () => window.removeEventListener(BROADCAST_EVENT, handler);
}

export function reportChatDelivery(detail: ChatDeliveryReport): void {
  window.dispatchEvent(new CustomEvent(DELIVERY_EVENT, { detail }));
}

export function onChatDelivery(cb: (d: ChatDeliveryReport) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<ChatDeliveryReport>).detail);
  window.addEventListener(DELIVERY_EVENT, handler);
  return () => window.removeEventListener(DELIVERY_EVENT, handler);
}
