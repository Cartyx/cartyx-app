import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { getMe } from '~/server/functions/rpc';
import { JoinWizard } from '~/components/join-wizard/JoinWizard';

export const joinSearchSchema = z.object({
  code: z.string().optional(),
  step: z.coerce.number().min(1).max(6).catch(1),
  campaignId: z.string().optional(),
});

export const Route = createFileRoute('/campaign/join')({
  validateSearch: (search: Record<string, unknown>) => joinSearchSchema.parse(search),
  beforeLoad: async () => {
    const user = await getMe();
    if (!user) throw redirect({ to: '/', search: { reason: 'session_expired' } });
    return { user };
  },
  component: JoinPage,
});

function JoinPage() {
  return <JoinWizard />;
}
