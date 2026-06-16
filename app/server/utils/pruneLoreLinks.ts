import { Lore } from '../db/models/Lore';
import type { LoreLinkKind } from '~/types/lore';

/** Remove any lore links pointing at a deleted entity so tabs/chips don't dangle. */
export async function pruneLoreLinks(kind: LoreLinkKind, id: string, campaignId: string) {
  await Lore.updateMany({ campaignId, 'links.id': id }, { $pull: { links: { kind, id } } });
}
