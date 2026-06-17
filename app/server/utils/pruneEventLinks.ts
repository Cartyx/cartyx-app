import { Event } from '../db/models/Event';
import type { EventLinkKind } from '~/types/event';

/** Remove any event links pointing at a deleted entity so chips don't dangle. */
export async function pruneEventLinks(kind: EventLinkKind, id: string, campaignId: string) {
  await Event.updateMany({ campaignId, 'links.id': id }, { $pull: { links: { kind, id } } });
}
