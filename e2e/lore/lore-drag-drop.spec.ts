/**
 * E2E: Lore card drag-and-drop onto the tabletop workspace.
 *
 * Proves that a GM can drag the first lore card from the Wiki → Lore panel
 * onto the tabletop workspace and a floating lore window appears on the surface.
 *
 * Drag technique: the same HTML5 dataTransfer dispatch approach used by
 * tabletop-monster-tokens.spec.ts (dropOnMap).  Here we target
 * `tabletop-workspace` instead of `active-map-stage` because lore cards open
 * as floating wiki windows, not as map tokens.
 *
 * Pre-conditions: `npm run dev:seed` must have run so that (a) the GM session
 * cookie exists, (b) the campaign has at least one seeded lore entry, and (c)
 * a tabletop screen exists (globalSetup guarantees this).  Do NOT run against
 * a production database.
 */
import { test, expect } from '../fixtures/tabletop-fixtures';
import { mockPostHog, blockPartyKit } from '../fixtures/network-mocks';

/**
 * Dispatch a real HTML5 drop of a wiki document onto the tabletop workspace.
 *
 * Mirrors the `dropOnMap` helper in tabletop-monster-tokens.spec.ts exactly,
 * with the only difference being the target testid (`tabletop-workspace`
 * rather than `active-map-stage`).
 */
async function dropOnWorkspace(
  page: import('@playwright/test').Page,
  payload: { collection: string; documentId: string; title: string },
  offset: { dx: number; dy: number } = { dx: 0, dy: 0 }
): Promise<void> {
  await page.evaluate(
    ({ payload, offset }) => {
      const workspace = document.querySelector(
        '[data-testid="tabletop-workspace"]'
      ) as HTMLElement | null;
      if (!workspace) throw new Error('tabletop-workspace not found');
      const rect = workspace.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2 + offset.dx;
      const clientY = rect.top + rect.height / 2 + offset.dy;
      const dt = new DataTransfer();
      dt.setData('application/x-cartyx-document', JSON.stringify(payload));
      for (const type of ['dragenter', 'dragover', 'drop'] as const) {
        const event = new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        });
        // Chromium's DragEvent constructor ignores the dataTransfer init member,
        // so force it on explicitly — otherwise handleDrop sees a null transfer.
        Object.defineProperty(event, 'dataTransfer', { value: dt });
        workspace.dispatchEvent(event);
      }
    },
    { payload, offset }
  );
}

test.describe('Lore drag-and-drop onto tabletop', () => {
  test.beforeEach(async ({ page }) => {
    await mockPostHog(page);
    await blockPartyKit(page);
  });

  test('GM can drag a lore card onto the workspace and a lore window opens', async ({
    page,
    tabletopUrl,
  }) => {
    // Navigate to the tabletop tab — globalSetup ensures a screen exists.
    await page.goto(tabletopUrl);

    // Wait for the tabletop workspace to be ready.
    const workspace = page.getByTestId('tabletop-workspace');
    await expect(workspace).toBeVisible({ timeout: 20_000 });

    // Open the Wiki sidebar panel.
    await page.getByRole('tab', { name: 'Wiki' }).click();

    // Drill into the Lore category.
    await page.getByRole('button', { name: 'Lore' }).click();

    // Wait for the first lore card to appear (requires seeded lore data).
    const firstCard = page.getByTestId('lore-card').first();
    await expect(firstCard).toBeVisible({ timeout: 10_000 });

    // Read the documentId directly from the stable DOM attribute set on the
    // card's root element.  This avoids the unreliable synthetic-dragstart
    // approach — Chromium's DragEvent constructor silently ignores the
    // dataTransfer init member outside a trusted drag gesture, causing getData
    // to return '' and the payload to fall back to documentId: 'unknown'.
    const documentId = await firstCard.getAttribute('data-lore-id');
    if (!documentId) throw new Error('data-lore-id attribute missing from lore-card');

    // Read the title from the dedicated testid span — more stable than the
    // fragile span.text-sm selector used previously.
    const title = await firstCard.getByTestId('lore-card-title').innerText();

    // Build the drop payload the same way dropOnMap does in
    // tabletop-monster-tokens.spec.ts: construct it directly rather than
    // intercepting a dragstart event.
    const payload = { collection: 'lore', documentId, title };

    // Drop onto the workspace centre.
    await dropOnWorkspace(page, payload, { dx: 0, dy: 0 });

    // A floating lore window should appear on the workspace. Use .first() —
    // the E2E screen persists across runs and may already hold lore windows
    // from earlier drops, so more than one lore-window can be present.
    await expect(page.getByTestId('lore-window').first()).toBeVisible({ timeout: 10_000 });

    // The FloatingWindow title bar should also contain the lore entry's title
    // (server now hydrates lore so the title resolves, not "lore:<id>").
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 });
  });
});
