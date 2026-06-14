import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CampaignCard, type CampaignData } from './CampaignCard';
import { Toast } from '~/components/Toast';

const baseCampaign: CampaignData = {
  id: 'camp-1',
  name: 'The Lost Mines of Phandelver',
  description:
    'Four heroes set out on a dangerous quest through the Forgotten Realms. Ancient evils stir in the ruins of Phandalin as the party races to uncover the secrets of the lost mine before the Spider claims it.',
  status: 'active',
  inviteCode: 'ABCD-EFGH',
  imagePath: null,
  links: [
    { name: 'Campaign Wiki', url: 'https://example.com/wiki' },
    { name: 'Shared Notes', url: 'https://notion.so/campaign' },
  ],
  maxPlayers: 4,
  schedule: {
    frequency: 'Weekly',
    dayOfWeek: 'Friday',
    time: '19:00',
    timezone: 'America/Chicago',
  },
  players: { current: 3, max: 4 },
  partyMembers: [
    {
      id: '1',
      characterName: 'Thalion Swiftarrow',
      characterClass: 'Ranger',
      avatar: null,
      userId: 'u1',
    },
    {
      id: '2',
      characterName: 'Baldric Ironforge',
      characterClass: 'Fighter',
      avatar: null,
      userId: 'u2',
    },
    {
      id: '3',
      characterName: 'Lyra Moonwhisper',
      characterClass: 'Wizard',
      avatar: null,
      userId: 'u3',
    },
  ],
  nextSession: { day: 'Friday', time: '19:00' },
  sessions: [],
  isOwner: true,
  isGM: true,
  isMember: true,
  currentUserId: 'user-1',
  scheduleText: 'Weekly · Friday · at 7:00 PM · CST',
};

const meta: Meta<typeof CampaignCard> = {
  title: 'Campaign/CampaignCard',
  component: CampaignCard,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="max-w-4xl p-6 bg-[#080A12]">
        <Story />
        <Toast />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { campaign: baseCampaign },
};

export const AsPlayer: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      isOwner: false,
      inviteCode: '',
    },
  },
};

export const Paused: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      status: 'paused',
      nextSession: null,
      schedule: { frequency: null, dayOfWeek: null, time: null, timezone: null },
    },
  },
};

export const NoDescription: Story = {
  args: {
    campaign: { ...baseCampaign, description: '' },
  },
};

export const NoLinks: Story = {
  args: {
    campaign: { ...baseCampaign, links: [] },
  },
};

export const FullParty: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      maxPlayers: 4,
      partyMembers: [
        {
          id: '1',
          characterName: 'Thalion Swiftarrow',
          characterClass: 'Ranger',
          avatar: null,
          userId: 'u1',
        },
        {
          id: '2',
          characterName: 'Baldric Ironforge',
          characterClass: 'Fighter',
          avatar: null,
          userId: 'u2',
        },
        {
          id: '3',
          characterName: 'Lyra Moonwhisper',
          characterClass: 'Wizard',
          avatar: null,
          userId: 'u3',
        },
        {
          id: '4',
          characterName: 'Grax the Unbroken',
          characterClass: 'Barbarian',
          avatar: null,
          userId: 'u4',
        },
      ],
      players: { current: 4, max: 4 },
    },
  },
};

export const MaxPlayers: Story = {
  args: {
    campaign: {
      ...baseCampaign,
      maxPlayers: 10,
      partyMembers: Array.from({ length: 10 }, (_, i) => ({
        id: String(i),
        characterName: `Hero ${i + 1}`,
        characterClass: 'Fighter',
        avatar: null,
        userId: `u${i}`,
      })),
      players: { current: 10, max: 10 },
    },
  },
};
