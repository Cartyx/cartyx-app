import { test, expect } from '../fixtures/tabletop-fixtures';

test.describe('Tabletop Floating Windows', () => {
  test.skip();

  test('GM Show on Tabletop opens floating window for all players', async ({
    browser,
    campaignUrl,
  }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();

    await gmPage.goto(campaignUrl);
    await playerPage.goto(campaignUrl);

    // GM opens a wiki item and clicks "Show on Tabletop"
    // TODO: Navigate to wiki, click Show on Tabletop button

    // Player should see floating window appear
    // TODO: Assert floating window with item title is visible

    await gmContext.close();
    await playerContext.close();
  });

  test('player can move/resize floating window (personal)', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);
    // TODO: Verify window drag persists for this player only
  });

  test('GM close removes window for everyone', async ({ browser, campaignUrl }) => {
    // TODO: GM closes window, verify it disappears for player too
  });

  test('tab notification badge appears when content added to other tab', async ({
    browser,
    campaignUrl,
  }) => {
    // TODO: GM adds content to tab B while player is on tab A
    // Assert badge appears on tab B for player
  });

  test('state persists across page reload', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);
    await page.click('[id="tab-tabletop"]');
    // TODO: Create tab, add window, reload, verify state preserved
  });
});
