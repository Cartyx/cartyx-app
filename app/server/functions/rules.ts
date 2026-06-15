import { createServerFn } from '@tanstack/react-start';
import { getSession } from '../session';
import { connectDB, isDBConnected } from '../db/connection';
import { User } from '../db/models/User';
import { Campaign } from '../db/models/Campaign';
import { requireCampaignMember } from '../utils/requireCampaignMember';
import { Rule } from '../db/models/Rule';
import { serverCaptureException, serverCaptureEvent } from '../utils/posthog';
import { normalizeTags } from '../utils/helpers';
import { removeDocumentRefsFromScreens } from './gmscreens-helpers';
import { ensureTags as ensureTagsFn } from './tags';
import type { RuleData, RuleListItem } from '~/types/rule';
import {
  createRuleSchema,
  updateRuleSchema,
  deleteRuleSchema,
  listRulesSchema,
  getRuleSchema,
} from '~/types/schemas/rules';

function serializeRule(r: {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  title?: string;
  content?: string;
  tags?: string[];
  isPublic?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}): RuleData {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    createdBy: String(r.createdBy),
    title: r.title ?? '',
    content: r.content ?? '',
    tags: r.tags ?? [],
    isPublic: r.isPublic ?? false,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : '',
  };
}

function serializeRuleListItem(r: {
  _id: unknown;
  campaignId: unknown;
  createdBy: unknown;
  title?: string;
  tags?: string[];
  isPublic?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}): RuleListItem {
  return {
    id: String(r._id),
    campaignId: String(r.campaignId),
    createdBy: String(r.createdBy),
    title: r.title ?? '',
    tags: r.tags ?? [],
    isPublic: r.isPublic ?? false,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : '',
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : '',
  };
}

/**
 * Verify the authenticated user is a GM for the given campaign.
 * Any GM can create, edit, or delete rules — no per-creator ownership.
 */
async function requireCampaignGM(
  campaignId: string
): Promise<{ userId: string; sessionUserId: string }> {
  const user = await getSession();
  if (!user) throw new Error('Not authenticated');

  await connectDB();
  if (!isDBConnected()) throw new Error('Database not available');

  const dbUser = await User.findOne({ providerId: user.id });
  if (!dbUser) throw new Error('User not found');

  const campaign = await Campaign.findById(campaignId);
  if (!campaign) throw new Error('Campaign not found');

  const userId = String(dbUser._id);
  const members = campaign.members ?? [];
  const isGM =
    String(campaign.gameMasterId) === userId ||
    members.some(
      (m: { userId: unknown; role?: string }) => String(m.userId) === userId && m.role === 'gm'
    );
  if (!isGM) throw new Error('Forbidden');

  return { userId, sessionUserId: user.id };
}

// ---------------------------------------------------------------------------
// createRule
// ---------------------------------------------------------------------------

export { createRuleSchema };

