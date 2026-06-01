import { test, expect } from '../fixtures/tabletop-fixtures';

test.describe('Tabletop Tab Management', () => {
  // All tests skipped until auth fixtures are implemented
  test.skip();

  test('GM can create a new tab', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);
    await page.click('[id="tab-tabletop"]');
    await page.click('[title="Add tab"]');
    await page.fill('input[placeholder="Tab name..."]', 'Battle Map 1');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Battle Map 1')).toBeVisible();
  });

  test('GM can rename a tab via context menu', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);
    await page.click('[id="tab-tabletop"]');
    // TODO: Implement rename UI interaction
  });

  test('GM can delete a tab', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);
    await page.click('[id="tab-tabletop"]');
    // TODO: Implement delete UI interaction
  });

  test('player sees tab created by GM in real-time', async ({ browser, campaignUrl }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();

    await gmPage.goto(campaignUrl);
    await playerPage.goto(campaignUrl);
    await gmPage.click('[id="tab-tabletop"]');
    await playerPage.click('[id="tab-tabletop"]');

    // GM creates tab
    await gmPage.click('[title="Add tab"]');
    await gmPage.fill('input[placeholder="Tab name..."]', 'City Map');
    await gmPage.keyboard.press('Enter');

    // Player should see it appear via PartyKit
    await expect(playerPage.getByText('City Map')).toBeVisible({ timeout: 5000 });

    await gmContext.close();
    await playerContext.close();
  });

  test('Focus All pulls player to GM active tab', async ({ browser, campaignUrl }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();

    await gmPage.goto(campaignUrl);
    await playerPage.goto(campaignUrl);
    await gmPage.click('[id="tab-tabletop"]');
    await playerPage.click('[id="tab-tabletop"]');

    // GM clicks Focus All
    await gmPage.click('[title="Focus all players to this tab"]');

    // TODO: Assert player's active tab matches GM's

    await gmContext.close();
    await playerContext.close();
  });

  test('player switches tabs independently without affecting others', async ({
    browser,
    campaignUrl,
  }) => {
    // TODO: Requires multiple tabs to exist
  });
});
