import { Note } from '../db/models/Note';
import { Character } from '../db/models/Character';
import { Race } from '../db/models/Race';
import { Rule } from '../db/models/Rule';
import type { HydratedDocument } from '~/types/tabletop';
import { canHydratePrivately, isVisibleOnPrivatePath } from '~/types/windowVisibility';

// The visibility policy itself lives in a model-free module so the client can
// import it too (the overflow menu must not offer an action the server rejects).
export {
  GM_ONLY_COLLECTIONS,
  PRIVATE_DENIED_FOR_PLAYERS,
  CREATOR_VISIBLE_COLLECTIONS,
  canHydratePrivately,
  isVisibleOnPrivatePath,
} from '~/types/windowVisibility';

// ---------------------------------------------------------------------------
// Collection registry — maps collection names to fetch logic
// ---------------------------------------------------------------------------

/**
 * `createdBy` is selected by every fetcher whose collection grants a creator
 * exception (see CREATOR_VISIBLE_COLLECTIONS). It is used only to decide
 * visibility on the private path and is never copied into HydratedDocument,
 * so it never reaches the client.
 */
/** Normalises a lean doc's `createdBy` ObjectId to the string form userIds use. */
function serializeCreatedBy(doc: unknown): string | undefined {
  const raw = (doc as { createdBy?: unknown }).createdBy;
  return raw === undefined || raw === null ? undefined : String(raw);
}

interface CollectionFetcher {
  fetch(
    ids: string[],
    campaignId: string
  ): Promise<
    Array<{
      _id: unknown;
      title?: string;
      content?: string;
      isPublic?: boolean;
      link?: string;
      createdBy?: string;
    }>
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
        '_id firstName lastName notes isPublic link createdBy'
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
              createdBy?: unknown;
            };
            return {
              _id: ch._id,
              title: `${ch.firstName ?? ''} ${ch.lastName ?? ''}`.trim(),
              content: ch.notes,
              isPublic: ch.isPublic,
              link: ch.link,
              createdBy: serializeCreatedBy(ch),
            };
          })
        ) as Promise<
        Array<{
          _id: unknown;
          title?: string;
          content?: string;
          isPublic?: boolean;
          link?: string;
          createdBy?: string;
        }>
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
      return Location.find(
        { _id: { $in: ids }, campaignId },
        '_id name description isPublic createdBy'
      )
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { description?: string }).description,
            isPublic: (d as { isPublic?: boolean }).isPublic,
            createdBy: serializeCreatedBy(d),
          }))
        ) as Promise<
        Array<{
          _id: unknown;
          title?: string;
          content?: string;
          isPublic?: boolean;
          createdBy?: string;
        }>
      >;
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
      return Lore.find({ _id: { $in: ids }, campaignId }, '_id title content isPublic createdBy')
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { title?: string }).title,
            content: (d as { content?: string }).content,
            isPublic: (d as { isPublic?: boolean }).isPublic,
            createdBy: serializeCreatedBy(d),
          }))
        ) as Promise<
        Array<{
          _id: unknown;
          title?: string;
          content?: string;
          isPublic?: boolean;
          createdBy?: string;
        }>
      >;
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
      return Organization.find(
        { _id: { $in: ids }, campaignId },
        '_id name publicInfo isPublic createdBy'
      )
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { publicInfo?: string }).publicInfo,
            isPublic: (d as { isPublic?: boolean }).isPublic,
            createdBy: serializeCreatedBy(d),
          }))
        ) as Promise<
        Array<{
          _id: unknown;
          title?: string;
          content?: string;
          isPublic?: boolean;
          createdBy?: string;
        }>
      >;
    },
  },
  quest: {
    async fetch(ids: string[], campaignId: string) {
      const { Quest } = await import('../db/models/Quest');
      return Quest.find(
        { _id: { $in: ids }, campaignId },
        '_id name publicInfo isPublic status createdBy'
      )
        .lean()
        .then((docs) =>
          docs.map((d) => ({
            _id: d._id,
            title: (d as { name?: string }).name,
            content: (d as { publicInfo?: string }).publicInfo,
            isPublic: (d as { isPublic?: boolean }).isPublic,
            createdBy: serializeCreatedBy(d),
          }))
        ) as Promise<
        Array<{
          _id: unknown;
          title?: string;
          content?: string;
          isPublic?: boolean;
          createdBy?: string;
        }>
      >;
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
 * Hydrate private-window refs under the caller's visibility.
 *
 * Private windows are added by `addPrivateWindow`, which is member-level and
 * whose schema accepts every collection — so a player can craft a window
 * pointing at ANY document id. This path must therefore enforce the same rules
 * the sanctioned per-collection getters do, which the shared-window filter in
 * `hydrateRefs` does not: it only covers events/organization/quest.
 *
 * "The same rules" means exactly what `getLore`/`getCharacter`/… enforce:
 * public, OR non-public but created by the viewer (see
 * CREATOR_VISIBLE_COLLECTIONS). Filtering on `isPublic === false` alone would
 * be STRICTER than the getters and would silently swallow a player's window on
 * their own private lore or character — both of which the wiki legitimately
 * lists to them.
 *
 * A ref that is denied simply has no entry in the returned map, which lets the
 * caller drop the window rather than render an untitled ghost.
 */
export async function hydratePrivateWindowRefs(
  refs: Array<{ collection: string; documentId: string }>,
  campaignId: string,
  opts: { isGM: boolean; userId: string }
): Promise<Record<string, HydratedDocument>> {
  const { isGM, userId } = opts;

  // GM-only collections are never fetched for a player in the first place.
  const allowed = refs.filter((ref) => canHydratePrivately(ref.collection, isGM));

  // `privateViewerUserId` switches hydrateRefs onto the private-path filter,
  // which sees each raw doc (including `createdBy`, which never reaches the
  // client) and so can apply the creator exception the getters grant.
  return hydrateRefs(allowed, campaignId, {
    isGM,
    privateViewerUserId: isGM ? undefined : userId,
  });
}

/**
 * Batch-hydrate a set of `{ collection, documentId }` refs.
 * Groups by collection, fetches each batch, and returns a lookup map
 * keyed by `"collection:documentId"`.
 *
 * `privateViewerUserId` is set only by `hydratePrivateWindowRefs` for a non-GM
 * viewer; it swaps the loose shared-window filter for the strict private-path
 * one. The shared path's behaviour is unchanged when it is absent.
 */
export async function hydrateRefs(
  refs: Array<{ collection: string; documentId: string }>,
  campaignId: string,
  opts: { isGM?: boolean; privateViewerUserId?: string } = {}
): Promise<Record<string, HydratedDocument>> {
  const isGM = opts.isGM ?? true;
  const { privateViewerUserId } = opts;
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
        if (!isGM) {
          if (privateViewerUserId !== undefined) {
            // Private path: mirror the sanctioned getters exactly — public, or
            // the viewer's own doc in a creator-visible collection.
            if (!isVisibleOnPrivatePath(collectionName, doc, privateViewerUserId)) continue;
          } else {
            // Shared path, unchanged. Events can carry private GM content; never
            // hydrate a non-public event for a non-GM viewer, or its
            // title/content would leak on a shared screen.
            if (collectionName === 'events' && doc.isPublic === false) continue;
            if (collectionName === 'organization' && doc.isPublic === false) continue;
            if (collectionName === 'quest' && doc.isPublic === false) continue;
          }
        }
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
