export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  campaigns: {
    all: ['campaigns'] as const,
    list: () => ['campaigns', 'list'] as const,
    detail: (id: string) => ['campaigns', 'detail', id] as const,
  },
  sessions: {
    all: ['sessions'] as const,
    list: (campaignId: string, includeCompleted: boolean) =>
      ['sessions', 'list', campaignId, String(includeCompleted)] as const,
  },
  gmscreens: {
    all: ['gmscreens'] as const,
    list: (campaignId: string) => ['gmscreens', 'list', campaignId] as const,
    detail: (campaignId: string, screenId: string) =>
      ['gmscreens', 'detail', campaignId, screenId] as const,
  },
  notes: {
    all: ['notes'] as const,
    list: (
      campaignId: string,
      sessionId?: string,
      search?: string,
      visibility?: string,
      tags?: string[]
    ) =>
      [
        'notes',
        'list',
        campaignId,
        sessionId ?? '',
        search ?? '',
        visibility ?? 'all',
        tags ?? [],
      ] as const,
    detail: (id: string, campaignId?: string) => ['notes', 'detail', campaignId ?? '', id] as const,
  },
  characters: {
    all: ['characters'] as const,
    list: (
      campaignId: string,
      sessionId?: string,
      search?: string,
      visibility?: string,
      tags?: string[]
    ) =>
      [
        'characters',
        'list',
        campaignId,
        sessionId ?? '',
        search ?? '',
        visibility ?? 'all',
        tags ?? [],
      ] as const,
    detail: (id: string, campaignId?: string) =>
      ['characters', 'detail', campaignId ?? '', id] as const,
  },
  players: {
    all: ['players'] as const,
    list: (campaignId: string, search?: string) =>
      ['players', 'list', campaignId, search ?? ''] as const,
    detail: (id: string, campaignId?: string) =>
      ['players', 'detail', campaignId ?? '', id] as const,
    active: (campaignId: string) => ['players', 'active', campaignId] as const,
  },
  rules: {
    all: ['rules'] as const,
    list: (campaignId: string, search?: string, visibility?: string, tags?: string[]) =>
      ['rules', 'list', campaignId, search ?? '', visibility ?? 'all', tags ?? []] as const,
    detail: (id: string, campaignId?: string) => ['rules', 'detail', campaignId ?? '', id] as const,
  },
  tags: {
    all: ['tags'] as const,
    list: (campaignId: string) => ['tags', 'list', campaignId] as const,
  },
  races: {
    all: ['races'] as const,
    list: (campaignId: string, search?: string, tags?: string[]) =>
      ['races', 'list', campaignId, search ?? '', tags ?? []] as const,
    detail: (id: string, campaignId?: string) => ['races', 'detail', campaignId ?? '', id] as const,
  },
  chat: {
    all: ['chat'] as const,
    list: (sessionId: string) => ['chat', 'list', sessionId] as const,
  },
  diceRolls: {
    all: ['diceRolls'] as const,
    list: (sessionId: string) => ['diceRolls', 'list', sessionId] as const,
  },
  locations: {
    all: ['locations'] as const,
    list: (
      campaignId: string,
      search?: string,
      visibility?: string,
      locationType?: string,
      tags?: string[]
    ) =>
      [
        'locations',
        'list',
        campaignId,
        search ?? '',
        visibility ?? 'all',
        locationType ?? '',
        tags ?? [],
      ] as const,
    detail: (id: string, campaignId?: string) =>
      ['locations', 'detail', campaignId ?? '', id] as const,
  },
  locationTypes: {
    all: ['locationTypes'] as const,
    list: (campaignId: string) => ['locationTypes', 'list', campaignId] as const,
  },
  tabletop: {
    all: ['tabletop'] as const,
    list: (campaignId: string) => ['tabletop', 'list', campaignId] as const,
    detail: (campaignId: string, screenId: string) =>
      ['tabletop', 'detail', campaignId, screenId] as const,
    playerState: (campaignId: string) => ['tabletop', 'playerState', campaignId] as const,
  },
  sessionEvents: {
    all: ['sessionEvents'] as const,
    list: (campaignId: string, sessionId: string) =>
      ['sessionEvents', 'list', campaignId, sessionId] as const,
  },
  cleanup: {
    all: ['cleanup'] as const,
    orphanImages: (campaignId: string) => ['cleanup', 'orphanImages', campaignId] as const,
  },
};
