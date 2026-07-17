import { z } from 'zod';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { serverCaptureException, serverCaptureEvent } from '../utils/telemetry';
import { normalizeTags } from '../utils/helpers';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { ensureTags as ensureTagsFn } from './tags';
import { pruneQuestRefs } from './quests';
import { Organization } from '../db/models/Organization';
import { OrganizationMembership } from '../db/models/OrganizationMembership';
import { Location } from '../db/models/Location';
import { Character } from '../db/models/Character';
import { Player } from '../db/models/Player';
import type {
  OrganizationData,
  OrganizationImage,
  OrganizationListItem,
  OrganizationLocationLink,
  OrganizationMembershipData,
  MemberKind,
} from '~/types/organization';
import type { PictureCrop } from '~/types/character';
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  deleteOrganizationSchema,
  getOrganizationSchema,
  listOrganizationsSchema,
  addMembershipSchema,
  updateMembershipSchema,
  removeMembershipSchema,
  listMembershipsForOrgSchema,
  listMembershipsForMemberSchema,
} from '~/types/schemas/organizations';

type AnyDoc = Record<string, unknown> & { _id: unknown };

function iso(d: unknown): string {
  return d instanceof Date ? d.toISOString() : '';
}

async function resolveLocationLabels(
  raw: Array<Record<string, unknown>>,
  isGM: boolean
): Promise<OrganizationLocationLink[]> {
  return Promise.all(
    raw.map(async (l) => {
      let label = '';
      try {
        const loc = (await Location.findById(String(l.locationId), 'name').lean()) as AnyDoc | null;
        if (loc) label = String(loc.name ?? '');
      } catch {
        label = '';
      }
      return {
        locationId: String(l.locationId),
        label,
        publicInfo: (l.publicInfo as string) ?? '',
        privateInfo: isGM ? ((l.privateInfo as string) ?? '') : '',
      };
    })
  );
}

// Images are public — never gated on isGM (unlike privateInfo/locations.privateInfo).
function serializeImages(raw: unknown): OrganizationImage[] {
  return ((raw as unknown[]) ?? []).map((i) => {
    const img = i as Record<string, unknown>;
    return {
      url: String(img.url),
      caption: (img.caption as string) ?? '',
      crop: (img.crop as unknown as PictureCrop) ?? null,
    };
  });
}

// Cap on list result sizes — a safety bound against a pathological campaign.
// Real D&D campaigns hold far fewer orgs/members than this.
const LIST_LIMIT = 500;

function fullName(doc: AnyDoc): string {
  return `${doc.firstName ?? ''} ${doc.lastName ?? ''}`.trim();
}

// Resolve a single member's display name, scoped to the campaign so an id from
// another campaign can never resolve (defense-in-depth alongside the existence
// check in addMembership).
async function resolveMemberLabel(
  kind: MemberKind,
  id: string,
  campaignId: string
): Promise<string> {
  try {
    // Two explicit branches rather than a shared `model` variable: unioning a
    // typed Model with an untyped one collapses the query's filter type, so
    // this keeps each call concretely typed instead of casting around it.
    const doc = (
      kind === 'character'
        ? await Character.findOne({ _id: id, campaignId }, 'firstName lastName').lean()
        : await Player.findOne({ _id: id, campaignId }, 'firstName lastName').lean()
    ) as AnyDoc | null;
    if (doc) return fullName(doc);
  } catch {
    /* ignore */
  }
  return '';
}

// Batch-resolve member labels for a roster in two queries (one per kind),
// avoiding an N+1 findById per membership. Keyed by `"${kind}:${id}"`.
async function resolveMemberLabels(
  docs: AnyDoc[],
  campaignId: string
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const charIds = docs.filter((d) => d.memberKind === 'character').map((d) => String(d.memberId));
  const playerIds = docs.filter((d) => d.memberKind === 'player').map((d) => String(d.memberId));
  try {
    const [chars, players] = (await Promise.all([
      charIds.length
        ? Character.find({ _id: { $in: charIds }, campaignId }, 'firstName lastName').lean()
        : Promise.resolve([]),
      playerIds.length
        ? Player.find({ _id: { $in: playerIds }, campaignId }, 'firstName lastName').lean()
        : Promise.resolve([]),
    ])) as [AnyDoc[], AnyDoc[]];
    for (const c of chars) labels.set(`character:${String(c._id)}`, fullName(c));
    for (const p of players) labels.set(`player:${String(p._id)}`, fullName(p));
  } catch {
    /* ignore — labels default to '' */
  }
  return labels;
}

