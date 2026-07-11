# Cartyx ⚔️

D&D Campaign Management Platform — organize sessions, manage players, and run your tabletop world.

Built with [TanStack Start](https://tanstack.com/start), React, and a retro pixel-art aesthetic.

## Quick Start

```bash
git clone https://github.com/biozal/cartyx-app.git
cd cartyx-app
npm install
cp .env.example .env   # fill in credentials (see docs/deployment.md)
npm run dev            # http://localhost:3000
```

## Features

- **OAuth Authentication** — Google, GitHub, Apple Sign-In (via JOSE/JWT)
- **Campaign Management** — Create, edit, and manage D&D campaigns
- **Player Invites** — Share invite codes for players to join
- **Session Scheduling** — Weekly/bi-weekly/monthly with timezone support
- **Image Uploads** — Campaign images stored on Cloudflare R2
- **Access Control** — GM and player roles with owner-only actions
- **Feature Flags** — build-time flags baked into the client bundle for progressive rollouts

## Tech Stack

| Layer             | Technology                                                                          |
| ----------------- | ----------------------------------------------------------------------------------- |
| **Framework**     | [TanStack Start](https://tanstack.com/start) (full-stack React)                     |
| **UI**            | React 19 + [Tailwind CSS v4](https://tailwindcss.com)                               |
| **Routing**       | [TanStack Router](https://tanstack.com/router) (file-based, type-safe)              |
| **Auth**          | Custom OAuth (Google, GitHub, Apple) via [JOSE](https://github.com/panva/jose) JWT  |
| **Database**      | MongoDB Atlas ([Mongoose](https://mongoosejs.com))                                  |
| **Image Storage** | [Cloudflare R2](https://developers.cloudflare.com/r2/) (S3-compatible)              |
| **Dates**         | [Day.js](https://day.js.org) with timezone + relative time plugins                  |
| **Build**         | [Vite](https://vitejs.dev) + [Nitro](https://nitro.build/)                          |
| **Testing**       | [Vitest](https://vitest.dev) + [React Testing Library](https://testing-library.com) |
| **Linting**       | ESLint (flat config) + Prettier                                                     |
| **Hosting**       | [Vercel](https://vercel.com) (serverless)                                           |
| **CDN**           | [Cloudflare](https://cloudflare.com) (DNS + R2 CDN)                                 |

## Project Structure

All application code lives in `app/`:

```
app/
├── components/      # React components + Storybook stories
├── hooks/           # Custom React hooks (useAuth, useCampaigns)
├── routes/          # TanStack Router file-based routes
├── server/
│   ├── functions/   # Server functions (auth, campaigns, uploads)
│   ├── models/      # Mongoose models
│   └── utils/       # Server utilities (OAuth, helpers)
├── styles/          # Global CSS (Tailwind)
├── utils/           # Client utilities (date, image compression)
├── client.tsx       # Client entry point
├── router.tsx       # TanStack Router config
└── ssr.tsx          # SSR entry point

tests/               # Vitest test files (mirrors app/ structure)
.storybook/          # Storybook configuration and mocks
```

## Development

```bash
npm run dev            # Vite dev server with HMR
npm run build          # Production build
npm run typecheck      # TypeScript type checking
npm run lint           # ESLint check
npm run lint:fix       # Auto-fix lint issues
npm run format         # Prettier format
npm test               # Run tests
npm run test:watch     # TDD watch mode
npm run test:coverage  # Coverage report
```

### Dev Data Scripts

Standalone Python scripts for seeding and clearing test data in MongoDB. These are
intentionally separate from the app's TypeScript codebase — simple, dependency-free
(just pymongo), and easy to modify.

```bash
# One-time setup
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install -r scripts/requirements.txt

# Seed 3 test campaigns with sessions, characters, and placeholder images
npm run dev:seed

# Wipe all campaign data (interactive confirmation)
npm run dev:clear
npm run dev:clear -- --force   # skip confirmation
```

Both scripts require `MONGODB_URI` to be set and refuse to run against production databases.

## Feature Flags

Client-side feature flags are plain booleans baked into the client bundle from `VITE_PUBLIC_FF_*` env values at build time, read through [`app/utils/featureFlags.tsx`](app/utils/featureFlags.tsx):

```tsx
import { useOptionalFeatureFlag } from '~/utils/featureFlags';

function ExperimentalPanel() {
  const { isEnabled } = useOptionalFeatureFlag(import.meta.env.VITE_PUBLIC_FF_EXPERIMENTAL);

  if (!isEnabled) return null;

  return <section>…</section>;
}
```

Changing a flag value requires a rebuild (dev-server restart or a new image build).

## Observability

Cartyx runs its own self-hosted observability stack — no third-party analytics providers:

- **[glitchtip.cartyx.io](https://glitchtip.cartyx.io)** — error tracking (Sentry-protocol ingest). Client and server errors are captured via `app/utils/telemetry-client.ts` and `app/server/utils/telemetry.ts`.
- **[umami.cartyx.io](https://umami.cartyx.io)** — privacy-friendly page-view and event analytics.
- **[grafana.cartyx.io](https://grafana.cartyx.io)** — cluster metrics, logs, and dashboards.

Telemetry is configured via `GLITCHTIP_DSN` / `UMAMI_WEBSITE_ID` (server, runtime) and `VITE_PUBLIC_GLITCHTIP_DSN` / `VITE_PUBLIC_UMAMI_WEBSITE_ID` (client, baked in at build time) — all four are optional and default to a safe no-op when unset. See `.env.example`.

URLs, logins, and day-to-day usage for all three UIs: [docs/observability.md](docs/observability.md).

## Component Library

The published Storybook is available at [https://biozal.github.io/cartyx-app](https://biozal.github.io/cartyx-app).

For contributor setup, story-writing patterns, interaction tests, and Storybook-specific project conventions, see [docs/STORYBOOK.md](docs/STORYBOOK.md).

## Environments

| Environment    | URL              | Branch        | Database             |
| -------------- | ---------------- | ------------- | -------------------- |
| **Production** | `app.cartyx.io`  | `main`        | MongoDB Atlas (prod) |
| **Staging**    | `dev.cartyx.io`  | `dev`         | MongoDB Atlas (dev)  |
| **PR Preview** | `*.vercel.app`   | any PR branch | MongoDB Atlas (dev)  |
| **Local**      | `localhost:3000` | any           | Local or Atlas dev   |

## Branching Strategy

```
feature/my-feature → PR against dev → preview URL → merge to dev (staging)
                                                   → PR dev→main → production
```

- Feature branches target `dev`
- `dev` → `dev.cartyx.io` (stable staging)
- `main` → `app.cartyx.io` (production)
- Every PR gets an automatic Vercel preview URL

## Deployment

See [docs/deployment.md](docs/deployment.md) for complete setup instructions including:

- Vercel project configuration
- MongoDB Atlas setup
- OAuth provider setup (Google, GitHub, Apple)
- Cloudflare DNS and R2 image storage
- Environment variables reference

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development standards, testing requirements, and PR checklist.

## License

MIT — see [LICENSE](LICENSE)
