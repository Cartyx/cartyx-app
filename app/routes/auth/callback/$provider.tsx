import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getCookie, deleteCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import {
  exchangeGoogleCode,
  exchangeGithubCode,
  exchangeAppleCode,
  upsertUser,
} from '~/server/utils/oauth';
import { setSession } from '~/server/session';
import { serverCaptureException, serverCaptureEvent } from '~/server/utils/posthog';

const VALID_PROVIDERS = ['google', 'github', 'apple'] as const;

const handleCallback = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({ provider: z.enum(VALID_PROVIDERS), code: z.string(), state: z.string() })
  )
  .handler(
    async ({ data }): Promise<{ redirectTo: string; redirectSearch?: Record<string, string> }> => {
      const { provider, code, state } = data;

      // Verify CSRF state token and retrieve the PKCE verifier. Both were set at
      // authorize time with the same lifetime; consume (delete) both here.
      const storedState = getCookie('oauth_state');
      const codeVerifier = getCookie('oauth_code_verifier');
      deleteCookie('oauth_state', { path: '/' });
      deleteCookie('oauth_code_verifier', { path: '/' });

      if (!storedState || storedState !== state) {
        await serverCaptureException(new Error('CSRF state mismatch'), undefined, {
          action: 'handleOAuthCallback',
          provider,
          hasStoredState: !!storedState,
        });
        return { redirectTo: '/', redirectSearch: { reason: 'auth_failed_csrf' } };
      }

      try {
        let profile;
        if (provider === 'google') {
          profile = await exchangeGoogleCode(code, codeVerifier);
        } else if (provider === 'github') {
          profile = await exchangeGithubCode(code, codeVerifier);
        } else if (provider === 'apple') {
          profile = await exchangeAppleCode(code, codeVerifier);
        } else {
          throw new Error(`Unsupported provider: ${provider}`);
        }

        const user = await upsertUser(profile);
        await setSession(user);
        await serverCaptureEvent(user.id, 'user_logged_in', { provider });
        return { redirectTo: '/campaigns' };
      } catch (e) {
        const errMessage = e instanceof Error ? e.message : String(e);
        console.error('[oauth-callback] failed', provider, e);
        await serverCaptureException(e, undefined, {
          action: 'handleOAuthCallback',
          provider,
          errorType: 'internal',
          errorMessage: errMessage,
        });
        return { redirectTo: '/', redirectSearch: { reason: 'internal_error' } };
      }
    }
  );

export const Route = createFileRoute('/auth/callback/$provider')({
  validateSearch: z.object({
    code: z.string().optional(),
    error: z.string().optional(),
    state: z.string().optional(),
  }),
  beforeLoad: async ({ params, search }) => {
    if (search.error || !search.code || !search.state) {
      throw redirect({ to: '/', search: { reason: 'auth_failed' } });
    }
    if (!VALID_PROVIDERS.includes(params.provider as (typeof VALID_PROVIDERS)[number])) {
      throw redirect({ to: '/', search: { reason: 'auth_failed' } });
    }
    const result = await handleCallback({
      data: {
        provider: params.provider as (typeof VALID_PROVIDERS)[number],
        code: search.code,
        state: search.state,
      },
    });
    throw redirect({ to: result.redirectTo, search: result.redirectSearch });
  },
  component: () => null,
});
