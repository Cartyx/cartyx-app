import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: unknown) => fn,
    }),
    handler: (fn: unknown) => fn,
  }),
}));

vi.mock('~/server/session', () => ({ getSession: vi.fn() }));
vi.mock('~/server/db/connection', () => ({
  connectDB: vi.fn(),
  isDBConnected: vi.fn(() => true),
}));
vi.mock('~/server/db/models/User', () => ({
  User: { findOne: vi.fn() },
}));
vi.mock('~/server/db/models/Campaign', () => ({
  Campaign: { findById: vi.fn() },
}));
vi.mock('~/server/db/models/Rule', () => ({
  Rule: {
    create: vi.fn(),
    findById: vi.fn(),
    find: vi.fn(),
  },
}));
vi.mock('~/server/db/models/Tag', () => ({
  Tag: {
    bulkWrite: vi.fn().mockResolvedValue({}),
    find: vi.fn(),
  },
}));
vi.mock('~/server/functions/gmscreens-helpers', () => ({
  removeDocumentRefsFromScreens: vi.fn().mockResolvedValue(0),
}));

import { getSession } from '~/server/session';
import { User } from '~/server/db/models/User';
import { Campaign } from '~/server/db/models/Campaign';
import { Rule } from '~/server/db/models/Rule';
import {
  createRule,
  updateRule,
  deleteRule,
  listRules,
  getRule,
  createRuleSchema,
  updateRuleSchema,
  listRulesSchema,
} from '~/server/functions/rules';
import type { RuleListItem } from '~/types/rule';
import { removeDocumentRefsFromScreens } from '~/server/functions/gmscreens-helpers';

const mockSession = {
  id: 'session-user-1',
  provider: 'google',
  name: 'Test User',
  email: 'test@example.com',
  avatar: null,
  role: 'gm',
  accessToken: null,
  refreshToken: null,
  tokenIssuedAt: 0,
};
const mockDbUser = { _id: 'dbuser-1', firstName: 'Test', lastName: 'User' };
const mockGMCampaign = {
  _id: 'camp-1',
  gameMasterId: 'dbuser-1',
  members: [{ userId: 'dbuser-1', role: 'gm' }],
};
const mockPlayerCampaign = {
  _id: 'camp-1',
  gameMasterId: 'someone-else',
  members: [
    { userId: 'someone-else', role: 'gm' },
    { userId: 'dbuser-1', role: 'player' },
  ],
};

function makeRule(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'rule-1',
    campaignId: 'camp-1',
    createdBy: 'dbuser-1',
    title: 'Test Rule',
    content: '# Critical Hit\n\nDouble damage on nat 20.',
    tags: ['combat', 'damage'],
    isPublic: false,
    createdAt: new Date('2026-03-01'),
    updatedAt: new Date('2026-03-01'),
    save: vi.fn(),
    deleteOne: vi.fn(),
    ...overrides,
  };
}

// Cast server functions to callable handler signatures
const _createRule = createRule as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; rule: Record<string, unknown> }>;
const _updateRule = updateRule as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean; rule: Record<string, unknown> }>;
const _listRules = listRules as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<RuleListItem[]>;
const _deleteRule = deleteRule as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<{ success: boolean }>;
const _getRule = getRule as unknown as (args: {
  data: Record<string, unknown>;
}) => Promise<Record<string, unknown> | null>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSession).mockResolvedValue(mockSession);
  vi.mocked(User.findOne).mockResolvedValue(mockDbUser);
  vi.mocked(Campaign.findById).mockResolvedValue(mockGMCampaign);
});

// ---------------------------------------------------------------------------
// createRule
// ---------------------------------------------------------------------------

