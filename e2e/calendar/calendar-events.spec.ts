/**
 * E2E: Calendar & Events.
 *
 * Proves that a GM can:
 *   1. Open the Wiki tab, drill into the Calendar category, and see the seeded
 *      events rendered in the calendar's default (list) view — including
 *      "The Siege of Phandalin".
 *   2. Open the GM-only Events category, click Create, fill in a title, submit
 *      the EventModal, and see the new event appear.
 *
 * Mirrors e2e/lore/lore-editor.spec.ts (fixtures, PostHog/PartyKit mocks, GM
 * session via globalSetup).
 *
 * Pre-conditions: `npm run dev:seed` must have run so that the GM session
 * cookie + campaign data exist in the dev DB, AND the seed must have created a
 * "Calendar of Harptos" with its events (Task 19). Do NOT run this spec against
 * a production database.
 */
import { test, expect } from '../fixtures/tabletop-fixtures';
import { mockPostHog, blockPartyKit } from '../fixtures/network-mocks';

test.describe('Calendar & Events', () => {
  test.beforeEach(async ({ page }) => {
    await mockPostHog(page);
    await blockPartyKit(page);
  });

  test('GM sees seeded events on the calendar list', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);

    // Open the Wiki tab in the InspectorSidebar.
    await page.getByRole('tab', { name: 'Wiki' }).click();

    // Drill into the Calendar category (visible to all members).
    await page.getByRole('button', { name: 'Calendar' }).click();

    // The calendar defaults to the list view, which renders event-list.
    await expect(page.getByTestId('event-list')).toBeVisible({ timeout: 10_000 });

    // The seeded epic event should be present in the list. Scope to the list:
    // the dashboard's CampaignTimelineWidget stays mounted behind the wiki
    // panel and renders the same title in a mobile-only (display:none) copy,
    // which an unscoped getByText().first() matches by DOM order and then
    // waits forever for it to become visible.
    await expect(
      page.getByTestId('event-list').getByText('The Siege of Phandalin').first()
    ).toBeVisible();
  });

  test('GM can create an event via the Events manager', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);

    // Open the Wiki tab in the InspectorSidebar.
    await page.getByRole('tab', { name: 'Wiki' }).click();

    // Drill into the GM-only Events category.
    await page.getByRole('button', { name: 'Events' }).click();

    // Open the create modal.
    await page.getByTestId('event-create-button').click();

    // The EventModal renders as a dialog (the <form role="dialog">).
    await expect(page.getByRole('dialog')).toBeVisible();

    // Fill in the title using the stable testid on the FormInput.
    await page.getByTestId('event-title-input').fill('E2E Festival');

    // Submit. The start date defaults to the calendar's currentDate (a valid
    // date), so title + submit is enough to create the event.
    await page.getByRole('button', { name: /Create Event/i }).click();

    // Creation is confirmed by the modal closing — wait for that first so the
    // list assertion gets its own full timeout on slow CI runners.
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 10_000 });

    // The new event should appear. .first() because re-runs accumulate events
    // with the same title in the dev DB.
    await expect(page.getByText('E2E Festival').first()).toBeVisible({ timeout: 10_000 });
  });
});
