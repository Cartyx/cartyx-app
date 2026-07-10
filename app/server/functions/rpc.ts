import { createServerFn } from '@tanstack/react-start';
import { getCampaignSchema } from '~/types/schemas/campaigns';

// ---------------------------------------------------------------------------
// Route-facing RPC wrappers.
//
// The functions in ~/server/functions/* are plain async functions (they import
// Mongoose and other server-only code). Route loaders run on the client during
// navigation, so they must call these through `createServerFn` — which strips
// the dynamically-imported server body from the client bundle AND registers the
// function in the server resolver manifest. Importing the plain functions
// directly from a route would leak server code into the client bundle.
//
// Hooks/components wrap their own server calls the same way (see app/hooks/*).
// ---------------------------------------------------------------------------

export const getMe = createServerFn({ method: 'GET' }).handler(async () => {
  const { getMe } = await import('~/server/functions/auth');
  return getMe();
});

export const listCampaigns = createServerFn({ method: 'GET' }).handler(async () => {
  const { listCampaigns } = await import('~/server/functions/campaigns');
  return listCampaigns();
});

export const getCampaign = createServerFn({ method: 'GET' })
  .inputValidator(getCampaignSchema)
  .handler(async ({ data }) => {
    const { getCampaign } = await import('~/server/functions/campaigns');
    return getCampaign({ data });
  });

export const healthCheck = createServerFn({ method: 'GET' }).handler(async () => {
  const { healthCheck } = await import('~/server/functions/health');
  return healthCheck();
});
