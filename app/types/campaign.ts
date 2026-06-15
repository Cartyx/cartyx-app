export interface CampaignData {
  id: string;
  name: string;
  description: string;
  status: string;
  inviteCode: string;
  imagePath: string | null;
  links: Array<{ name: string; url: string }>;
  maxPlayers: number;
  schedule: {
    frequency: string | null;
    dayOfWeek: string | null;
    time: string | null;
    timezone: string | null;
  };
  players: { current: number; max: number };
  partyMembers: Array<{
    id: string;
    characterName: string;
    characterClass: string;
    avatar: string | null;
    userId: string;
  }>;
  nextSession: { day: string; time: string } | null;
  sessions: Array<{
    id: string;
    name: string;
    number: number;
    startDate: string;
    endDate: string | null;
    status: 'not_started' | 'active' | 'completed';
    catchUp: string | null;
  }>;
  gmScreens?: Array<{
    id: string;
    name: string;
  }>;
  isOwner: boolean;
  isGM: boolean;
  isMember: boolean;
  /** The database User._id of the viewer when they are a member; otherwise null. */
  currentUserId: string | null;
  scheduleText: string;
}