// Verify a member (player or character) actually belongs to the campaign before
// it can be linked to an organization — prevents cross-campaign membership rows
// and the name disclosure that label resolution would otherwise leak.
async function memberExistsInCampaign(
  kind: MemberKind,
  id: string,
  campaignId: string
): Promise<boolean> {
  const model = kind === 'character' ? Character : Player;
  const exists = await model.exists({ _id: id, campaignId });
  return !!exists;
}

function serializeListItem(doc: AnyDoc, canEdit: boolean): OrganizationListItem {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    createdBy: String(doc.createdBy),
    name: (doc.name as string) ?? '',
    isPublic: Boolean(doc.isPublic),
    tags: (doc.tags as string[]) ?? [],
    canEdit,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

function serializeMembership(
  doc: AnyDoc,
  orgName: string,
  orgIsPublic: boolean,
  memberLabel: string,
  isGM: boolean,
  canEdit: boolean
): OrganizationMembershipData {
  return {
    id: String(doc._id),
    campaignId: String(doc.campaignId),
    organizationId: String(doc.organizationId),
    organizationName: orgName,
    organizationIsPublic: orgIsPublic,
    memberKind: doc.memberKind as MemberKind,
    memberId: String(doc.memberId),
    memberLabel,
    title: (doc.title as string) ?? '',
    publicNotes: (doc.publicNotes as string) ?? '',
    privateNotes: isGM ? ((doc.privateNotes as string) ?? '') : '',
    canEdit,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

// --- Organization CRUD ---

export const listOrganizations = async ({
  data,
}: {
  data: z.infer<typeof listOrganizationsSchema>;
}): Promise<OrganizationListItem[]> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const filter: Record<string, unknown> = { campaignId: data.campaignId };
    if (!member.isGM) filter.$or = [{ isPublic: true }, { createdBy: member.userId }];
    if (data.search) filter.$text = { $search: data.search };
    if (data.tags && data.tags.length > 0) {
      const normalized = [...new Set(normalizeTags(data.tags))];
      if (normalized.length > 0) filter.tags = { $all: normalized };
    }
    if (data.locationIds && data.locationIds.length > 0) {
      filter['locations.locationId'] = { $in: data.locationIds };
    }

    const docs = (await Organization.find(filter)
      .select('-publicInfo -privateInfo -images -locations')
      .sort({ updatedAt: -1 })
      .limit(LIST_LIMIT)
      .lean()) as AnyDoc[];

    return docs.map((d) =>
      serializeListItem(d, String(d.createdBy) === member.userId || member.isGM)
    );
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'listOrganizations' });
    throw e;
  }
};

export const getOrganization = async ({
  data,
}: {
  data: z.infer<typeof getOrganizationSchema>;
}): Promise<OrganizationData | null> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const doc = (await Organization.findById(data.id).lean()) as AnyDoc | null;
    if (!doc || String(doc.campaignId) !== data.campaignId) return null;

    const isCreator = String(doc.createdBy) === member.userId;
    if (!member.isGM && !isCreator && !doc.isPublic) return null;

    const locations = await resolveLocationLabels(
      (doc.locations as Array<Record<string, unknown>>) ?? [],
      member.isGM
    );

    return {
      id: String(doc._id),
      campaignId: String(doc.campaignId),
      createdBy: String(doc.createdBy),
      name: (doc.name as string) ?? '',
      publicInfo: (doc.publicInfo as string) ?? '',
      privateInfo: member.isGM ? ((doc.privateInfo as string) ?? '') : '',
      isPublic: Boolean(doc.isPublic),
      images: serializeImages(doc.images),
      tags: (doc.tags as string[]) ?? [],
      locations,
      canEdit: isCreator || member.isGM,
      createdAt: iso(doc.createdAt),
      updatedAt: iso(doc.updatedAt),
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'getOrganization' });
    throw e;
  }
};

