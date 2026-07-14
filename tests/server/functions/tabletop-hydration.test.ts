import { describe, it, expect, vi, beforeEach } from 'vitest';

// hydrateRefs lazily `await import`s the Event model, so mock it up front.
vi.mock('~/server/db/models/Note', () => ({ Note: { find: vi.fn() } }));
vi.mock('~/server/db/models/Character', () => ({ Character: { find: vi.fn() } }));
vi.mock('~/server/db/models/Race', () => ({ Race: { find: vi.fn() } }));
vi.mock('~/server/db/models/Rule', () => ({ Rule: { find: vi.fn() } }));
vi.mock('~/server/db/models/Event', () => ({ Event: { find: vi.fn() } }));
vi.mock('~/server/db/models/Organization', () => ({ Organization: { find: vi.fn() } }));

import { Event } from '~/server/db/models/Event';
import { Organization } from '~/server/db/models/Organization';
import { hydrateRefs } from '~/server/functions/tabletop-hydration';

const eventDocs = [
  { _id: 'pub', title: 'Public Feast', content: 'open to all', isPublic: true },
  { _id: 'priv', title: 'Secret Plot', content: 'GM eyes only', isPublic: false },
];

function mockEventFind() {
  vi.mocked(Event.find).mockReturnValue({
    lean: vi.fn().mockResolvedValue(eventDocs),
  } as never);
}

const organizationDocs = [{ _id: 'orgPriv', name: 'Secret', publicInfo: '', isPublic: false }];

function mockOrganizationFind() {
  vi.mocked(Organization.find).mockReturnValue({
    lean: vi.fn().mockResolvedValue(organizationDocs),
  } as never);
}

describe('hydrateRefs — event privacy on shared screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventFind();
  });

  const refs = [
    { collection: 'events', documentId: 'pub' },
    { collection: 'events', documentId: 'priv' },
  ];

  it('omits non-public events for a non-GM viewer', async () => {
    const hydrated = await hydrateRefs(refs, 'camp-1', { isGM: false });
    expect(hydrated['events:pub']).toBeDefined();
    expect(hydrated['events:pub'].title).toBe('Public Feast');
    // Private event must not leak its title/content to a player.
    expect(hydrated['events:priv']).toBeUndefined();
  });

  it('hydrates private events for a GM viewer', async () => {
    const hydrated = await hydrateRefs(refs, 'camp-1', { isGM: true });
    expect(hydrated['events:priv']).toBeDefined();
    expect(hydrated['events:priv'].content).toBe('GM eyes only');
  });

  it('defaults to GM (no redaction) when no viewer role is provided', async () => {
    const hydrated = await hydrateRefs(refs, 'camp-1');
    expect(hydrated['events:priv']).toBeDefined();
  });
});

describe('hydrateRefs — organization privacy on shared screens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOrganizationFind();
  });

  it('omits non-public organizations for a non-GM viewer', async () => {
    const result = await hydrateRefs(
      [{ collection: 'organization', documentId: 'orgPriv' }],
      'camp-1',
      { isGM: false }
    );
    expect(result['organization:orgPriv']).toBeUndefined();
  });
});
