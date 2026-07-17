import { Note } from '../db/models/Note';
import { Character } from '../db/models/Character';
import { Race } from '../db/models/Race';
import { Rule } from '../db/models/Rule';
import type { HydratedDocument } from '~/types/tabletop';

// ---------------------------------------------------------------------------
// Collection registry — maps collection names to fetch logic
// ---------------------------------------------------------------------------

interface CollectionFetcher {
  fetch(
    ids: string[],
    campaignId: string
  ): Promise<
    Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean; link?: string }>
  >;
}

const COLLECTION_REGISTRY: Record<string, CollectionFetcher> = {
  note: {
    async fetch(ids: string[], campaignId: string) {
      return Note.find({ _id: { $in: ids }, campaignId }, '_id title note')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { note?: string }).note,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string }>>;
    },
  },
  character: {
    async fetch(ids: string[], campaignId: string) {
      return Character.find(
        { _id: { $in: ids }, campaignId },
        '_id firstName lastName notes isPublic link'
      )
        .lean()
        .then((docs) =>
          docs.map((d) => {
            const ch = d as {
              _id: unknown;
              firstName?: string;
              lastName?: string;
              notes?: string;
              isPublic?: boolean;
              link?: string;
            };
            return {
              _id: ch._id,
              title: `${ch.firstName ?? ''} ${ch.lastName ?? ''}`.trim(),
              content: ch.notes,
              isPublic: ch.isPublic,
              link: ch.link,
            };
          })
        ) as Promise<
        Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean; link?: string }>
      >;
    },
  },
  race: {
    async fetch(ids: string[], campaignId: string) {
      return Race.find({ _id: { $in: ids }, campaignId }, '_id title content')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string }>>;
    },
  },
  rule: {
    async fetch(ids: string[], campaignId: string) {
      return Rule.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<
        Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean; link?: string }>
      >;
    },
  },
  location: {
    async fetch(ids: string[], campaignId: string) {
      const { Location } = await import('../db/models/Location');
      return Location.find({ _id: { $in: ids }, campaignId }, '_id name description isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { description?: string }).description,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  monster: {
    async fetch(ids: string[], campaignId: string) {
      const { Monster } = await import('../db/models/Monster');
      return Monster.find({ _id: { $in: ids }, campaignId }, '_id name gmNotes')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { gmNotes?: string }).gmNotes ?? '',
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string }>>;
    },
  },
  lore: {
    async fetch(ids: string[], campaignId: string) {
      const { Lore } = await import('../db/models/Lore');
      return Lore.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  events: {
    async fetch(ids: string[], campaignId: string) {
      const { Event } = await import('../db/models/Event');
      return Event.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  player: {
    async fetch(ids: string[], campaignId: string) {
      const { Player } = await import('../db/models/Player');
      return Player.find(
        { _id: { $in: ids }, campaignId },
        '_id firstName lastName description color'
      )
        .lean()
        .then(
          (
            docs: Array<{
              _id: unknown;
              firstName?: string;
              lastName?: string;
              description?: string;
              color?: string;
            }>
          ) =>
            docs.map((d) => ({
              _id: d._id,
              title: `${d.firstName ?? ''} ${d.lastName ?? ''}`.trim(),
              content: d.description ?? '',
              isPublic: true,
              color: d.color ?? '#3498db',
            }))
        );
    },
  },
  organization: {
    async fetch(ids: string[], campaignId: string) {
      const { Organization } = await import('../db/models/Organization');
      return Organization.find({ _id: { $in: ids }, campaignId }, '_id name publicInfo isPublic')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { publicInfo?: string }).publicInfo,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  quest: {
    async fetch(ids: string[], campaignId: string) {
      const { Quest } = await import('../db/models/Quest');
      return Quest.find({ _id: { $in: ids }, campaignId }, '_id name publicInfo isPublic status')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { publicInfo?: string }).publicInfo,
            isPublic: (d as { isPublic?: boolean }).isPublic,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string; isPublic?: boolean }>>;
    },
  },
  spell: {
    async fetch(ids: string[], campaignId: string) {
      const { Spell } = await import('../db/models/Spell');
      return Spell.find({ _id: { $in: ids }, campaignId }, '_id name description')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { description?: string }).description,
          }))
        ) as Promise<Array<{ _id: unknown; title?: string; content?: string }>>;
    },
  },
};

