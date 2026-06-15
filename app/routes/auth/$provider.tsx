import { createFileRoute, redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { setCookie } from '@tanstack/react-start/server';
import { z } from 'zod';
import {
  buildGoogleOAuthUrl,
  buildGithubOAuthUrl,
  buildAppleOAuthUrl,
  providerConfigured,
  generateCodeVerifier,
  deriveCodeChallenge,
} from '~/server/utils/oauth';

const VALID_PROVIDERS = ['google', 'github', 'apple'] as const;

const initiateOAuth = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ provider: z.enum(VALID_PROVIDERS) }))
  .handler(async ({ data }) => {
    const { provider } = data;

    if (!providerConfigured(provider)) {
      throw redirect({ to: '/', search: { reason: 'provider_not_configured' } });
    }

    // Generate CSRF state token
    const { randomBytes } = await import('node:crypto');
    const state = randomBytes(32).toString('hex');

    // Generate PKCE verifier + S256 challenge. The verifier is the secret kept
    // server-side (in a cookie, same lifecycle as state); the challenge travels
    // on the authorize request and is verified by the provider at token exchange.
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = deriveCodeChallenge(codeVerifier);

    // Store state + PKCE verifier in httpOnly cookies (short-lived, 10 min).
    // Same mechanism/lifetime: created at authorize, consumed at callback.
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      maxAge: 600,
      path: '/',
    };
    setCookie('oauth_state', state, cookieOpts);
    setCookie('oauth_code_verifier', codeVerifier, cookieOpts);

    let url: string;
    switch (provider) {
      case 'google':
        url = buildGoogleOAuthUrl(state, codeChallenge);
        break;
      case 'github':
        url = buildGithubOAuthUrl(state, codeChallenge);
        break;
      case 'apple':
        url = buildAppleOAuthUrl(state, codeChallenge);
        break;
    }

    return { redirectUrl: url };
  });

export const Route = createFileRoute('/auth/$provider')({
  beforeLoad: async ({ params }) => {
    const provider = params.provider as string;
    if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
      throw redirect({ to: '/' });
    }
    const result = await initiateOAuth({
      data: { provider: provider as (typeof VALID_PROVIDERS)[number] },
    });
    if (result?.redirectUrl) {
      throw redirect({ href: result.redirectUrl });
    }
  },
  component: () => null,
});