describe('createRule', () => {
  it('creates a rule with required fields and normalized tags', async () => {
    const created = makeRule();
    vi.mocked(Rule.create).mockResolvedValue(created as never);

    const result = await _createRule({
      data: {
        campaignId: 'camp-1',
        title: '  Critical Hit  ',
        content: '# Content',
        tags: [' Combat ', 'DAMAGE', ' combat '],
      },
    });

    expect(result.success).toBe(true);
    expect(result.rule.id).toBe('rule-1');
    expect(vi.mocked(Rule.create).mock.calls[0][0]).toMatchObject({
      title: 'Critical Hit',
      content: '# Content',
      tags: ['combat', 'damage'],
    });
  });

  it('defaults isPublic to false when omitted', async () => {
    vi.mocked(Rule.create).mockResolvedValue(makeRule() as never);

    await _createRule({
      data: { campaignId: 'camp-1', title: 'Rule', content: 'body' },
    });

    expect(vi.mocked(Rule.create).mock.calls[0][0]).toMatchObject({
      isPublic: false,
    });
  });

  it('allows explicitly setting isPublic to true', async () => {
    vi.mocked(Rule.create).mockResolvedValue(makeRule({ isPublic: true }) as never);

    await _createRule({
      data: { campaignId: 'camp-1', title: 'Public Rule', content: 'body', isPublic: true },
    });

    expect(vi.mocked(Rule.create).mock.calls[0][0]).toMatchObject({
      isPublic: true,
    });
  });

  it('throws when not authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(
      _createRule({ data: { campaignId: 'camp-1', title: 'T', content: 'B' } })
    ).rejects.toThrow('Not authenticated');
  });

  it('throws when user is not a GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);

    await expect(
      _createRule({ data: { campaignId: 'camp-1', title: 'T', content: 'B' } })
    ).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// updateRule
// ---------------------------------------------------------------------------

describe('updateRule', () => {
  it('updates an existing rule', async () => {
    const existing = makeRule();
    vi.mocked(Rule.findById).mockResolvedValue(existing as never);

    const result = await _updateRule({
      data: {
        id: 'rule-1',
        campaignId: 'camp-1',
        title: 'Updated Title',
        content: 'Updated body',
        tags: ['new-tag'],
      },
    });

    expect(result.success).toBe(true);
    expect(existing.save).toHaveBeenCalled();
    expect(existing.title).toBe('Updated Title');
    expect(existing.content).toBe('Updated body');
    expect(existing.tags).toEqual(['new-tag']);
  });

  it('allows any GM to edit any rule (no ownership check)', async () => {
    // Rule created by a different user, but current user is still a GM
    const existing = makeRule({ createdBy: 'other-gm-user' });
    vi.mocked(Rule.findById).mockResolvedValue(existing as never);

    const result = await _updateRule({
      data: {
        id: 'rule-1',
        campaignId: 'camp-1',
        title: 'Updated',
        content: 'Updated body',
      },
    });

    expect(result.success).toBe(true);
    expect(existing.save).toHaveBeenCalled();
  });

  it('throws when rule is not found', async () => {
    vi.mocked(Rule.findById).mockResolvedValue(null);

    await expect(
      _updateRule({
        data: { id: 'nonexistent', campaignId: 'camp-1', title: 'T', content: 'B' },
      })
    ).rejects.toThrow('Rule not found');
  });

  it('throws when rule belongs to a different campaign', async () => {
    const existing = makeRule({ campaignId: 'camp-other' });
    vi.mocked(Rule.findById).mockResolvedValue(existing as never);

    await expect(
      _updateRule({
        data: { id: 'rule-1', campaignId: 'camp-1', title: 'T', content: 'B' },
      })
    ).rejects.toThrow('Forbidden');
  });

  it('throws when user is not a GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);

    await expect(
      _updateRule({
        data: { id: 'rule-1', campaignId: 'camp-1', title: 'T', content: 'B' },
      })
    ).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// listRules
// ---------------------------------------------------------------------------

describe('listRules', () => {
  function mockFind(docs: unknown[] = []) {
    vi.mocked(Rule.find).mockReturnValue({
      select: vi.fn().mockReturnValue({
        sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(docs) }),
      }),
    } as never);
  }

  it('returns rules for a GM (default visibility shows all)', async () => {
    const rules = [makeRule(), makeRule({ _id: 'rule-2', title: 'Second Rule' })];
    mockFind(rules);

    const result = await _listRules({ data: { campaignId: 'camp-1' } });

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('rule-1');
    expect(result[1].title).toBe('Second Rule');
    // GM with default visibility should NOT have isPublic filter
    const filter = vi.mocked(Rule.find).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(filter).not.toHaveProperty('isPublic');
  });

  it('constrains non-GM users to public rules only', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    mockFind([]);

    await _listRules({ data: { campaignId: 'camp-1' } });

    expect(vi.mocked(Rule.find).mock.calls[0][0]).toMatchObject({
      isPublic: true,
    });
  });

  it('GM can filter by visibility=public', async () => {
    mockFind([]);

    await _listRules({ data: { campaignId: 'camp-1', visibility: 'public' } });

    expect(vi.mocked(Rule.find).mock.calls[0][0]).toMatchObject({
      isPublic: true,
    });
  });

  it('GM can filter by visibility=private', async () => {
    mockFind([]);

    await _listRules({ data: { campaignId: 'camp-1', visibility: 'private' } });

    expect(vi.mocked(Rule.find).mock.calls[0][0]).toMatchObject({
      isPublic: false,
    });
  });

  it('list responses omit content field', async () => {
    mockFind([makeRule()]);

    const result = await _listRules({ data: { campaignId: 'camp-1' } });

    expect(result[0]).not.toHaveProperty('content');
  });

  it('applies text search filter', async () => {
    mockFind([]);

    await _listRules({ data: { campaignId: 'camp-1', search: 'critical' } });

    expect(vi.mocked(Rule.find).mock.calls[0][0]).toMatchObject({
      $text: { $search: 'critical' },
    });
  });

  it('ignores empty search string', async () => {
    mockFind([]);

    await _listRules({ data: { campaignId: 'camp-1', search: '   ' } });

    expect(vi.mocked(Rule.find).mock.calls[0][0]).not.toHaveProperty('$text');
  });

  it('filters by tags', async () => {
    mockFind([]);

    await _listRules({ data: { campaignId: 'camp-1', tags: ['combat'] } });

    expect(vi.mocked(Rule.find).mock.calls[0][0]).toMatchObject({
      tags: { $all: ['combat'] },
    });
  });

  it('throws when not authenticated', async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await expect(_listRules({ data: { campaignId: 'camp-1' } })).rejects.toThrow(
      'Not authenticated'
    );
  });
});

