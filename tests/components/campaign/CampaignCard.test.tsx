import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

function resolveToHref(
  to: string,
  params?: Record<string, string>,
  search?: Record<string, string>
) {
  let path = params
    ? Object.entries(params).reduce((p, [key, value]) => p.replace(`$${key}`, value), to)
    : to;
  if (search && Object.keys(search).length > 0) {
    path += '?' + new URLSearchParams(search).toString();
  }
  return path;
}

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
  }) => (
    <a href={resolveToHref(to, params, search)} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('~/utils/date', () => ({
  formatNextSession: vi.fn(() => 'Friday · 7:00 PM (in 3 days)'),
}));

vi.mock('~/components/Toast', () => ({
  showToast: vi.fn(),
  Toast: () => null,
}));

import { CampaignCard, type CampaignData } from '~/components/campaign/CampaignCard';

const baseCampaign: CampaignData = {
  id: 'camp-1',
  name: 'The Lost Mines of Phandelver',
  description: 'A classic D&D adventure in the Forgotten Realms.',
  status: 'active',
  inviteCode: 'ABCD-EFGH',
  imagePath: null,
  links: [{ name: 'Campaign Wiki', url: 'https://example.com/wiki' }],
  maxPlayers: 4,
  schedule: {
    frequency: 'Weekly',
    dayOfWeek: 'Friday',
    time: '19:00',
    timezone: 'America/Chicago',
  },
  players: { current: 2, max: 4 },
  partyMembers: [
    { id: '1', characterName: 'Thalion', characterClass: 'Ranger', avatar: null, userId: 'u1' },
    { id: '2', characterName: 'Lyra', characterClass: 'Wizard', avatar: null, userId: 'u2' },
  ],
  nextSession: { day: 'Friday', time: '19:00' },
  sessions: [],
  isOwner: true,
  isGM: true,
  isMember: true,
  currentUserId: 'user-1',
  scheduleText: 'Weekly · Friday · at 7:00 PM · CST',
};

describe('CampaignCard', () => {
  it('renders campaign name in hero banner', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('The Lost Mines of Phandelver')).toBeInTheDocument();
  });

  it('renders campaign description', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(
      screen.getByText('A classic D&D adventure in the Forgotten Realms.')
    ).toBeInTheDocument();
  });

  it('renders party members', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('Thalion')).toBeInTheDocument();
    expect(screen.getByText('Lyra')).toBeInTheDocument();
  });

  it('shows invite code field for owner', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByDisplayValue('ABCD-EFGH')).toBeInTheDocument();
  });

  it('hides invite code field for non-owner', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, isOwner: false, inviteCode: '' }} />);
    expect(screen.queryByDisplayValue('ABCD-EFGH')).not.toBeInTheDocument();
  });

  it('shows Edit Campaign button for owner', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText(/edit campaign/i)).toBeInTheDocument();
  });

  it('hides Edit Campaign button for non-owner', () => {
    render(<CampaignCard campaign={{ ...baseCampaign, isOwner: false, inviteCode: '' }} />);
    expect(screen.queryByText(/edit campaign/i)).not.toBeInTheDocument();
  });

  it('shows enter and optionally edit route actions', () => {
    const { rerender } = render(<CampaignCard campaign={{ ...baseCampaign, isOwner: false }} />);
    expect(screen.getByText(/enter/i).closest('a')).toHaveAttribute(
      'href',
      '/campaigns/camp-1/play?tab=dashboard'
    );
    expect(screen.queryByText(/edit campaign/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/view summary/i)).not.toBeInTheDocument();

    rerender(<CampaignCard campaign={baseCampaign} />); // owner = true
    expect(screen.getByText(/enter/i).closest('a')).toHaveAttribute(
      'href',
      '/campaigns/camp-1/play?tab=dashboard'
    );
    expect(screen.getByText(/edit campaign/i).closest('a')).toHaveAttribute(
      'href',
      '/campaigns/camp-1/edit'
    );
  });

  it('renders external links', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('Campaign Wiki')).toBeInTheDocument();
  });

  it('renders next session info', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('Friday · 7:00 PM (in 3 days)')).toBeInTheDocument();
  });

  it('renders ACTIVE status badge', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  // Regression: responsive layout (#302)

  it('card uses responsive flex layout (stacks on mobile, row on md+)', () => {
    const { container } = render(<CampaignCard campaign={baseCampaign} />);
    // Find the content area that uses responsive flex layout
    const flexContainers = container.querySelectorAll('div');
    const match = Array.from(flexContainers).find(
      (el) =>
        el.classList.contains('flex') &&
        el.classList.contains('flex-col') &&
        el.classList.contains('md:flex-row')
    );
    expect(match).toBeInTheDocument();
  });

  it('renders campaign name even when sessions array is empty', () => {
    const campaign = { ...baseCampaign, sessions: [] };
    render(<CampaignCard campaign={campaign} />);
    expect(screen.getByText('The Lost Mines of Phandelver')).toBeInTheDocument();
  });

  it('enter button has accessible label with campaign name', () => {
    render(<CampaignCard campaign={baseCampaign} />);
    const enterButton = screen.getByLabelText('Enter campaign: The Lost Mines of Phandelver');
    expect(enterButton).toBeInTheDocument();
    expect(enterButton.closest('a')).toHaveAttribute(
      'href',
      '/campaigns/camp-1/play?tab=dashboard'
    );
  });
});