export const createOrganization = async ({
  data,
}: {
  data: z.infer<typeof createOrganizationSchema>;
}): Promise<OrganizationData> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const finalTags = normalizeTags(data.tags ?? []);
    const locations = data.locations.map((l) => ({
      locationId: l.locationId,
      publicInfo: l.publicInfo,
      privateInfo: member.isGM ? l.privateInfo : '',
    }));

    const org = new Organization({
      campaignId: data.campaignId,
      createdBy: member.userId,
      name: data.name.trim(),
      publicInfo: data.publicInfo,
      privateInfo: member.isGM ? data.privateInfo : '',
      isPublic: data.isPublic,
      images: data.images,
      tags: finalTags,
      locations,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await org.save();

    if (finalTags.length > 0) {
      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
    }

    serverCaptureEvent(sessionUserId!, 'organization_created', {
      campaign_id: data.campaignId,
      organization_id: String(org._id),
    });

    const resolved = await resolveLocationLabels(locations, member.isGM);
    return {
      id: String(org._id),
      campaignId: data.campaignId,
      createdBy: member.userId,
      name: data.name.trim(),
      publicInfo: data.publicInfo,
      privateInfo: member.isGM ? data.privateInfo : '',
      isPublic: data.isPublic,
      images: data.images,
      tags: finalTags,
      locations: resolved,
      canEdit: true,
      createdAt: iso(org.createdAt),
      updatedAt: iso(org.updatedAt),
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'createOrganization' });
    throw e;
  }
};

export const updateOrganization = async ({
  data,
}: {
  data: z.infer<typeof updateOrganizationSchema>;
}): Promise<OrganizationData> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const existing = (await Organization.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean()) as AnyDoc | null;
    if (!existing) throw new Error('Organization not found');
    const isCreator = String(existing.createdBy) === member.userId;
    if (!member.isGM && !isCreator) throw new Error('Forbidden');

    const finalTags = normalizeTags(data.tags ?? []);

    // Preserve GM-only privateInfo per location for non-GM writers.
    const existingPriv = new Map<string, string>();
    for (const l of (existing.locations as Array<Record<string, unknown>>) ?? []) {
      existingPriv.set(String(l.locationId), (l.privateInfo as string) ?? '');
    }
    const locations = data.locations.map((l) => ({
      locationId: l.locationId,
      publicInfo: l.publicInfo,
      privateInfo: member.isGM ? l.privateInfo : (existingPriv.get(l.locationId) ?? ''),
    }));

    const set: Record<string, unknown> = {
      name: data.name.trim(),
      publicInfo: data.publicInfo,
      isPublic: data.isPublic,
      images: data.images,
      tags: finalTags,
      locations,
      updatedAt: new Date(),
    };
    if (member.isGM) set.privateInfo = data.privateInfo;

    const org = (await Organization.findOneAndUpdate(
      { _id: data.id, campaignId: data.campaignId },
      { $set: set },
      { new: true }
    ).lean()) as AnyDoc | null;
    if (!org) throw new Error('Organization not found');

    if (finalTags.length > 0) {
      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });
    }

    serverCaptureEvent(sessionUserId!, 'organization_updated', {
      campaign_id: data.campaignId,
      organization_id: data.id,
    });

    const resolved = await resolveLocationLabels(
      (org.locations as Array<Record<string, unknown>>) ?? [],
      member.isGM
    );
    return {
      id: String(org._id),
      campaignId: String(org.campaignId),
      createdBy: String(org.createdBy),
      name: (org.name as string) ?? '',
      publicInfo: (org.publicInfo as string) ?? '',
      privateInfo: member.isGM ? ((org.privateInfo as string) ?? '') : '',
      isPublic: Boolean(org.isPublic),
      images: serializeImages(org.images),
      tags: (org.tags as string[]) ?? [],
      locations: resolved,
      canEdit: isCreator || member.isGM,
      createdAt: iso(org.createdAt),
      updatedAt: iso(org.updatedAt),
    };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'updateOrganization' });
    throw e;
  }
};

