/**
 * Location Gallery E2E — upload + delete in the GM edit modal.
 *
 * Lightbox open/close is covered in location-lightbox.spec.ts (via the tabletop
 * floating window flow, since the GM edit modal doesn't render LocationGallery).
 */
import { test, expect } from '../fixtures/tabletop-fixtures';
import { mockPostHog, mockR2DirectUpload } from '../fixtures/network-mocks';
import type { Page } from '@playwright/test';

const TINY_PNG = Buffer.from(
  // 1×1 transparent PNG
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

async function openLocationAsGm(page: Page, campaignUrl: string, locationName: string) {
  await page.goto(campaignUrl);

  // Open the Wiki tab in the InspectorSidebar.
  await page.getByRole('tab', { name: 'Wiki' }).click();

  // Drill into the Locations category.
  await page.getByRole('button', { name: 'Locations' }).click();

  // Click the seeded location card — opens LocationModal (edit) for a GM.
  // Use { exact: false } with the literal name (Playwright treats string `name`
  // as substring case-insensitive match) to avoid dynamic RegExp construction.
  await page.getByRole('button', { name: locationName }).first().click();

  // Confirm the edit modal is visible.
  await expect(page.getByRole('dialog', { name: /Edit Location/i })).toBeVisible();
}

test.describe('Location image gallery (GM edit flow)', () => {
  test.beforeEach(async ({ page }) => {
    await mockPostHog(page);
    await mockR2DirectUpload(page);
  });

  test('GM can upload a new image and it appears in the existing grid', async ({
    page,
    campaignUrl,
    locationName,
  }) => {
    await openLocationAsGm(page, campaignUrl, locationName);

    // The "Images" heading is the LocationImageUpload section header.
    await expect(page.getByRole('heading', { name: 'Images', level: 3 })).toBeVisible();

    // Unique title per run — tests don't clean up after themselves and the dev
    // DB accumulates fixture images across runs.
    const uploadTitle = `Upload Spec ${Date.now()}`;

    // The hidden <input type="file"> is inside the upload component — set it directly.
    const fileInput = page.locator('input[type="file"][accept*="image"]');
    await fileInput.setInputFiles({
      name: 'upload-spec.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });

    // Fill in the title (required for Upload button to enable).
    await page.getByPlaceholder('Image title (required)').fill(uploadTitle);

    await page.getByRole('button', { name: /Upload Image/i }).click();

    // Wait for the new thumbnail to land in the grid — React Query refetches.
    const thumb = page.getByAltText(uploadTitle);
    await expect(thumb).toBeVisible({ timeout: 10_000 });

    // Self-clean so each run doesn't accumulate orphan entries in the dev DB.
    // (The R2 PUT itself is mocked, so no R2 bytes were ever written.)
    const thumbContainer = thumb.locator('..');
    await thumbContainer.hover();
    await thumbContainer.getByRole('button', { name: `Remove ${uploadTitle}` }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(thumb).toHaveCount(0, { timeout: 10_000 });
  });

  test('GM can delete an existing image via the inline confirmation', async ({
    page,
    campaignUrl,
    locationName,
  }) => {
    await openLocationAsGm(page, campaignUrl, locationName);

    // Unique title so re-runs don't trip over leftover thumbnails in the dev DB.
    const deleteTitle = `Delete Spec ${Date.now()}`;

    const fileInput = page.locator('input[type="file"][accept*="image"]');
    await fileInput.setInputFiles({
      name: 'deletable.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    });
    await page.getByPlaceholder('Image title (required)').fill(deleteTitle);
    await page.getByRole('button', { name: /Upload Image/i }).click();

    const thumb = page.getByAltText(deleteTitle);
    await expect(thumb).toBeVisible({ timeout: 10_000 });

    // Hover to reveal the X delete button (opacity-0 → group-hover:opacity-100).
    const thumbContainer = thumb.locator('..');
    await thumbContainer.hover();
    await thumbContainer.getByRole('button', { name: `Remove ${deleteTitle}` }).click();

    // Inline confirmation — click Yes.
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(thumb).toHaveCount(0, { timeout: 10_000 });
  });
});