export const createRule = createServerFn({ method: 'POST' })
  .inputValidator(createRuleSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;
      const userId = gm.userId;

      const now = new Date();
      const finalTags = normalizeTags(data.tags ?? []);
      const ruleData: Record<string, unknown> = {
        campaignId: data.campaignId,
        createdBy: userId,
        title: data.title.trim(),
        content: data.content.trim(),
        tags: finalTags,
        isPublic: data.isPublic ?? false,
        createdAt: now,
        updatedAt: now,
      };
      const doc = await Rule.create(ruleData);

      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

      serverCaptureEvent(sessionUserId, 'rule_created', {
        campaign_id: data.campaignId,
        rule_id: String(doc._id),
      });

      return { success: true, rule: serializeRule(doc) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'createRule',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// updateRule
// ---------------------------------------------------------------------------

export { updateRuleSchema };

export const updateRule = createServerFn({ method: 'POST' })
  .inputValidator(updateRuleSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;
      const userId = gm.userId;

      const existing = await Rule.findById(data.id);
      if (!existing) throw new Error('Rule not found');
      if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');

      const finalTags = normalizeTags(data.tags ?? []);
      existing.title = data.title.trim();
      existing.content = data.content.trim();
      existing.tags = finalTags;
      if (data.isPublic !== undefined) {
        existing.isPublic = data.isPublic;
      }
      existing.updatedAt = new Date();
      await existing.save();

      await ensureTagsFn({ data: { campaignId: data.campaignId, tags: finalTags } });

      serverCaptureEvent(sessionUserId, 'rule_updated', {
        campaign_id: data.campaignId,
        rule_id: data.id,
        updated_by: userId,
      });

      return { success: true, rule: serializeRule(existing) };
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'updateRule', ruleId: data.id });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// deleteRule
// ---------------------------------------------------------------------------

export { deleteRuleSchema };

export const deleteRule = createServerFn({ method: 'POST' })
  .inputValidator(deleteRuleSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const gm = await requireCampaignGM(data.campaignId);
      sessionUserId = gm.sessionUserId;
      const userId = gm.userId;

      const existing = await Rule.findById(data.id);
      if (!existing) throw new Error('Rule not found');
      if (String(existing.campaignId) !== data.campaignId) throw new Error('Forbidden');

      await existing.deleteOne();

      // Clean up GM Screen references to this rule.
      // Best-effort: the rule is already deleted, so cleanup failure must not
      // surface as a user-facing error — report it and move on.
      try {
        await removeDocumentRefsFromScreens(data.campaignId, 'rule', data.id);
      } catch (cleanupError) {
        serverCaptureException(cleanupError, sessionUserId, {
          action: 'deleteRule.cleanup',
          campaignId: data.campaignId,
          ruleId: data.id,
        });
      }

      serverCaptureEvent(sessionUserId, 'rule_deleted', {
        campaign_id: data.campaignId,
        rule_id: data.id,
        deleted_by: userId,
      });

      return { success: true };
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'deleteRule', ruleId: data.id });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// listRules
// ---------------------------------------------------------------------------

export { listRulesSchema };

export const listRules = createServerFn({ method: 'GET' })
  .inputValidator(listRulesSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const filter: Record<string, unknown> = { campaignId: data.campaignId };

      if (member.isGM) {
        if (data.visibility === 'public') {
          filter.isPublic = true;
        } else if (data.visibility === 'private') {
          filter.isPublic = false;
        }
      } else {
        filter.isPublic = true;
      }

      if (data.search && data.search.trim()) {
        filter.$text = { $search: data.search.trim() };
      }

      if (data.tags && data.tags.length > 0) {
        const normalizedTags = [...new Set(normalizeTags(data.tags))];
        if (normalizedTags.length > 0) {
          filter.tags = { $all: normalizedTags };
        }
      }

      const docs = await Rule.find(filter).select('-content').sort({ updatedAt: -1 }).lean();

      return (
        docs as Array<{
          _id: unknown;
          campaignId: unknown;
          createdBy: unknown;
          title?: string;
          tags?: string[];
          isPublic?: boolean;
          createdAt?: Date;
          updatedAt?: Date;
        }>
      ).map(serializeRuleListItem);
    } catch (e) {
      serverCaptureException(e, sessionUserId, {
        action: 'listRules',
        campaignId: data.campaignId,
      });
      throw e;
    }
  });

// ---------------------------------------------------------------------------
// getRule
// ---------------------------------------------------------------------------

export { getRuleSchema };

export const getRule = createServerFn({ method: 'GET' })
  .inputValidator(getRuleSchema)
  .handler(async ({ data }) => {
    let sessionUserId: string | undefined;
    try {
      const member = await requireCampaignMember(data.campaignId);
      sessionUserId = member.sessionUserId;

      const doc = await Rule.findById(data.id);
      if (!doc) return null;
      if (String(doc.campaignId) !== data.campaignId) return null;

      if (!doc.isPublic && !member.isGM) {
        return null;
      }

      return serializeRule(doc);
    } catch (e) {
      serverCaptureException(e, sessionUserId, { action: 'getRule', ruleId: data.id });
      throw e;
    }
  });