export const deleteOrganization = async ({
  data,
}: {
  data: z.infer<typeof deleteOrganizationSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const org = (await Organization.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean()) as AnyDoc | null;
    if (!org) throw new Error('Organization not found');
    if (!member.isGM && String(org.createdBy) !== member.userId) throw new Error('Forbidden');

    await Organization.deleteOne({ _id: data.id, campaignId: data.campaignId });
    await OrganizationMembership.deleteMany({ organizationId: data.id });

    try {
      await removeDocumentRefsFromScreens(data.campaignId, 'organization', data.id);
    } catch (cleanupError) {
      serverCaptureException(cleanupError, sessionUserId, {
        action: 'deleteOrganization.cleanup',
        campaign_id: data.campaignId,
        organization_id: data.id,
      });
    }

    try {
      await pruneQuestRefs('organization', data.id, data.campaignId);
    } catch (cleanupError) {
      serverCaptureException(cleanupError, sessionUserId, {
        action: 'deleteOrganization.pruneQuests',
        campaign_id: data.campaignId,
        organization_id: data.id,
      });
    }

    serverCaptureEvent(sessionUserId!, 'organization_deleted', {
      campaign_id: data.campaignId,
      organization_id: data.id,
    });
    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'deleteOrganization' });
    throw e;
  }
};

// --- Membership helpers ---

async function loadOrgForMembership(organizationId: string, campaignId: string) {
  return (await Organization.findOne(
    { _id: organizationId, campaignId },
    '_id createdBy name isPublic'
  ).lean()) as AnyDoc | null;
}

// --- Membership CRUD ---

export const addMembership = async ({
  data,
}: {
  data: z.infer<typeof addMembershipSchema>;
}): Promise<OrganizationMembershipData> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const org = await loadOrgForMembership(data.organizationId, data.campaignId);
    if (!org) throw new Error('Organization not found');
    if (!member.isGM && String(org.createdBy) !== member.userId) throw new Error('Forbidden');

    if (!(await memberExistsInCampaign(data.memberKind, data.memberId, data.campaignId))) {
      throw new Error('Member not found');
    }

    const doc = await OrganizationMembership.create({
      organizationId: data.organizationId,
      memberKind: data.memberKind,
      memberId: data.memberId,
      title: data.title,
      publicNotes: data.publicNotes,
      privateNotes: member.isGM ? data.privateNotes : '',
      campaignId: data.campaignId,
      createdBy: member.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const label = await resolveMemberLabel(data.memberKind, data.memberId, data.campaignId);
    return serializeMembership(
      doc as unknown as AnyDoc,
      String(org.name ?? ''),
      Boolean(org.isPublic),
      label,
      member.isGM,
      true
    );
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'addMembership' });
    throw e;
  }
};

export const updateMembership = async ({
  data,
}: {
  data: z.infer<typeof updateMembershipSchema>;
}): Promise<OrganizationMembershipData> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const existing = (await OrganizationMembership.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean()) as AnyDoc | null;
    if (!existing) throw new Error('Membership not found');

    const org = await loadOrgForMembership(String(existing.organizationId), data.campaignId);
    if (!org) throw new Error('Organization not found');
    if (!member.isGM && String(org.createdBy) !== member.userId) throw new Error('Forbidden');

    const set: Record<string, unknown> = {
      title: data.title,
      publicNotes: data.publicNotes,
      updatedAt: new Date(),
    };
    if (member.isGM) set.privateNotes = data.privateNotes;

    const doc = (await OrganizationMembership.findOneAndUpdate(
      { _id: data.id, campaignId: data.campaignId },
      { $set: set },
      { new: true }
    ).lean()) as AnyDoc | null;
    if (!doc) throw new Error('Membership not found');

    const label = await resolveMemberLabel(
      doc.memberKind as MemberKind,
      String(doc.memberId),
      data.campaignId
    );
    return serializeMembership(
      doc,
      String(org.name ?? ''),
      Boolean(org.isPublic),
      label,
      member.isGM,
      member.isGM || String(org.createdBy) === member.userId
    );
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'updateMembership' });
    throw e;
  }
};

