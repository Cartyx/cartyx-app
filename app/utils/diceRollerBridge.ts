import type { ParsedDiceRoll } from '~/hooks/useBeyond20';

export interface DiceBroadcastRequest {
  requestId: string;
  roll: ParsedDiceRoll;
}

export interface DiceDeliveryReport {
  requestId: string;
  delivered: boolean;
}

// Window events bridge the dice roller window (TabletopView subtree) to the
// realtime socket owner (InspectorSidebar subtree) — same pattern useBeyond20
// uses to relay extension rolls.
const BROADCAST_EVENT = 'cartyx:dice-broadcast-request';
const DELIVERY_EVENT = 'cartyx:dice-delivery-report';

export function requestDiceBroadcast(detail: DiceBroadcastRequest): void {
  window.dispatchEvent(new CustomEvent(BROADCAST_EVENT, { detail }));
}

export function onDiceBroadcastRequest(cb: (d: DiceBroadcastRequest) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<DiceBroadcastRequest>).detail);
  window.addEventListener(BROADCAST_EVENT, handler);
  return () => window.removeEventListener(BROADCAST_EVENT, handler);
}

export function reportDiceDelivery(detail: DiceDeliveryReport): void {
  window.dispatchEvent(new CustomEvent(DELIVERY_EVENT, { detail }));
}

export function onDiceDelivery(cb: (d: DiceDeliveryReport) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<DiceDeliveryReport>).detail);
  window.addEventListener(DELIVERY_EVENT, handler);
  return () => window.removeEventListener(DELIVERY_EVENT, handler);
}