// ---------------------------------------------------------------------------
// Private-window visibility policy
// ---------------------------------------------------------------------------

/**
 * Collections whose documents are GM-only in their entirety. `getTabletopScreen`
 * already drops monster windows outright for players; events carry GM plot
 * content the same way.
 */
export const GM_ONLY_COLLECTIONS: ReadonlySet<string> = new Set(['monster', 'events']);

/**
 * Collections a non-GM may never hydrate through the PRIVATE-window path.
 *
 * `note` is here rather than isPublic-filtered because `Note.isPublic` defaults
 * to `false` and the note fetcher above does not select the field. Selecting it
 * would change what the SHARED path returns for note windows, so notes fail
 * closed for non-GMs instead. See the report for the follow-up.
 */
const PRIVATE_DENIED_FOR_PLAYERS: ReadonlySet<string> = new Set([...GM_ONLY_COLLECTIONS, 'note']);

/** Whether `collection` may be hydrated at all on the private-window path. */
export function canHydratePrivately(collection: string, isGM: boolean): boolean {
  return isGM || !PRIVATE_DENIED_FOR_PLAYERS.has(collection);
}

/**
 * Hydrate private-window refs under the caller's visibility.
 *
 * Private windows are added by `addPrivateWindow`, which is member-level and
 * whose schema accepts every collection — so a player can craft a window
 * pointing at ANY document id. This path must therefore enforce the same rules
 * the sanctioned per-collection getters do (e.g. `getLore` returns null for a
 * non-public doc to a non-GM), which the shared-window filter in `hydrateRefs`
 * does not: it only covers events/organization/quest.
 *
 * A ref that is denied simply has no entry in the returned map, which lets the
 * caller drop the window rather than render an untitled ghost.
 */
export async function hydratePrivateWindowRefs(
  refs: Array<{ collection: string; documentId: string }>,
  campaignId: string,
  opts: { isGM: boolean }
): Promise<Record<string, HydratedDocument>> {
  const { isGM } = opts;

  // GM-only collections are never fetched for a player in the first place.
  const allowed = refs.filter((ref) => canHydratePrivately(ref.collection, isGM));
  const hydrated = await hydrateRefs(allowed, campaignId, { isGM });
  if (isGM) return hydrated;

  // Fail closed on every collection carrying isPublic — lore, location,
  // character, rule, organization, quest, events — not just the three
  // `hydrateRefs` happens to filter for the shared path.
  for (const [key, doc] of Object.entries(hydrated)) {
    if (doc.isPublic === false) delete hydrated[key];
  }
  return hydrated;
}

/**
 * Batch-hydrate a set of `{ collection, documentId }` refs.
 * Groups by collection, fetches each batch, and returns a lookup map
 * keyed by `"collection:documentId"`.
 */
export async function hydrateRefs(
  refs: Array<{ collection: string; documentId: string }>,
  campaignId: string,
  opts: { isGM?: boolean } = {}
): Promise<Record<string, HydratedDocument>> {
  const isGM = opts.isGM ?? true;
  const grouped = new Map<string, Set<string>>();
  for (const ref of refs) {
    if (!ref.collection || !ref.documentId) continue;
    let set = grouped.get(ref.collection);
    if (!set) {
      set = new Set();
      grouped.set(ref.collection, set);
    }
    set.add(ref.documentId);
  }

  const hydrated: Record<string, HydratedDocument> = {};

  await Promise.all(
    Array.from(grouped.entries()).map(async ([collectionName, idSet]) => {
      const fetcher = COLLECTION_REGISTRY[collectionName];
      if (!fetcher) return;

      const docs = await fetcher.fetch(Array.from(idSet), campaignId);
      for (const doc of docs) {
        // Events can carry private GM content; never hydrate a non-public event
        // for a non-GM viewer, or its title/content would leak on a shared screen.
        if (!isGM && collectionName === 'events' && doc.isPublic === false) continue;
        if (!isGM && collectionName === 'organization' && doc.isPublic === false) continue;
        if (!isGM && collectionName === 'quest' && doc.isPublic === false) continue;
        const id = String(doc._id);
        hydrated[`${collectionName}:${id}`] = {
          id,
          collection: collectionName,
          title: doc.title ?? '',
          content: doc.content ?? '',
          ...(doc.isPublic !== undefined && { isPublic: doc.isPublic }),
          ...(doc.link && { link: doc.link }),
        };
      }
    })
  );

  return hydrated;
}
