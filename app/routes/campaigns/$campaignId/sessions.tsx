import { useState } from 'react';
import { createFileRoute, redirect, Link } from '@tanstack/react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faPlus } from '@fortawesome/pro-solid-svg-icons';
import { getMe, getCampaign } from '~/server/functions/rpc';
import { getQueryClient } from '~/providers/QueryProvider';
import { queryKeys } from '~/utils/queryKeys';
import { PixelButton } from '~/components/PixelButton';
import { SessionModal } from '~/components/sessions/SessionModal';
import {
  useSessions,
  useCreateSession,
  useUpdateSession,
  useActivateSession,
} from '~/hooks/useSessions';
import { useCampaign } from '~/hooks/useCampaigns';

export const Route = createFileRoute('/campaigns/$campaignId/sessions')({
  beforeLoad: async ({ params }) => {
    const user = await getMe();
    if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
    const campaign = await getQueryClient().ensureQueryData({
      queryKey: queryKeys.campaigns.detail(params.campaignId),
      queryFn: () => getCampaign({ data: { id: params.campaignId } }),
    });
    if (!campaign) throw redirect({ to: '/campaigns' });
    if (!campaign.isOwner)
      throw redirect({
        to: '/campaigns/$campaignId/play',
        params: { campaignId: params.campaignId },
        search: { tab: 'dashboard' },
      });
    return { user };
  },
  component: SessionsPage,
});

interface SessionData {
  id: string;
  name: string;
  number: number;
  startDate: string;
  endDate: string | null;
  status: 'not_started' | 'active' | 'completed';
  catchUp: string | null;
}

export function SessionsPage() {
  const { campaignId } = Route.useParams();
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editSession, setEditSession] = useState<SessionData | null>(null);
  const [confirmingActivateId, setConfirmingActivateId] = useState<string | null>(null);

  const { sessions, isLoading } = useSessions(campaignId, includeCompleted);
  const { create, isLoading: isCreating } = useCreateSession();
  const { update, isLoading: isUpdating } = useUpdateSession();
  const { activate, isLoading: isActivating } = useActivateSession();
  useCampaign(campaignId);

  const activeSession = (sessions as SessionData[]).find((s) => s.status === 'active');
  const hasActiveSession = !!activeSession;

  async function handleCreateSubmit(data: { name: string; startDate: string; endDate?: string }) {
    const result = await create({
      campaignId,
      name: data.name,
      startDate: new Date(data.startDate).toISOString(),
    });
    if (result) {
      setCreateModalOpen(false);
      return true;
    }
    return false;
  }

  async function handleEditSubmit(data: {
    name: string;
    startDate: string;
    endDate?: string;
    catchUp?: string;
  }) {
    if (!editSession) return false;
    const result = await update({
      sessionId: editSession.id,
      campaignId,
      name: data.name,
      startDate: new Date(data.startDate).toISOString(),
      endDate: data.endDate ? new Date(data.endDate).toISOString() : undefined,
      summary: data.catchUp,
    });
    if (result) {
      setEditSession(null);
      return true;
    }
    return false;
  }

  async function handleActivate(sessionId: string) {
    const result = await activate({ campaignId, sessionId });
    if (result) {
      setConfirmingActivateId(null);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#080A12]">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-[#080A12] border-b border-white/10">
        <div className="flex items-center gap-3">
          <Link
            to="/campaigns/$campaignId/play"
            params={{ campaignId }}
            search={{ tab: 'dashboard' }}
            aria-label="back"
          >
            <FontAwesomeIcon icon={faArrowLeft} className="h-4 w-4 text-white" />
          </Link>
          <h1 className="text-white font-bold uppercase text-lg">Sessions</h1>
        </div>
        <PixelButton
          variant="primary"
          size="sm"
          onClick={() => setCreateModalOpen(true)}
          type="button"
        >
          <FontAwesomeIcon icon={faPlus} className="h-3 w-3" />
          New Session
        </PixelButton>
      </div>

      {/* Filter toggle */}
      <div className="px-4 py-2 max-w-4xl mx-auto w-full">
        <label className="flex items-center gap-2 text-slate-400 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={includeCompleted}
            onChange={(e) => setIncludeCompleted(e.target.checked)}
          />
          Show completed sessions
        </label>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="max-w-4xl mx-auto w-full space-y-3">
          {isLoading ? (
            <p className="text-slate-400 text-sm text-center py-8">Loading...</p>
          ) : (sessions as SessionData[]).length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-8">No sessions yet</p>
          ) : (
            (sessions as SessionData[]).map((session) => {
              const isActive = session.status === 'active';
              const isCompleted = session.status === 'completed';
              const showActivate = session.status === 'not_started';

              return (
                <div
                  key={session.id}
                  data-testid={`session-card-${session.id}`}
                  role="button"
                  tabIndex={0}
                  className={`
                    rounded-lg border border-white/10 p-4 cursor-pointer transition-colors
                    ${isActive ? 'border-l-4 border-l-[#2563EB] bg-blue-950/20' : ''}
                    ${isCompleted ? 'opacity-60' : ''}
                  `}
                  onClick={() => setEditSession(session)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEditSession(session);
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold truncate">{session.name}</span>
                        {isActive && (
                          <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">
                            Active
                          </span>
                        )}
                        {isCompleted && (
                          <span className="text-xs bg-slate-600 text-white px-2 py-0.5 rounded">
                            Completed
                          </span>
                        )}
                      </div>
                      <div className="text-slate-400 text-sm mt-1">
                        {new Date(session.startDate).toLocaleDateString()}
                        {' — '}
                        {session.endDate
                          ? new Date(session.endDate).toLocaleDateString()
                          : 'In Progress'}
                      </div>
                    </div>
                    {/* role="presentation" — click handler only prevents event bubbling to parent card; child buttons are keyboard-accessible */}
                    {showActivate && (
                      <div
                        role="presentation"
                        className="ml-4 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {confirmingActivateId === session.id ? (
                          <div className="flex items-center gap-2 text-sm">
                            {hasActiveSession && (
                              <span className="text-amber-400 text-xs">
                                This will complete the active session.
                              </span>
                            )}
                            <button
                              className="text-green-400 hover:text-green-300 font-medium"
                              onClick={() => handleActivate(session.id)}
                              disabled={isActivating}
                            >
                              Confirm
                            </button>
                            <button
                              className="text-slate-400 hover:text-slate-300"
                              onClick={() => setConfirmingActivateId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            data-testid={`activate-btn-${session.id}`}
                            className="text-sm text-blue-400 hover:text-blue-300 font-medium"
                            onClick={() => setConfirmingActivateId(session.id)}
                          >
                            Activate
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Create modal */}
      <SessionModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSubmit={handleCreateSubmit}
        isLoading={isCreating}
      />

      {/* Edit modal */}
      <SessionModal
        isOpen={!!editSession}
        onClose={() => setEditSession(null)}
        onSubmit={handleEditSubmit}
        isLoading={isUpdating}
        session={editSession ?? undefined}
      />
    </div>
  );
}
