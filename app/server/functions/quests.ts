import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { normalizeTags } from '../utils/helpers';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { ensureTags as ensureTagsFn } from './tags';
import { Quest } from '../db/models/Quest';
import { Character } from '../db/models/Character';
import { Player } from '../db/models/Player';
import { Location } from '../db/models/Location';
import { Organization } from '../db/models/Organization';
import { Event } from '../db/models/Event';
import type {
  QuestData,
  QuestListItem,
  QuestImage,
  QuestGiver,
  QuestLink,
  QuestEventLink,
  QuestSummary,
  QuestStatus,
  QuestGiverKind,
  QuestLinkKind,
} from '~/types/quest';
import type { PictureCrop } from '~/types/character';
import {
  createQuestSchema,
  updateQuestSchema,
  deleteQuestSchema,
  getQuestSchema,
  listQuestsSchema,
  listQuestsForEntitySchema,
} from '~/types/schemas/quests';

type AnyDoc = Record<string, unknown> & { _id: unknown };
const LIST_LIMIT = 500;

function iso(d: unknown): string {
  return d instanceof Date ? d.toISOString() : '';
}
function fullName(doc: AnyDoc): string {
  return `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim();
}

function serializeImages(raw: unknown): QuestImage[] {
  return ((raw as unknown[]) ?? []).map((i) => {
    const img = i as Record<string, unknown>;
    return {
      url: String(img.url),
      caption: (img.caption as string) ?? '',
      crop: (img.crop as unknown as PictureCrop) ?? null,
    };
  });
}

// Resolve a display label for one polymorphic entity, scoped to the campaign.
async function resolveEntityLabel(
  kind: QuestGiverKind | QuestLinkKind,
  id: string,
  campaignId: string
): Promise<string> {
  try {
    if (kind === 'character' || kind === 'player') {
      const model = kind === 'character' ? Character : Player;
      const doc = (await model
        .findOne({ _id: id, campaignId }, 'firstName lastName')
        .lean()) as AnyDoc | null;
      return doc ? fullName(doc) : '';
    }
    if (kind === 'location') {
      const doc = (await Location.findOne({ _id: id, campaignId }, 'name').lean()) as AnyDoc | null;
      return doc ? String(doc.name ?? '') : '';
    }
    const doc = (await Organization.findOne(
      { _id: id, campaignId },
      'name'
    ).lean()) as AnyDoc | null;
    return doc ? String(doc.name ?? '') : '';
  } catch {
    return '';
  }
}

async function resolveGiver(
  raw: Record<string, unknown> | null | undefined,
  campaignId: string
): Promise<QuestGiver | null> {
  if (!raw || !raw.kind || !raw.id) return null;
  const kind = raw.kind as QuestGiverKind;
  const id = String(raw.id);
  const label = await resolveEntityLabel(kind, id, campaignId);
  return { kind, id, label };
}

async function resolveLinks(
  raw: Array<Record<string, unknown>>,
  isGM: boolean,
  campaignId: string
): Promise<QuestLink[]> {
  return Promise.all(
    (raw ?? []).map(async (l) => {
      const kind = l.kind as QuestLinkKind;
      const id = String(l.id);
      return {
        kind,
        id,
        label: await resolveEntityLabel(kind, id, campaignId),
        role: (l.role as string) ?? '',
        publicInfo: (l.publicInfo as string) ?? '',
        privateInfo: isGM ? ((l.privateInfo as string) ?? '') : '',
      };
    })
  );
}

async function resolveEvents(
  raw: Array<Record<string, unknown>>,
  isGM: boolean,
  campaignId: string
): Promise<QuestEventLink[]> {
  const resolved = await Promise.all(
    (raw ?? []).map(async (e): Promise<QuestEventLink | null> => {
      const eventId = String(e.eventId);
      let label = '';
      let dropForNonGM = false;
      try {
        const ev = (await Event.findOne(
          { _id: eventId, campaignId },
          'title isPublic'
        ).lean()) as AnyDoc | null;
        if (ev) {
          label = String(ev.title ?? '');
          // A private event's title/content is GM-only (mirrors
          // tabletop-hydration's `!isGM && isPublic === false` gate) — never
          // let a non-GM viewer see the title of an event they can't open.
          if (!isGM && ev.isPublic === false) dropForNonGM = true;
        }
      } catch {
        label = '';
      }
      if (dropForNonGM) return null;
      return {
        eventId,
        label,
        role: (e.role as string) ?? '',
        publicInfo: (e.publicInfo as string) ?? '',
        privateInfo: isGM ? ((e.privateInfo as string) ?? '') : '',
      };
    })
  );
  return resolved.filter((e): e is QuestEventLink => e !== null);
}

function questVisibilityFilter(member: { isGM: boolean; userId: string }) {
  return member.isGM ? {} : { $or: [{ isPublic: true }, { createdBy: member.userId }] };
}

async function resolveSubQuests(
  parentId: string,
  campaignId: string,
  member: { isGM: boolean; userId: string }
): Promise<QuestSummary[]> {
  const docs = (await Quest.find(
    { campaignId, parentQuestId: parentId, ...questVisibilityFilter(member) },
    '_id name status'
  )
    .limit(LIST_LIMIT)
    .lean()) as AnyDoc[];
  return docs.map((d) => ({
    id: String(d._id),
    name: (d.name as string) ?? '',
    status: (d.status as QuestStatus) ?? 'not_started',
  }));
}

async function resolveParentSummary(
  parentQuestId: string | null,
  campaignId: string,
  member: { isGM: boolean; userId: string }
): Promise<QuestSummary | null> {
  if (!parentQuestId) return null;
  const d = (await Quest.findOne(
    { _id: parentQuestId, campaignId, ...questVisibilityFilter(member) },
    '_id name status'
  ).lean()) as AnyDoc | null;
  if (!d) return null;
  return {
    id: String(d._id),
    name: (d.name as string) ?? '',
    status: (d.status as QuestStatus) ?? 'not_started',
  };
}

function serializeListItem(doc: AnyDoc, canEdit: boolean): QuestListItem {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    createdBy: String(doc.createdBy),
    name: (doc.name as string) ?? '',
    type: (doc.type as string) ?? '',
    status: (doc.status as QuestStatus) ?? 'not_started',
    isPublic: Boolean(doc.isPublic),
    tags: (doc.tags as string[]) ?? [],
    canEdit,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

async function serializeQuest(
  doc: AnyDoc,
  member: { isGM: boolean; userId: string },
  campaignId: string
): Promise<QuestData> {
  const [giver, links, events, parentQuest, subQuests] = await Promise.all([
    resolveGiver(doc.giver as Record<string, unknown> | null, campaignId),
    resolveLinks((doc.links as Array<Record<string, unknown>>) ?? [], member.isGM, campaignId),
    resolveEvents((doc.events as Array<Record<string, unknown>>) ?? [], member.isGM, campaignId),
    resolveParentSummary(doc.parentQuestId ? String(doc.parentQuestId) : null, campaignId, member),
    resolveSubQuests(String(doc._id), campaignId, member),
  ]);
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    createdBy: String(doc.createdBy),
    name: (doc.name as string) ?? '',
    type: (doc.type as string) ?? '',
    status: (doc.status as QuestStatus) ?? 'not_started',
    publicInfo: (doc.publicInfo as string) ?? '',
    privateInfo: member.isGM ? ((doc.privateInfo as string) ?? '') : '',
    isPublic: Boolean(doc.isPublic),
    giver,
    parentQuestId: doc.parentQuestId ? String(doc.parentQuestId) : null,
    parentQuest,
    subQuests,
    links,
    events,
    images: serializeImages(doc.images),
    tags: (doc.tags as string[]) ?? [],
    canEdit: member.isGM || String(doc.createdBy) === member.userId,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

// Strip GM-only privateInfo out of an incoming links array for a non-GM writer,
// preserving existing private values by matching on kind+id.
function mergeLinkPrivate(
  incoming: Array<{
    kind: string;
    id: string;
    role: string;
    publicInfo: string;
    privateInfo: string;
  }>,
  existing: Array<Record<string, unknown>>,
  isGM: boolean
) {
  const priv = new Map<string, string>();
  for (const l of existing ?? [])
    priv.set(`${l.kind}:${String(l.id)}`, (l.privateInfo as string) ?? '');
  return incoming.map((l) => ({
    kind: l.kind,
    id: l.id,
    role: l.role,
    publicInfo: l.publicInfo,
    privateInfo: isGM ? l.privateInfo : (priv.get(`${l.kind}:${l.id}`) ?? ''),
  }));
}
async function mergeEventPrivate(
  incoming: Array<{ eventId: string; role: string; publicInfo: string; privateInfo: string }>,
  existing: Array<Record<string, unknown>>,
  isGM: boolean,
  campaignId: string
): Promise<Array<{ eventId: string; role: string; publicInfo: string; privateInfo: string }>> {
  const priv = new Map<string, string>();
  for (const e of existing ?? []) priv.set(String(e.eventId), (e.privateInfo as string) ?? '');
  const merged = incoming.map((e) => ({
    eventId: e.eventId,
    role: e.role,
    publicInfo: e.publicInfo,
    privateInfo: isGM ? e.privateInfo : (priv.get(e.eventId) ?? ''),
  }));
  if (isGM) return merged;

  // resolveEvents drops links to private events from what a non-GM viewer is
  // shown, so a non-GM writer's submitted `events` array never mentions them
  // — their absence means "never seen", not "deliberately removed". Re-add
  // any existing event link omitted from the payload whose event is private
  // (or no longer resolves at all — fail closed rather than silently
  // deleting data the writer couldn't have seen).
  const incomingIds = new Set(incoming.map((e) => e.eventId));
  const omitted = (existing ?? []).filter((e) => !incomingIds.has(String(e.eventId)));
  if (omitted.length === 0) return merged;

  const preserved: typeof merged = [];
  for (const e of omitted) {
    const eventId = String(e.eventId);
    let isPublic = false;
    try {
      const ev = (await Event.findOne(
        { _id: eventId, campaignId },
        'isPublic'
      ).lean()) as AnyDoc | null;
      isPublic = ev ? Boolean(ev.isPublic) : false;
    } catch {
      isPublic = false;
    }
    if (!isPublic) {
      preserved.push({
        eventId,
        role: (e.role as string) ?? '',
        publicInfo: (e.publicInfo as string) ?? '',
        privateInfo: (e.privateInfo as string) ?? '',
      });
    }
  }
  return [...merged, ...preserved];
}

export const listQuests = async ({
  data,
}: {
  data: z.infer<typeof listQuestsSchema>;
}): Promise<QuestListItem[]> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const filter: Record<string, unknown> = { campaignId: data.campaignId };
    if (!member.isGM) filter.$or = [{ isPublic: true }, { createdBy: member.userId }];
    if (data.search) filter.$text = { $search: data.search };
    if (data.status) filter.status = data.status;
    if (data.tags && data.tags.length > 0) {
      const normalized = [...new Set(normalizeTags(data.tags))];
      if (normalized.length > 0) filter.tags = { $all: normalized };
    }

    const docs = (await Quest.find(filter)
      .select('-publicInfo -privateInfo -images -links -events')
      .sort({ updatedAt: -1 })
      .limit(LIST_LIMIT)
      .lean()) as AnyDoc[];

    return docs.map((d) =>
      serializeListItem(d, member.isGM || String(d.createdBy) === member.userId)
    );
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'listQuests' });
    throw e;
  }
};

export const getQuest = async ({
  data,
}: {
  data: z.infer<typeof getQuestSchema>;
}): Promise<QuestData | null> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const doc = (await Quest.findById(data.id).lean()) as AnyDoc | null;
    if (!doc || String(doc.campaignId) !== data.campaignId) return null;
    const isCreator = String(doc.createdBy) === member.userId;
    if (!member.isGM && !isCreator && !doc.isPublic) return null;

    return serializeQuest(doc, member, data.campaignId);
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'getQuest' });
    throw e;
  }
};

export const createQuest = async ({
  data,
}: {
  data: z.infer<typeof createQuestSchema>;
}): Promise<QuestData> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const finalTags = normalizeTags(data.tags ?? []);
    const links = data.links.map((l) => ({
      kind: l.kind,
      id: l.id,
      role: l.role,
      publicInfo: l.publicInfo,
      privateInfo: member.isGM ? l.privateInfo : '',
    }));
    const events = data.events.map((e) => ({
      eventId: e.eventId,
      role: e.role,
      publicInfo: e.publicInfo,
      privateInfo: member.isGM ? e.privateInfo : '',
    }));

    const quest = new Quest({
      campaignId: data.campaignId,
      createdBy: member.userId,
      name: data.name.trim(),
      type: data.type,
      status: data.status,
      publicInfo: data.publicInfo,
      privateInfo: member.isGM ? data.privateInfo : '',
      isPublic: data.isPublic,
      giver: data.giver,
      parentQuestId: data.parentQuestId,
      links,
      events,
      images: data.images,
      tags: finalTags,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await quest.save();

    if (finalTags.length > 0) {
      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
    }
    serverCaptureEvent(sessionUserId!, 'quest_created', {
      campaign_id: data.campaignId,
      quest_id: String(quest._id),
    });

    return serializeQuest(quest.toObject() as AnyDoc, member, data.campaignId);
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'createQuest' });
    throw e;
  }
};

export const updateQuest = async ({
  data,
}: {
  data: z.infer<typeof updateQuestSchema>;
}): Promise<QuestData> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const existing = (await Quest.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean()) as AnyDoc | null;
    if (!existing) throw new Error('Quest not found');
    const isCreator = String(existing.createdBy) === member.userId;
    if (!member.isGM && !isCreator) throw new Error('Forbidden');

    const finalTags = normalizeTags(data.tags ?? []);
    const links = mergeLinkPrivate(
      data.links,
      (existing.links as Array<Record<string, unknown>>) ?? [],
      member.isGM
    );
    const events = await mergeEventPrivate(
      data.events,
      (existing.events as Array<Record<string, unknown>>) ?? [],
      member.isGM,
      data.campaignId
    );

    const set: Record<string, unknown> = {
      name: data.name.trim(),
      type: data.type,
      status: data.status,
      publicInfo: data.publicInfo,
      isPublic: data.isPublic,
      giver: data.giver,
      parentQuestId: data.parentQuestId,
      links,
      events,
      images: data.images,
      tags: finalTags,
      updatedAt: new Date(),
    };
    if (member.isGM) set.privateInfo = data.privateInfo;

    const quest = (await Quest.findOneAndUpdate(
      { _id: data.id, campaignId: data.campaignId },
      { $set: set },
      { new: true }
    ).lean()) as AnyDoc | null;
    if (!quest) throw new Error('Quest not found');

    if (finalTags.length > 0) {
      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
    }
    serverCaptureEvent(sessionUserId!, 'quest_updated', {
      campaign_id: data.campaignId,
      quest_id: data.id,
    });

    return serializeQuest(quest, member, data.campaignId);
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'updateQuest' });
    throw e;
  }
};

export const deleteQuest = async ({ data }: { data: z.infer<typeof deleteQuestSchema> }) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const quest = (await Quest.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean()) as AnyDoc | null;
    if (!quest) throw new Error('Quest not found');
    if (!member.isGM && String(quest.createdBy) !== member.userId) throw new Error('Forbidden');

    await Quest.deleteOne({ _id: data.id, campaignId: data.campaignId });
    // Re-parent children to top-level rather than deleting them.
    await Quest.updateMany(
      { campaignId: data.campaignId, parentQuestId: data.id },
      { $set: { parentQuestId: null } }
    );

    try {
      await removeDocumentRefsFromScreens(data.campaignId, 'quest', data.id);
    } catch (cleanupError) {
      serverCaptureException(cleanupError, sessionUserId, {
        action: 'deleteQuest.cleanup',
        campaign_id: data.campaignId,
        quest_id: data.id,
      });
    }

    serverCaptureEvent(sessionUserId!, 'quest_deleted', {
      campaign_id: data.campaignId,
      quest_id: data.id,
    });
    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'deleteQuest' });
    throw e;
  }
};

export const listQuestsForEntity = async ({
  data,
}: {
  data: z.infer<typeof listQuestsForEntitySchema>;
}): Promise<QuestListItem[]> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const matchRef: Record<string, unknown> = {
      $or: [
        { links: { $elemMatch: { kind: data.kind, id: data.id } } },
        ...(data.kind === 'location' ? [] : [{ 'giver.kind': data.kind, 'giver.id': data.id }]),
      ],
    };
    const filter: Record<string, unknown> = { campaignId: data.campaignId, ...matchRef };
    if (!member.isGM) {
      filter.$and = [{ $or: [{ isPublic: true }, { createdBy: member.userId }] }];
    }

    const docs = (await Quest.find(filter)
      .select('-publicInfo -privateInfo -images -links -events')
      .sort({ updatedAt: -1 })
      .limit(LIST_LIMIT)
      .lean()) as AnyDoc[];
    return docs.map((d) =>
      serializeListItem(d, member.isGM || String(d.createdBy) === member.userId)
    );
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'listQuestsForEntity' });
    throw e;
  }
};

// Called from entity delete flows (Task 4) to drop dangling references.
export async function pruneQuestRefs(
  kind: 'character' | 'player' | 'location' | 'organization' | 'event',
  id: string,
  campaignId: string
): Promise<void> {
  if (kind === 'event') {
    await Quest.updateMany(
      { campaignId, 'events.eventId': id },
      { $pull: { events: { eventId: id } } }
    );
    return;
  }
  await Quest.updateMany({ campaignId, 'links.id': id }, { $pull: { links: { kind, id } } });
  if (kind === 'character' || kind === 'player' || kind === 'organization') {
    await Quest.updateMany(
      { campaignId, 'giver.kind': kind, 'giver.id': id },
      { $set: { giver: null } }
    );
  }
}
