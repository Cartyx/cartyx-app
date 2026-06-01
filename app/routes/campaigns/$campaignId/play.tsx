import { useCallback } from 'react';
import { z } from 'zod';
import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { Plus } from 'lucide-react';
import { getMe } from '~/server/functions/auth';
import { useCampaign } from '~/hooks/useCampaigns';
import { useActivePlayerContext } from '~/providers/ActivePlayerProvider';
import { CampaignHeader } from '~/components/mainview/CampaignHeader';
import { DashboardView } from '~/components/mainview/DashboardView';
import { MainView } from '~/components/mainview/MainView';
import { TabletopView } from '~/components/mainview/TabletopView';
import { GMScreensView } from '~/components/mainview/gmscreens';
import type { TabId } from '~/components/mainview/TabNavigation';
import { CatchUpWidget } from '~/components/mainview/widgets/CatchUpWidget';
import { CampaignTimelineWidget } from '~/components/mainview/widgets/CampaignTimelineWidget';
import { KeyAlliesWidget } from '~/components/mainview/widgets/KeyAlliesWidget';
import { PartyMembersWidget } from '~/components/mainview/widgets/PartyMembersWidget';
import { SessionsListWidget } from '~/components/mainview/widgets/SessionsListWidget';
import { ActivePlayerProvider } from '~/providers/ActivePlayerProvider';

const getTabletopPartyTokenFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ campaignId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { getSession } = await import('~/server/session');
    const user = await getSession();
    if (!user) return '';

    const { connectDB, isDBConnected } = await import('~/server/db/connection');
    await connectDB();
    if (!isDBConnected()) return '';

    const { createPartyToken } = await import('~/server/session');
    return createPartyToken(user.id, data.campaignId, 'tabletop');
  });

export const playSearchSchema = z.object({
  tab: z.enum(['dashboard', 'tabletop', 'gmscreens']).catch('dashboard'),
});

export const Route = createFileRoute('/campaigns/$campaignId/play')({
  validateSearch: (search: Record<string, unknown>) => playSearchSchema.parse(search),
  beforeLoad: async () => {
    const user = await getMe();
    if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
    return { user };
  },
  component: PlayPage,
});

function PlayPage() {
  const { campaignId } = Route.useParams();

  return (
    <ActivePlayerProvider campaignId={campaignId}>
      <PlayPageContent />
    </ActivePlayerProvider>
  );
}

function PlayPageContent() {
  const { tab: activeTab } = Route.useSearch();
  const { campaignId } = Route.useParams();
  const navigate = Route.useNavigate();
  const { campaign, isLoading: isCampaignLoading } = useCampaign(campaignId);

  const { activePlayer, isLoading: isPlayerLoading } = useActivePlayerContext();

  const activeSession = campaign?.sessions.find((s) => s.status === 'active');

  const getTabletopToken = useCallback(async () => {
    if (!campaignId) return '';
    const token = await getTabletopPartyTokenFn({ data: { campaignId } });
    return token ?? '';
  }, [campaignId]);

  const needsNewPlayer = !isCampaignLoading && !isPlayerLoading && !activePlayer && !campaign?.isGM;

  // Coerce non-GMs away from the GM-only tab
  const effectiveTab =
    activeTab === 'gmscreens' && !campaign?.isGM ? ('dashboard' as const) : activeTab;

  function handleTabChange(tab: TabId) {
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, tab }) });
  }

  return (
    <div className="flex flex-col h-screen bg-[#080A12]">
      <CampaignHeader
        campaignId={campaignId}
        isOwner={campaign?.isOwner}
        isGM={campaign?.isGM}
        activeSessionName={activeSession?.name}
        activeTab={effectiveTab}
        onTabChange={handleTabChange}
      />
      <div className="flex-1 overflow-hidden">
        <MainView
          showToolbar={effectiveTab === 'tabletop'}
          campaignId={campaignId}
          sessions={campaign?.sessions}
        >
          {needsNewPlayer && (
            <div className="mx-4 mt-4 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm text-amber-200 font-medium">
                  Your player character needs to be created
                </p>
                <p className="text-xs text-amber-200/60 mt-1">
                  Create a player character to fully participate in this campaign.
                </p>
              </div>
              <Link
                to="/campaign/join"
                search={{ step: 2, campaignId }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-200 text-xs font-medium hover:bg-amber-500/30 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Character
              </Link>
            </div>
          )}
          <div
            className="h-full overflow-y-auto"
            role="tabpanel"
            id="tab-panel-dashboard"
            aria-labelledby="tab-dashboard"
            hidden={effectiveTab !== 'dashboard'}
          >
            <DashboardView>
              <CatchUpWidget
                catchUp={isCampaignLoading ? undefined : (activeSession?.catchUp ?? null)}
              />
              <PartyMembersWidget />
              <KeyAlliesWidget />
              <SessionsListWidget campaignId={campaignId} className="col-span-full" />
              <CampaignTimelineWidget className="xl:col-span-2" />
            </DashboardView>
          </div>
          <div
            className="h-full"
            role="tabpanel"
            id="tab-panel-tabletop"
            aria-labelledby="tab-tabletop"
            hidden={effectiveTab !== 'tabletop'}
          >
            <TabletopView
              campaignId={campaignId}
              isGM={campaign?.isGM ?? false}
              getToken={getTabletopToken}
              sessionId={activeSession?.id ?? null}
            />
          </div>
          {campaign?.isGM && (
            <div
              className="h-full"
              role="tabpanel"
              id="tab-panel-gmscreens"
              aria-labelledby="tab-gmscreens"
              hidden={effectiveTab !== 'gmscreens'}
            >
              <GMScreensView campaignId={campaignId} isGM={campaign?.isGM} />
            </div>
          )}
        </MainView>
      </div>
    </div>
  );
}
