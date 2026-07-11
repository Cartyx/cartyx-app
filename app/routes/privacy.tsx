import { createFileRoute, Link } from '@tanstack/react-router';
import { Topbar } from '~/components/Topbar';

export const Route = createFileRoute('/privacy')({
  component: PrivacyPage,
});

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#080A12] flex flex-col">
      <Topbar />
      <main className="flex-1 w-full max-w-3xl mx-auto px-8 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors mb-10"
        >
          ← Back
        </Link>

        <h1 className="font-sans font-semibold text-[14px] text-white tracking-widest mb-2">
          PRIVACY POLICY
        </h1>
        <p className="text-xs text-slate-500 mb-10">Last updated: March 2026</p>

        <div className="space-y-8 text-sm text-slate-300 leading-relaxed">
          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              OVERVIEW
            </h2>
            <p>
              Cartyx is built to help you run great tabletop campaigns, not to harvest your data.
              This policy explains what information we collect, why we collect it, and how we use
              it. We keep it short because we genuinely don't collect much.
            </p>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              INFORMATION WE COLLECT
            </h2>
            <p>We collect only what is necessary to let you use Cartyx:</p>
            <ul className="mt-3 space-y-2 list-none">
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>
                  <strong className="text-slate-200">Account information</strong> — your name, email
                  address, and profile avatar, provided by your OAuth provider (Google, GitHub, or
                  Apple) when you sign in.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>
                  <strong className="text-slate-200">Campaign data</strong> — campaign names,
                  descriptions, scheduling info, and images that you create within the app.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>
                  <strong className="text-slate-200">Usage analytics</strong> — anonymised feature
                  usage events (e.g. which features you interact with) and error reports, collected
                  by Umami and GlitchTip, self-hosted on our own infrastructure. These are used
                  solely to improve the software; no data is shared with third-party analytics
                  providers.
                </span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              HOW WE USE YOUR INFORMATION
            </h2>
            <p>Your information is used exclusively to:</p>
            <ul className="mt-3 space-y-2 list-none">
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>Authenticate you and maintain your session</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>Store and display the campaign content you create</span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>Understand how features are used so we can improve the app</span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              WE DO NOT SELL YOUR DATA
            </h2>
            <p className="text-slate-200 font-medium">
              We do not sell, rent, or trade your personal information to anyone. Period.
            </p>
            <p className="mt-3">
              We do not share your data with third parties for advertising or marketing purposes. We
              have no plans to do so in the future.
            </p>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              THIRD-PARTY SERVICES
            </h2>
            <p>
              We use a small number of essential services to operate Cartyx. Your data may be
              processed by these providers only as necessary to run the service:
            </p>
            <ul className="mt-3 space-y-2 list-none">
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>
                  <strong className="text-slate-200">OAuth providers</strong> (Google, GitHub,
                  Apple) — handle authentication. Their privacy policies apply to the sign-in flow.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>
                  <strong className="text-slate-200">Cloudflare R2</strong> — stores campaign images
                  you upload.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>
                  <strong className="text-slate-200">Umami &amp; GlitchTip</strong> — self-hosted on
                  our own infrastructure; collect anonymised analytics events and error reports to
                  help us understand feature usage and fix bugs. No data is shared with third-party
                  analytics providers.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-blue-400 flex-shrink-0">·</span>
                <span>
                  <strong className="text-slate-200">Hosting provider</strong> — serves the
                  application and stores account and campaign data.
                </span>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              COOKIES
            </h2>
            <p>
              Cartyx uses session cookies only. These cookies are strictly necessary to keep you
              signed in while you use the app. We do not use advertising cookies, tracking pixels,
              or third-party analytics cookies — analytics and error reports go to Umami and
              GlitchTip (described above), both self-hosted on our own infrastructure.
            </p>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              DATA RETENTION
            </h2>
            <p>
              We retain your account and campaign data for as long as your account is active. If you
              stop using Cartyx, your data remains stored until you request deletion.
            </p>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              YOUR RIGHTS &amp; DATA DELETION
            </h2>
            <p>
              You can request deletion of your account and all associated data at any time. To do
              so, email us at{' '}
              <a
                href="mailto:privacy@cartyx.app"
                className="text-blue-400 hover:text-blue-300 transition-colors"
              >
                privacy@cartyx.app
              </a>
              . We will process your request within 30 days.
            </p>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              CHANGES TO THIS POLICY
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will indicate the date of the
              most recent update at the top of this page. Continued use of Cartyx after changes are
              posted constitutes your acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="font-sans font-semibold text-[9px] text-blue-400 tracking-wider mb-3">
              CONTACT
            </h2>
            <p>
              Questions about this policy? Reach out at{' '}
              <a
                href="mailto:privacy@cartyx.app"
                className="text-blue-400 hover:text-blue-300 transition-colors"
              >
                privacy@cartyx.app
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
