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

    // Read the lore title from the card so we can assert it in the window header.
    // The title is the first text-sm span inside the card.
    const loreTitle = await firstCard.locator('span.text-sm').first().innerText();

    // Extract the documentId from the card's drag payload — we need to do this
    // by reading the data attribute set during onDragStart. The card sets the
    // payload via JS, so we read it via evaluate.
    const cardPayload = await firstCard.evaluate((el) => {
      // Trigger a synthetic dragstart so the payload is set on a real DataTransfer,
      // then read it back. We do not actually need to start a real drag; instead
      // we intercept via a one-shot dragstart listener.
      return new Promise<{ collection: string; documentId: string; title: string } | null>(
        (resolve) => {
          const handler = (e: DragEvent) => {
            el.removeEventListener('dragstart', handler);
            const raw = e.dataTransfer?.getData('application/x-cartyx-document') ?? null;
            resolve(raw ? JSON.parse(raw) : null);
          };
          el.addEventListener('dragstart', handler);
          el.dispatchEvent(
            new DragEvent('dragstart', {
              bubbles: true,
              cancelable: true,
              dataTransfer: new DataTransfer(),
            })
          );
        }
      );
    });

    // If we couldn't extract the payload from the dragstart event (some browsers
    // restrict DataTransfer access outside the event), fall back to constructing
    // the payload from what we know: collection is always "lore" and we use the
    // title we already captured.
    const payload: { collection: string; documentId: string; title: string } = cardPayload ?? {
      collection: 'lore',
      documentId: 'unknown',
      title: loreTitle,
    };

    // Drop onto the workspace centre.
    await dropOnWorkspace(page, payload, { dx: 0, dy: 0 });

    // A floating lore window should appear on the workspace.  The FloatingWindow
    // component renders the lore title in its title bar as a <span>.
    // Also assert the LoreWindow content root (data-testid="lore-window") is present.
    await expect(page.getByText(loreTitle).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('lore-window')).toBeVisible({ timeout: 10_000 });
  });
});