export const removeMembership = async ({
  data,
}: {
  data: z.infer<typeof removeMembershipSchema>;
}) => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const existing = (await OrganizationMembership.findOne({
      _id: data.id,
      campaignId: data.campaignId,
    }).lean()) as AnyDoc | null;
    if (!existing) throw new Error('Membership not found');

    const org = await loadOrgForMembership(String(existing.organizationId), data.campaignId);
    if (!member.isGM && (!org || String(org.createdBy) !== member.userId))
      throw new Error('Forbidden');

    await OrganizationMembership.deleteOne({ _id: data.id, campaignId: data.campaignId });
    return { success: true };
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'removeMembership' });
    throw e;
  }
};

export const listMembershipsForOrg = async ({
  data,
}: {
  data: z.infer<typeof listMembershipsForOrgSchema>;
}): Promise<OrganizationMembershipData[]> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const org = await loadOrgForMembership(data.organizationId, data.campaignId);
    if (!org) return [];
    const isCreator = String(org.createdBy) === member.userId;
    if (!member.isGM && !isCreator && !org.isPublic) return [];
    const canEdit = member.isGM || isCreator;

    const docs = (await OrganizationMembership.find({
      organizationId: data.organizationId,
      campaignId: data.campaignId,
    })
      .limit(LIST_LIMIT)
      .lean()) as AnyDoc[];

    const labels = await resolveMemberLabels(docs, data.campaignId);
    return docs.map((d) =>
      serializeMembership(
        d,
        String(org.name ?? ''),
        Boolean(org.isPublic),
        labels.get(`${d.memberKind}:${String(d.memberId)}`) ?? '',
        member.isGM,
        canEdit
      )
    );
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'listMembershipsForOrg' });
    throw e;
  }
};

export const listMembershipsForMember = async ({
  data,
}: {
  data: z.infer<typeof listMembershipsForMemberSchema>;
}): Promise<OrganizationMembershipData[]> => {
  let sessionUserId: string | undefined;
  try {
    const member = await requireCampaignMember(data.campaignId);
    sessionUserId = member.sessionUserId;

    const docs = (await OrganizationMembership.find({
      campaignId: data.campaignId,
      memberKind: data.memberKind,
      memberId: data.memberId,
    })
      .limit(LIST_LIMIT)
      .lean()) as AnyDoc[];
    if (docs.length === 0) return [];

    const orgIds = [...new Set(docs.map((d) => String(d.organizationId)))];
    const orgs = (await Organization.find(
      { _id: { $in: orgIds }, campaignId: data.campaignId },
      '_id name isPublic createdBy'
    ).lean()) as AnyDoc[];
    const orgMap = new Map(orgs.map((o) => [String(o._id), o]));

    const label = await resolveMemberLabel(data.memberKind, data.memberId, data.campaignId);

    const results: OrganizationMembershipData[] = [];
    for (const d of docs) {
      const org = orgMap.get(String(d.organizationId));
      if (!org) continue; // org deleted — skip stale membership
      // Non-GM only sees memberships to public orgs.
      if (!member.isGM && !org.isPublic) continue;
      const canEdit = member.isGM || String(org.createdBy) === member.userId;
      results.push(
        serializeMembership(
          d,
          String(org.name ?? ''),
          Boolean(org.isPublic),
          label,
          member.isGM,
          canEdit
        )
      );
    }
    return results;
  } catch (e) {
    serverCaptureException(e, sessionUserId, { action: 'listMembershipsForMember' });
    throw e;
  }
};

// Used by player/character delete flows (Task 6).
export async function pruneMembershipsForMember(
  memberKind: MemberKind,
  memberId: string,
  campaignId: string
): Promise<void> {
  await OrganizationMembership.deleteMany({ memberKind, memberId, campaignId });
}
