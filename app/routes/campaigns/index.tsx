import { useState, useEffect, useCallback, type FormEvent } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { getMe, listCampaigns } from '~/server/functions/rpc';
import { getQueryClient } from '~/providers/QueryProvider';
import { queryKeys } from '~/utils/queryKeys';
import { Topbar } from '~/components/Topbar';
import { Toast } from '~/components/Toast';
import { PixelButton } from '~/components/PixelButton';
import { CampaignCard } from '~/components/campaign/CampaignCard';
import { KeyRound, Swords } from 'lucide-react';

export const Route = createFileRoute('/campaigns/')({
  beforeLoad: async () => {
    const user = await getMe();
    if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
    return { user };
  },
  loader: async () => {
    const campaigns = await getQueryClient().ensureQueryData({
      queryKey: queryKeys.campaigns.list(),
      queryFn: () => listCampaigns(),
    });
    return { campaigns };
  },
  component: CampaignsListPage,
});

function CampaignsListPage() {
  const { user } = Route.useRouteContext();
  const { campaigns } = Route.useLoaderData();
  const isGm = user.role === 'gm';
  const navigate = useNavigate();
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const closeJoinForm = useCallback(() => {
    setShowJoinForm(false);
    setJoinCode('');
  }, []);

  // Close join form on Escape key — uses document listener so the backdrop doesn't need to be focusable
  useEffect(() => {
    if (!showJoinForm) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeJoinForm();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showJoinForm, closeJoinForm]);

  async function handleJoin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    navigate({
      to: '/campaign/join',
      search: { code: joinCode.trim(), step: 1 },
    });
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#080A12]">
      <Topbar />
      <main className="flex-1 w-full max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-10">
          <h1 className="font-sans font-semibold text-[15px] text-white tracking-widest">
            MY CAMPAIGNS
          </h1>
          <div className="flex gap-3">
            {!isGm && (
              <PixelButton
                variant="primary"
                size="md"
                icon={<KeyRound className="h-3.5 w-3.5" />}
                onClick={() => setShowJoinForm(true)}
              >
                Join Campaign
              </PixelButton>
            )}
            {isGm && (
              <PixelButton
                as="link"
                variant="primary"
                size="md"
                icon={<Swords className="h-3.5 w-3.5" />}
                to="/campaigns/new"
              >
                Create Campaign
              </PixelButton>
            )}
          </div>
        </div>

        {campaigns.length > 0 ? (
          <div className="flex flex-col gap-6">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center py-16">
            <img
              src="/cartyx-rogue.png"
              alt="No campaigns"
              className="w-80 h-auto mb-6 rounded-xl object-contain"
              style={{
                imageRendering: 'pixelated',
                filter: 'sepia(1) hue-rotate(185deg) saturate(2) brightness(0.75)',
              }}
            />
            <div className="font-sans font-semibold text-[11px] text-slate-500 tracking-widest mb-3 leading-relaxed">
              NO CAMPAIGNS YET
            </div>
            <p className="text-sm text-slate-600 max-w-sm leading-relaxed mb-8">
              {isGm
                ? 'Create your first campaign to get started.'
                : 'Ask your GM for an invite code to join a campaign.'}
            </p>
            {isGm ? (
              <PixelButton
                as="link"
                variant="primary"
                size="lg"
                icon={<Swords className="h-3.5 w-3.5" />}
                to="/campaigns/new"
              >
                Create Campaign
              </PixelButton>
            ) : (
              <PixelButton
                variant="primary"
                size="lg"
                icon={<KeyRound className="h-3.5 w-3.5" />}
                onClick={() => setShowJoinForm(true)}
              >
                Join Campaign
              </PixelButton>
            )}
          </div>
        )}
      </main>
      <Toast />

      {showJoinForm && (
        // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- backdrop click-to-dismiss and Escape-to-close are standard modal dialog patterns
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-campaign-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeJoinForm();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') closeJoinForm();
          }}
        >
          <div className="bg-[#0D1117] border border-white/[0.07] rounded-2xl p-8 w-full max-w-md mx-4">
            <h2
              id="join-campaign-title"
              className="font-sans font-semibold text-[11px] text-white tracking-widest mb-6"
            >
              JOIN CAMPAIGN
            </h2>
            <form onSubmit={handleJoin} className="space-y-4">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Enter invite code (e.g. ABCD-EFGH)"
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.1] text-white text-sm placeholder-slate-600 focus:outline-none focus:border-blue-500/40"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- autoFocus is intentional: this is the primary input inside a modal dialog, and focusing it on open is the expected accessible UX pattern
                autoFocus
                aria-label="Invite code"
              />
              <div className="flex gap-3">
                <PixelButton
                  variant="secondary"
                  size="md"
                  onClick={closeJoinForm}
                  className="flex-1"
                  type="button"
                >
                  Cancel
                </PixelButton>
                <PixelButton
                  variant="primary"
                  size="md"
                  type="submit"
                  disabled={!joinCode.trim()}
                  className="flex-1"
                >
                  Join Campaign
                </PixelButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
