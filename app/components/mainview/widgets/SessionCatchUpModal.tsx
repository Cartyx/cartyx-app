import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { faBookOpen } from '@fortawesome/pro-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useSessionCatchUp } from '~/hooks/useSessions';
import { MARKDOWN_PROSE_CLASSES } from '~/utils/markdownProseClasses';
import type { Session } from './SessionsListWidget';

interface SessionCatchUpModalProps {
  /** The session to show a catch-up for; `null` keeps the modal closed. */
  session: Session | null;
  /**
   * Campaign the session belongs to. Required to fetch the catch-up on demand —
   * the campaign payload only ships the active session's catch-up, so non-active
   * sessions are fetched here by id. When omitted (Storybook/tests), the modal
   * falls back to the catch-up carried on the session object.
   */
  campaignId?: string;
  onClose: () => void;
}

export function SessionCatchUpModal({ session, campaignId, onClose }: SessionCatchUpModalProps) {
  const shouldFetch = Boolean(campaignId && session);
  const { catchUp: fetchedCatchUp, isLoading } = useSessionCatchUp(
    shouldFetch ? campaignId! : '',
    shouldFetch ? session!.id : ''
  );

  useEffect(() => {
    if (!session) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [session, onClose]);

  if (!session) return null;

  // Prefer the freshly fetched catch-up; fall back to whatever the session
  // object carries when we have no campaign to fetch from (Storybook/tests).
  const catchUp = shouldFetch ? fetchedCatchUp : (session.catchUp ?? null);
  const showLoading = shouldFetch && isLoading;

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-2 sm:p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-catchup-modal-title"
        className="w-full max-w-2xl max-h-[90vh] bg-[#0D1117] border border-white/[0.07] rounded-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <FontAwesomeIcon
              icon={faBookOpen}
              className="text-blue-400 text-lg shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="font-sans font-semibold text-[10px] uppercase tracking-widest text-slate-500">
                Session {session.number} · Catch Up
              </p>
              <h2
                id="session-catchup-modal-title"
                className="font-sans font-bold text-sm text-blue-400 truncate"
              >
                {session.name}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors shrink-0"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-6">
          {showLoading ? (
            <div className="flex items-center justify-center py-12">
              <p className="font-sans font-semibold text-xs text-slate-500 animate-pulse">
                Loading catch-up...
              </p>
            </div>
          ) : catchUp ? (
            <div className={`w-full ${MARKDOWN_PROSE_CLASSES} text-xs`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{catchUp}</ReactMarkdown>
            </div>
          ) : (
            <div className="flex items-center justify-center py-12">
              <p className="font-sans font-semibold text-xs text-slate-500">
                No catch-up content available for this session.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