// ---------------------------------------------------------------------------
// getRule
// ---------------------------------------------------------------------------

describe('getRule', () => {
  it('returns a rule for a GM', async () => {
    const rule = makeRule();
    vi.mocked(Rule.findById).mockResolvedValue(rule as never);

    const result = await _getRule({ data: { id: 'rule-1', campaignId: 'camp-1' } });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('rule-1');
  });

  it('returns null when rule does not exist', async () => {
    vi.mocked(Rule.findById).mockResolvedValue(null);

    const result = await _getRule({ data: { id: 'nonexistent', campaignId: 'camp-1' } });

    expect(result).toBeNull();
  });

  it('returns null for private rules when user is not a GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    const rule = makeRule({ isPublic: false });
    vi.mocked(Rule.findById).mockResolvedValue(rule as never);

    const result = await _getRule({ data: { id: 'rule-1', campaignId: 'camp-1' } });

    expect(result).toBeNull();
  });

  it('returns public rules for non-GM users', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);
    const rule = makeRule({ isPublic: true });
    vi.mocked(Rule.findById).mockResolvedValue(rule as never);

    const result = await _getRule({ data: { id: 'rule-1', campaignId: 'camp-1' } });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('rule-1');
  });

  it('returns null when rule belongs to a different campaign', async () => {
    const rule = makeRule({ campaignId: 'camp-other' });
    vi.mocked(Rule.findById).mockResolvedValue(rule as never);

    const result = await _getRule({ data: { id: 'rule-1', campaignId: 'camp-1' } });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// deleteRule
// ---------------------------------------------------------------------------

describe('deleteRule', () => {
  it('deletes a rule and cleans up GM Screen refs', async () => {
    const existing = makeRule({ deleteOne: vi.fn() });
    vi.mocked(Rule.findById).mockResolvedValue(existing as never);

    const result = await _deleteRule({ data: { id: 'rule-1', campaignId: 'camp-1' } });

    expect(result.success).toBe(true);
    expect(existing.deleteOne).toHaveBeenCalled();
    expect(removeDocumentRefsFromScreens).toHaveBeenCalledWith('camp-1', 'rule', 'rule-1');
  });

  it('allows any GM to delete any rule (no ownership check)', async () => {
    const existing = makeRule({ createdBy: 'other-gm-user', deleteOne: vi.fn() });
    vi.mocked(Rule.findById).mockResolvedValue(existing as never);

    const result = await _deleteRule({ data: { id: 'rule-1', campaignId: 'camp-1' } });

    expect(result.success).toBe(true);
    expect(existing.deleteOne).toHaveBeenCalled();
  });

  it('throws when rule is not found', async () => {
    vi.mocked(Rule.findById).mockResolvedValue(null);

    await expect(
      _deleteRule({ data: { id: 'nonexistent', campaignId: 'camp-1' } })
    ).rejects.toThrow('Rule not found');
  });

  it('throws when rule belongs to a different campaign', async () => {
    const existing = makeRule({ campaignId: 'camp-other' });
    vi.mocked(Rule.findById).mockResolvedValue(existing as never);

    await expect(_deleteRule({ data: { id: 'rule-1', campaignId: 'camp-1' } })).rejects.toThrow(
      'Forbidden'
    );
  });

  it('throws when user is not a GM', async () => {
    vi.mocked(Campaign.findById).mockResolvedValue(mockPlayerCampaign);

    await expect(_deleteRule({ data: { id: 'rule-1', campaignId: 'camp-1' } })).rejects.toThrow(
      'Forbidden'
    );
  });

  it('succeeds even when cleanup fails', async () => {
    const existing = makeRule({ deleteOne: vi.fn() });
    vi.mocked(Rule.findById).mockResolvedValue(existing as never);
    const cleanupError = new Error('MongoDB timeout during cleanup');
    vi.mocked(removeDocumentRefsFromScreens).mockRejectedValueOnce(cleanupError);

    const result = await _deleteRule({ data: { id: 'rule-1', campaignId: 'camp-1' } });

    expect(result.success).toBe(true);
    expect(existing.deleteOne).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Zod schemas — validation
// ---------------------------------------------------------------------------

describe('createRuleSchema', () => {
  it('rejects when title is empty', () => {
    const result = createRuleSchema.safeParse({
      campaignId: 'camp-1',
      title: '',
      content: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when content is empty', () => {
    const result = createRuleSchema.safeParse({
      campaignId: 'camp-1',
      title: 'Title',
      content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only title', () => {
    const result = createRuleSchema.safeParse({
      campaignId: 'camp-1',
      title: '   ',
      content: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only content', () => {
    const result = createRuleSchema.safeParse({
      campaignId: 'camp-1',
      title: 'Title',
      content: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only campaignId', () => {
    const result = createRuleSchema.safeParse({
      campaignId: '   ',
      title: 'Title',
      content: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid input with defaults', () => {
    const result = createRuleSchema.safeParse({
      campaignId: 'camp-1',
      title: 'Title',
      content: 'body',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isPublic).toBe(false);
      expect(result.data.tags).toEqual([]);
    }
  });
});

describe('updateRuleSchema', () => {
  it('rejects when id is missing', () => {
    const result = updateRuleSchema.safeParse({
      campaignId: 'camp-1',
      title: 'Title',
      content: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when title is empty', () => {
    const result = updateRuleSchema.safeParse({
      id: 'rule-1',
      campaignId: 'camp-1',
      title: '',
      content: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only title', () => {
    const result = updateRuleSchema.safeParse({
      id: 'rule-1',
      campaignId: 'camp-1',
      title: '   ',
      content: 'body',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only content', () => {
    const result = updateRuleSchema.safeParse({
      id: 'rule-1',
      campaignId: 'camp-1',
      title: 'Title',
      content: '   ',
    });
    expect(result.success).toBe(false);
  });
});

describe('listRulesSchema', () => {
  it('defaults visibility to all', () => {
    const result = listRulesSchema.safeParse({ campaignId: 'camp-1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.visibility).toBe('all');
    }
  });

  it('rejects invalid visibility value', () => {
    const result = listRulesSchema.safeParse({ campaignId: 'camp-1', visibility: 'secret' });
    expect(result.success).toBe(false);
  });
});
