import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QuestWindow } from '~/components/wiki/quests/QuestWindow';
import type { QuestData } from '~/types/quest';

const base: QuestData = {
  id: 'q1',
  campaignId: 'c1',
  createdBy: 'u1',
  name: 'Goblin Arrows',
  type: 'Main',
  status: 'active',
  publicInfo: 'Escort the wagon',
  privateInfo: 'Ambush',
  isPublic: true,
  giver: { kind: 'character', id: 'ch1', label: 'Sildar Hallwinter' },
  parentQuestId: null,
  parentQuest: null,
  subQuests: [],
  links: [],
  events: [],
  images: [],
  tags: [],
  canEdit: true,
  createdAt: '',
  updatedAt: '',
};

describe('QuestWindow', () => {
  it('renders name, status, giver, and public info', () => {
    render(<QuestWindow quest={base} onEdit={vi.fn()} />);
    expect(screen.getByTestId('quest-window')).toBeInTheDocument();
    expect(screen.getByText('Goblin Arrows')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/Sildar Hallwinter/)).toBeInTheDocument();
    expect(screen.getByText(/Escort the wagon/)).toBeInTheDocument();
  });
});
