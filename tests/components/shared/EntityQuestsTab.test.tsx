import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntityQuestsTab } from '~/components/shared/EntityQuestsTab';

vi.mock('~/hooks/useQuests', () => ({
  useQuestsForEntity: () => ({
    quests: [
      {
        id: 'q1',
        name: 'Goblin Arrows',
        status: 'active',
        type: 'Main',
        isPublic: true,
        tags: [],
        canEdit: true,
        campaignId: 'c1',
        createdBy: 'u1',
        createdAt: '',
        updatedAt: '',
      },
    ],
    isLoading: false,
  }),
}));

describe('EntityQuestsTab', () => {
  it('lists quests linked to the entity', () => {
    render(<EntityQuestsTab campaignId="c1" kind="character" id="ch1" />);
    expect(screen.getByText('Goblin Arrows')).toBeInTheDocument();
  });
});
