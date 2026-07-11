/**
 * E2E: Lore editor (create flow).
 *
 * Proves that a GM can open the Lore panel, click Create, fill in a title,
 * toggle the visibility to Public, submit the form, and see the newly created
 * lore entry appear in the list.
 *
 * Pre-conditions: `npm run dev:seed` must have run so that the GM session
 * cookie and campaign data exist in the dev DB.  Do NOT run this spec against
 * a production database.
 */
import { test, expect, openWikiTab } from '../fixtures/tabletop-fixtures';
import { blockPartyKit } from '../fixtures/network-mocks';

const LORE_TITLE = 'E2E Lore Editor Fixture';

/** Navigate to the campaign play page and drill down to the Lore panel. */
async function openLorePanel(
  page: import('@playwright/test').Page,
  campaignUrl: string
): Promise<void> {
  await page.goto(campaignUrl);

  // Open the Wiki tab in the InspectorSidebar (waits out cold-start hydration).
  await openWikiTab(page);

  // Drill into the Lore category.
  await page.getByRole('button', { name: 'Lore' }).click();
}

test.describe('Lore editor (create flow)', () => {
  test.beforeEach(async ({ page }) => {
    await blockPartyKit(page);
  });

  test('GM can create a new lore entry and see it in the list', async ({ page, campaignUrl }) => {
    await openLorePanel(page, campaignUrl);

    // Open the create modal.
    await page.getByTestId('lore-create-button').click();

    // The modal should be visible (identified by its heading).
    await expect(page.getByRole('dialog', { name: /Create Lore/i })).toBeVisible();

    // Fill in the title using the stable testid added to the FormInput.
    await page.getByTestId('lore-title-input').fill(LORE_TITLE);

    // Optionally type some content — target the CodeMirror editor's content
    // region. Content is not required by the form, but exercising it is good.
    const cmContent = page.locator('#lore-content-editor .cm-content').first();
    if (await cmContent.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cmContent.click();
      await page.keyboard.type('A legendary account written for automated testing.');
    }

    // Toggle visibility to Public. The radio is an `sr-only` input behind a
    // styled label, so click the visible label (native <label> toggles the
    // wrapped input) rather than the offscreen radio itself.
    await page
      .getByRole('dialog', { name: /Create Lore/i })
      .locator('label', { hasText: 'Public' })
      .click();

    // Submit the form.
    await page.getByRole('button', { name: 'Create Lore' }).click();

    // The modal should close and the new entry should appear in the list.
    await expect(page.getByRole('dialog', { name: /Create Lore/i })).toBeHidden({
      timeout: 10_000,
    });
    // Assert the lore CARD (a button whose accessible name includes the title)
    // is present — more robust than the title <h3>, which is truncate/min-w-0
    // and can read as zero-width. .first() because re-runs accumulate fixtures
    // with the same title in the dev DB.
    await expect(page.getByRole('button', { name: new RegExp(LORE_TITLE) }).first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
