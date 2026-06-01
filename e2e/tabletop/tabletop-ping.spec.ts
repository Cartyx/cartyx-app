import { test, expect } from '../fixtures/tabletop-fixtures';

test.describe('Tabletop Ping', () => {
  test.skip();

  test('ping appears on all connected players screens', async ({ browser, campaignUrl }) => {
    const gmContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const gmPage = await gmContext.newPage();
    const playerPage = await playerContext.newPage();

    await gmPage.goto(campaignUrl);
    await playerPage.goto(campaignUrl);
    await gmPage.click('[id="tab-tabletop"]');
    await playerPage.click('[id="tab-tabletop"]');

    // GM activates ping tool and clicks on canvas
    // TODO: Click ping tool button, then click on canvas at specific coordinates

    // Player should see ping animation
    // TODO: Assert ping element appears on player's canvas

    await gmContext.close();
    await playerContext.close();
  });

  test('ping fades after 3 seconds', async ({ page, campaignUrl }) => {
    await page.goto(campaignUrl);
    // TODO: Trigger ping, wait 3.5 seconds, verify it's gone
  });

  test('any player can ping (not just GM)', async ({ page, campaignUrl }) => {
    // TODO: As player, activate ping and click canvas
  });
});
