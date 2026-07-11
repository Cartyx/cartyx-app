/**
 * Location Lightbox E2E — opens a Location floating window on the Tabletop tab,
 * switches to the Gallery sub-tab, clicks a thumbnail, and verifies the
 * ImageLightbox portal opens with the image and closes on Escape.
 *
 * Prerequisites (set up by e2e/globalSetup.ts):
 *  - A tabletop screen named "E2E Test Screen" with the seeded location
 *    pre-opened as a `collection: 'location'` floating window.
 *  - The seeded location has one image titled fixtureImageTitle.
 */
import { test, expect } from '../fixtures/tabletop-fixtures';
import { blockPartyKit } from '../fixtures/network-mocks';

test.describe('Location image gallery — lightbox (Tabletop floating window flow)', () => {
  test.beforeEach(async ({ page }) => {
    await blockPartyKit(page);
  });

  test('clicking a thumbnail opens the fullscreen lightbox, Escape closes it', async ({
    page,
    tabletopUrl,
    screenId,
    locationName,
    fixtureImageTitle,
  }) => {
    await page.goto(tabletopUrl);

    // Wait for the tabletop view to mount before reaching for the E2E screen tab.
    await expect(page.getByTestId('tabletop-view')).toBeVisible();

    // Switch to the E2E-owned tabletop screen — the active screen on first load
    // may be the user's pre-existing "Default" screen, not ours.
    await page.getByTestId(`tabletop-tab-${screenId}`).click();

    // The floating window for the seeded location should now be on the canvas.
    const locationWindow = page.getByRole('dialog', { name: locationName });
    await expect(locationWindow).toBeVisible();

    // Wait for the location data to fully load before clicking Gallery — the
    // meta bar's `Edit location` button only renders once LocationWindow has
    // mounted with the fetched location.
    await expect(locationWindow.getByRole('button', { name: 'Edit location' })).toBeVisible();

    // Open the Gallery sub-tab inside the floating window.
    await locationWindow.getByRole('button', { name: 'Gallery', exact: true }).click();

    // Click the fixture thumbnail to open the lightbox.
    await locationWindow.getByAltText(fixtureImageTitle).click();

    // ImageLightbox renders into document.body via a portal — assert from page root.
    const lightbox = page.getByRole('button', { name: 'Close fullscreen view' });
    await expect(lightbox).toBeVisible();
    // The fullscreen image carries the same alt text as the thumbnail.
    const fullscreenImages = page.getByAltText(fixtureImageTitle);
    await expect(fullscreenImages).toHaveCount(2); // thumbnail + lightbox

    // Escape closes the lightbox (handled by ImageLightbox useEffect).
    await page.keyboard.press('Escape');
    await expect(lightbox).toHaveCount(0);
    await expect(fullscreenImages).toHaveCount(1); // just the thumbnail again
  });

  test('clicking the close button closes the lightbox', async ({
    page,
    tabletopUrl,
    screenId,
    locationName,
    fixtureImageTitle,
  }) => {
    await page.goto(tabletopUrl);
    await expect(page.getByTestId('tabletop-view')).toBeVisible();
    await page.getByTestId(`tabletop-tab-${screenId}`).click();

    const locationWindow = page.getByRole('dialog', { name: locationName });
    await expect(locationWindow).toBeVisible();
    await expect(locationWindow.getByRole('button', { name: 'Edit location' })).toBeVisible();
    await locationWindow.getByRole('button', { name: 'Gallery', exact: true }).click();
    await locationWindow.getByAltText(fixtureImageTitle).click();

    const closeButton = page.getByRole('button', { name: 'Close fullscreen view' });
    await expect(closeButton).toBeVisible();
    await closeButton.click();
    await expect(closeButton).toHaveCount(0);
  });
});
