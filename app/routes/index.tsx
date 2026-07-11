import React from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';
import { useEffect, useState } from 'react';
import { useAuth } from '~/hooks/useAuth';
import { showToast } from '~/components/Toast';
import { formatInviteCode } from '~/utils/helpers';
import { captureEvent } from '~/utils/telemetry-client';
import { LegalFooter } from '~/components/LegalFooter';

export const Route = createFileRoute('/')({
  validateSearch: z.object({ reason: z.string().optional() }),
  component: LandingPage,
});

function ProviderButton({
  provider,
  icon,
  label,
  colorClass,
}: {
  provider: 'google' | 'github' | 'apple';
  icon: React.ReactNode;
  label: string;
  colorClass: string;
}) {
  return (
    <a
      href={`/auth/${provider}`}
      onMouseDown={() => captureEvent('login_provider_clicked', { provider })}
      className={`w-full flex items-center gap-3 px-5 py-3.5 rounded-xl border bg-white/[0.04]
        text-slate-200 text-sm font-medium transition-all duration-200
        hover:-translate-y-px hover:bg-white/[0.08] hover:shadow-lg ${colorClass}`}
    >
      <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      <span className="text-slate-500 text-base">›</span>
    </a>
  );
}

function LandingPage() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const navigate = useNavigate();
  const { reason } = Route.useSearch();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  // Once auth is known, redirect authenticated GMs/Players
  useEffect(() => {
    if (!isLoading && isAuthenticated && user && user.role !== 'unknown') {
      navigate({ to: '/campaigns' });
    }
  }, [isLoading, isAuthenticated, user, navigate]);

  function joinWithCode() {
    const code = inviteCode.trim().toUpperCase();
    if (!code) return;
    // TODO: Implement join route/server function to process invite codes
    showToast('Invite code joining is coming soon!');
  }

  function handleInviteInput(e: React.ChangeEvent<HTMLInputElement>) {
    setInviteCode(formatInviteCode(e.target.value));
  }

  const roleInfo = {
    gm: { label: '⚔️ Game Master', cls: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
    player: { label: '🗺️ Player', cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25' },
    unknown: { label: '👤 Guest', cls: 'bg-slate-500/15 text-slate-400 border-slate-500/25' },
  };

  return (
    <div className="min-h-screen bg-[#080A12] flex overflow-hidden">
      {/* Left art panel */}
      <div
        className="flex-1 relative flex flex-col justify-end p-10 min-h-screen overflow-hidden
          bg-cover bg-center hidden md:flex"
        style={{ backgroundImage: "url('/cartyx-fortress.jpg')" }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to right, rgba(8,10,18,0) 0%, rgba(8,10,18,0.2) 70%, rgba(8,10,18,0.95) 100%), linear-gradient(to top, rgba(8,10,18,0.9) 0%, transparent 50%), rgba(10,30,80,0.35)',
          }}
        />
        <div className="relative z-10 max-w-md">
          <div className="font-sans font-semibold text-[9px] tracking-[3px] text-blue-400/80 uppercase mb-3">
            {isAuthenticated && user?.role === 'gm'
              ? 'Game Master Portal'
              : isAuthenticated && user?.role === 'player'
                ? 'Welcome back'
                : 'Welcome to Cartyx'}
          </div>
          <div
            className="font-sans font-semibold text-[22px] leading-relaxed text-white mb-4"
            style={{ textShadow: '0 0 30px rgba(100,181,246,0.3)' }}
          >
            {isAuthenticated && user?.role === 'gm' ? (
              <>
                YOUR REALM
                <br />
                AWAITS
              </>
            ) : isAuthenticated && user?.role === 'player' ? (
              <>
                YOUR
                <br />
                ADVENTURE
              </>
            ) : (
              <>
                ENTER THE
                <br />
                REALM
              </>
            )}
          </div>
          <p className="text-sm text-slate-400 font-light leading-relaxed">
            {isAuthenticated && user?.role === 'gm'
              ? 'Create campaigns, invite players, and forge legendary adventures.'
              : isAuthenticated && user?.role === 'player'
                ? 'Continue your journey and check on your campaigns.'
                : 'Your adventure begins with a single step through the gate.'}
          </p>
        </div>
      </div>

      {/* Right auth panel */}
      <div className="w-full md:w-[440px] md:min-w-[440px] min-h-screen bg-[rgba(10,12,20,0.98)] border-l border-white/[0.06] flex flex-col items-center justify-center px-10 py-12">
        <img
          src="/cartyx-logo-pixel.jpg"
          alt="Cartyx"
          className="w-44 h-44 object-cover rounded-lg mb-4"
          style={{
            imageRendering: 'pixelated',
            filter: 'sepia(1) hue-rotate(185deg) saturate(3) brightness(0.7) contrast(1.2)',
          }}
        />

        {reason === 'auth_failed' && (
          <div className="w-full mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
            Authentication failed. Please try again.
          </div>
        )}
        {reason === 'internal_error' && (
          <div className="w-full mb-4 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center">
            An internal server error occurred. Please try again later or contact support if the
            problem persists.
          </div>
        )}
        {reason === 'session_expired' && (
          <div className="w-full mb-4 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm text-center">
            Your session has expired. Please sign in again.
          </div>
        )}
        {reason === 'provider_not_configured' && (
          <div className="w-full mb-4 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm text-center">
            The selected sign-in provider is not configured. Please try another sign-in option or
            contact support.
          </div>
        )}

        {!isLoading && isAuthenticated && user ? (
          /* Logged-in state */
          <div className="w-full">
            <div className="w-full bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-3 mb-4">
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    className="w-12 h-12 rounded-full border-2 border-blue-400/30 object-cover"
                    alt=""
                  />
                ) : (
                  <div className="w-12 h-12 rounded-full border-2 border-blue-400/30 bg-blue-900/30 flex items-center justify-center text-xl">
                    🧙
                  </div>
                )}
                <div>
                  <div className="text-[15px] font-semibold text-slate-100">
                    {user.name ?? 'Adventurer'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">{user.email ?? ''}</div>
                </div>
                <div className="ml-auto">
                  {user.role in roleInfo && (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${roleInfo[user.role as keyof typeof roleInfo].cls}`}
                    >
                      {roleInfo[user.role as keyof typeof roleInfo].label}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {(user.role === 'gm' || user.role === 'player') && (
              <a
                href="/campaigns"
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-gradient-to-r from-blue-700 to-blue-600 text-white font-semibold text-sm mb-2.5 hover:-translate-y-px hover:shadow-lg hover:shadow-blue-500/30 transition-all"
              >
                {user.role === 'gm' ? '⚔️' : '🗺️'} My Campaigns
              </a>
            )}

            {user.role === 'unknown' && (
              <div className="w-full mb-4">
                <p className="text-center text-sm text-slate-500 mb-3">
                  You don't have access yet.
                  <br />
                  Ask your GM for an invite code.
                </p>
                <div className="flex gap-2">
                  <input
                    className="flex-1 py-3 px-4 bg-white/[0.04] border border-white/[0.08] rounded-xl text-slate-200 font-sans font-semibold text-xs tracking-wider focus:outline-none focus:border-blue-400/40"
                    placeholder="XXXX-XXXX"
                    maxLength={9}
                    value={inviteCode}
                    onChange={handleInviteInput}
                    onKeyDown={(e) => e.key === 'Enter' && joinWithCode()}
                  />
                  <button
                    onClick={joinWithCode}
                    className="px-4 py-3 bg-gradient-to-br from-blue-700 to-blue-600 rounded-xl text-white text-sm hover:-translate-y-px hover:shadow-lg transition-all"
                  >
                    →
                  </button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => logout()}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-white/[0.08] text-slate-400 text-sm font-medium hover:border-white/15 hover:text-slate-200 transition-all"
            >
              Sign Out
            </button>
          </div>
        ) : !isLoading ? (
          /* Logged-out state */
          <div className="w-full">
            <h2 className="text-[22px] font-semibold text-slate-100 mb-1.5 text-center">
              Link Your Account
            </h2>
            <p className="text-sm text-slate-500 text-center mb-9 leading-relaxed">
              Choose how you'd like to enter the realm
            </p>

            <div className="flex flex-col gap-3 w-full">
              <ProviderButton
                provider="google"
                label="Continue with Google"
                colorClass="border-blue-500/30 hover:border-blue-500/60"
                icon={
                  <svg width="18" height="18" viewBox="0 0 18 18">
                    <path
                      fill="#4285F4"
                      d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
                    />
                    <path
                      fill="#34A853"
                      d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                    />
                    <path
                      fill="#EA4335"
                      d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"
                    />
                  </svg>
                }
              />
              <ProviderButton
                provider="github"
                label="Continue with GitHub"
                colorClass="border-white/12 hover:border-white/25"
                icon={
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff">
                    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                  </svg>
                }
              />
              <ProviderButton
                provider="apple"
                label="Continue with Apple"
                colorClass="border-white/12 hover:border-white/25"
                icon={
                  <svg width="16" height="18" viewBox="0 0 814 1000" fill="#fff">
                    <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-207.5 135.4-317.3 269.5-317.3 124.4 0 173 77.6 185.9 77.6 13.6 0 73.5-80.5 207.2-80.5 62.9 0 162.8 10.8 215.1 97.6zm-234.7-76.4c-19.4-37.5-5.7-107.8 44.8-150.4 27.8-22.6 78.2-38.9 89.3-41.3.5 3.5 1.3 9.3 1.3 20.6 0 71-49.2 127.2-69.6 134.6-12.7 4.6-62.9 38.5-65.8 36.5z" />
                  </svg>
                }
              />
            </div>

            <div className="flex items-center gap-3 my-5 text-slate-600 text-xs">
              <span className="flex-1 h-px bg-white/[0.06]" />
              or
              <span className="flex-1 h-px bg-white/[0.06]" />
            </div>

            {showInvite ? (
              <div className="w-full">
                <label htmlFor="landing-invite-code" className="block text-xs text-slate-500 mb-2">
                  Have an invite code?
                </label>
                <div className="flex gap-2">
                  <input
                    id="landing-invite-code"
                    className="flex-1 py-3 px-4 bg-white/[0.04] border border-white/[0.08] rounded-xl text-slate-200 font-sans font-semibold text-xs tracking-wider focus:outline-none focus:border-blue-400/40"
                    placeholder="XXXX-XXXX"
                    maxLength={9}
                    value={inviteCode}
                    onChange={handleInviteInput}
                    onKeyDown={(e) => e.key === 'Enter' && joinWithCode()}
                  />
                  <button
                    onClick={joinWithCode}
                    className="px-4 py-3 bg-gradient-to-br from-blue-800 to-blue-600 rounded-xl text-white text-sm hover:-translate-y-px hover:shadow-lg transition-all"
                  >
                    →
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <button
                  onClick={() => setShowInvite(true)}
                  className="text-xs text-slate-500 underline hover:text-slate-400 transition-colors bg-transparent border-none cursor-pointer"
                >
                  Have an invite code?
                </button>
              </div>
            )}

            <LegalFooter />
          </div>
        ) : null}
      </div>
    </div>
  );
}
