import { createFileRoute, redirect } from '@tanstack/react-router';
import { getMe } from '~/server/functions/rpc';
import { Topbar } from '~/components/Topbar';
import { useAuth } from '~/hooks/useAuth';

export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const user = await getMe();
    if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
    return { user };
  },
  component: DashboardPage,
});

function DashboardPage() {
  const { user } = Route.useRouteContext();
  const { logout } = useAuth();

  const expiresIn = null; // JWT-based, no server-side session expiry tracker

  const providerBadge: Record<string, string> = {
    google: 'bg-blue-500/10 text-blue-300 border border-blue-500/30',
    github: 'bg-white/5 text-slate-300 border border-white/15',
    apple: 'bg-white/5 text-slate-100 border border-white/15',
  };

  return (
    <div className="min-h-screen bg-[#0E101C] text-[#c9b89e] flex flex-col">
      <Topbar />
      <div className="flex-1 flex items-center justify-center py-16">
        <div className="bg-gradient-to-br from-[#0E101C] to-[#10121E] border border-blue-900/20 rounded-2xl p-10 max-w-lg w-full mx-4 text-center shadow-2xl">
          <h1 className="text-[#e8d5b7] text-2xl font-bold mb-1">⚔️ Welcome, Adventurer</h1>
          <p className="text-[#8a7a6a] text-sm mb-6">You have entered the realm</p>

          {user.avatar ? (
            <img
              src={user.avatar}
              alt="avatar"
              className="w-20 h-20 rounded-full border-4 border-amber-600/40 mx-auto mb-4 object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-full border-4 border-amber-600/40 mx-auto mb-4 bg-[#2a2218] flex items-center justify-center text-3xl">
              🧙
            </div>
          )}

          <div className="text-left bg-[#13100c] rounded-xl p-4 mb-4 text-sm leading-relaxed space-y-1">
            <div>
              <span className="text-[#8a7a6a]">Name: </span>
              <span className="text-[#e8d5b7]">{user.name}</span>
            </div>
            <div>
              <span className="text-[#8a7a6a]">Email: </span>
              <span className="text-[#e8d5b7]">{user.email ?? 'Not provided'}</span>
            </div>
            <div>
              <span className="text-[#8a7a6a]">Provider: </span>
              <span
                className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide ${providerBadge[user.provider] ?? ''}`}
              >
                {user.provider}
              </span>
            </div>
            <div>
              <span className="text-[#8a7a6a]">User ID: </span>
              <span className="text-[#e8d5b7] text-xs opacity-70">{user.id}</span>
            </div>
            <div>
              <span className="text-[#8a7a6a]">Role: </span>
              <span className="text-[#e8d5b7]">{user.role}</span>
            </div>
          </div>

          {expiresIn !== null && (
            <div className="bg-[#1e1a14] border border-[#332b20] rounded-xl px-4 py-3 mb-4 text-xs text-[#8a7a6a]">
              ⏳ Session active for <strong className="text-[#c9b89e]">{expiresIn} minutes</strong>
            </div>
          )}

          <div className="flex gap-3 justify-center flex-wrap mt-6">
            <a
              href="/campaigns"
              className="px-6 py-2.5 rounded-xl bg-[#2a3a4a] text-[#7ea8e8] border border-[#3a5a7a] text-sm font-medium hover:bg-[#3a4a5a] transition-colors"
            >
              ⚔️ My Campaigns
            </a>
            <button
              type="button"
              onClick={() => logout()}
              className="px-6 py-2.5 rounded-xl bg-[#4a2a2a] text-[#e87e7e] border border-[#6a3a3a] text-sm font-medium hover:bg-[#5a3a3a] transition-colors"
            >
              🚪 Sign Out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
