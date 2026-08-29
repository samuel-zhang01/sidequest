const { test, expect } = require('@playwright/test');

test('post-login features are separated into a coherent persistent navigation', async ({ page }) => {
  const appUrl = process.env.APP_URL || 'http://127.0.0.1:6969';
  const browserErrors = [];
  page.on('pageerror', error => browserErrors.push(error.message));

  await page.goto(`${appUrl}/`);
  await Promise.all([
    page.waitForURL('**/#home'),
    page.locator('#join-form button').click(),
  ]);

  await expect(page.locator('[data-view="home"]')).toBeVisible();
  await expect(page.locator('[data-nav="home"]')).toHaveAttribute('aria-current', 'page');
  const loop = await page.evaluate(async () => (await fetch('/api/feedback-loop')).json());
  const social = loop.social;
  expect(social).not.toHaveProperty('attention');
  expect(loop.externalEvidenceInterventions[0]).toMatchObject({ id: 'healf-zone-bloods', title: 'Try Healf Bloods' });
  await expect(page.locator('#attention-strip')).toHaveCount(0);
  await expect(page.getByText('Needs your attention', {exact:true})).toHaveCount(0);
  await expect(page.locator('#people-row .person-tile').first()).toBeVisible();
  await expect(page.locator('#home-feed .feed-card').first()).toBeVisible();
  await expect(page.locator('#home-feed .feed-card')).toHaveCount(3);
  await expect(page.locator('#home-feed .recorded-visual')).toHaveCount(3);
  await expect(page.locator('#home-feed .source-badge')).toHaveCount(3);
  await expect(page.locator('#home-feed')).toContainText('Synced from your private Strava export');
  await expect(page.locator('#hero-state')).toHaveCount(0);
  await expect(page.locator('#loop')).toHaveCount(0);
  await expect(page.locator('#safety-boundary')).toHaveCount(0);
  await expect(page.locator('.quick-stack')).toHaveCount(0);
  await expect(page.locator('.primary-navigation')).toContainText('Home');
  await expect(page.locator('.primary-navigation')).toContainText('YOU');
  await expect(page.locator('.primary-navigation')).toContainText('Live');
  await expect(page.locator('.primary-navigation')).toContainText('Challenge');

  await expect(page.locator('.primary-navigation .nav-item')).toHaveCount(4);
  await expect(page.locator('.primary-navigation .nav-item > span')).toHaveText(['Home', 'YOU', 'Live', 'Challenge']);
  await expect(page.locator('[data-nav="run"]')).toHaveCount(0);

  await page.locator('[data-nav="challenges"]').click();
  await expect(page.locator('#challenge-library')).toContainText('My challenges');
  expect(await page.locator('#challenge-library .challenge-object').count()).toBeGreaterThanOrEqual(6);
  await expect(page.locator('#challenge-library')).toContainText(/Agent Godoy|Generated fallback/);
  await expect(page.locator('#challenge-board')).toContainText('Received from friends');
  await expect(page.locator('#challenge-board')).toContainText('Sent to friends');
  await expect(page.locator('#challenge-board')).toContainText('Needs your response');
  await expect(page.locator('#challenge-board')).toContainText('Active');
  await expect(page.locator('#challenge-board')).toContainText('Completed');
  await expect(page.locator('#intervene')).toBeVisible();
  await expect(page.locator('#rally')).toBeVisible();

  await page.locator('[data-nav="you"]').click();
  await expect(page.locator('[data-view="you"] h1')).toHaveText('YOU');
  await expect(page.locator('#profile-source')).toBeVisible();
  await expect(page.locator('#profile-source')).toContainText('Strava data export');
  await expect(page.locator('#source-metrics')).toBeVisible();
  await expect(page.locator('#source-metrics')).toContainText('209');
  await expect(page.locator('#bars')).toBeVisible();
  await expect(page.locator('#profile-summary')).toContainText('Postgres-backed source');
  await expect(page.locator('#profile-diagnostics')).toBeVisible();
  await expect(page.locator('#profile-diagnostics')).toContainText('Your diagnostics');
  await expect(page.locator('#state-label')).not.toHaveText('—');
  await expect(page.locator('#profile-next')).toBeVisible();
  await expect(page.locator('#godoy-content')).toContainText('Suggested interventions');
  await expect(page.locator('#healf-zone-card')).toContainText('Try Healf Bloods');
  await expect(page.locator('#healf-zone-card')).toContainText('Up to 37 biomarkers');
  await expect(page.locator('#healf-zone-card img')).toHaveAttribute('alt', /Healf Zone at-home blood collection kit/);
  expect(await page.locator('#godoy-content .candidate').count()).toBeGreaterThanOrEqual(3);
  await page.locator('[data-godoy-question]').first().click();
  await expect(page.locator('#godoy-content .chat-message.user')).toBeVisible();
  await expect(page.locator('#godoy-content .chat-focused-reply')).toBeVisible();
  await expect(page.locator('#past-runs')).toBeVisible();
  await expect(page.locator('#past-runs')).toContainText('strava-export');
  expect(await page.evaluate(() => {
    const ids=['profile-source','profile-diagnostics','profile-next','profile-history'];
    return ids.every((id,index) => index === 0 || Boolean(document.getElementById(ids[index-1]).compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING));
  })).toBe(true);
  await expect(page.locator('#profile-settings')).toContainText('Export brief');
  await expect(page.locator('#profile-name')).toContainText('Javi');
  await expect(page.locator('#analyse')).toContainText('Generate next steps');

  await Promise.all([
    page.waitForURL('**/live'),
    page.locator('[data-nav="live"]').click(),
  ]);
  await expect(page.locator('#start-button')).toContainText('Start your run');
  await expect(page.locator('.feed-card')).toContainText('Friends running now');
  await expect(page.locator('.primary-navigation .nav-item')).toHaveCount(4);
  await expect(page.locator('.primary-navigation .nav-item > span')).toHaveText(['Home', 'YOU', 'Live', 'Challenge']);

  await page.setViewportSize({ width: 390, height: 844 });
  const navBox = await page.locator('.app-navigation').boundingBox();
  expect(navBox.y).toBeGreaterThan(700);
  expect(browserErrors).toEqual([]);
});
