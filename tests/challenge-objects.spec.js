const { test, expect } = require('@playwright/test');

const appUrl = process.env.APP_URL || 'http://127.0.0.1:6969';

async function join(page, identity = '') {
  await page.goto(`${appUrl}/`);
  if (identity) await page.locator('#join-identity').fill(identity);
  await Promise.all([
    page.waitForURL('**/#home'),
    page.locator('#join-form button').click(),
  ]);
}

test('a reusable challenge is visible to its owner and assigned friend', async ({ browser }) => {
  const suffix = Date.now();
  const friendName = `A0${suffix} Friend`;
  const ownerContext = await browser.newContext();
  const friendContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const friend = await friendContext.newPage();

  try {
    await join(friend, friendName);
    await join(owner);
    await owner.locator('[data-nav="challenges"]').click();

    const selected = owner.locator('#challenge-library .challenge-object.selected');
    await expect(selected).toBeVisible();
    const title = (await selected.locator('h3').textContent()).trim();
    await expect(owner.locator('#challenge-library .challenge-object')).toHaveCount(6);

    const friendButton = owner.locator('[data-friend]').filter({ hasText: friendName });
    await expect(friendButton).toBeVisible();
    await friendButton.click();
    await expect(owner.locator('#challenge-board')).toContainText(`Sent to ${friendName}`);
    await expect(owner.locator('#challenge-board')).toContainText(title);

    await friend.reload();
    await friend.locator('[data-nav="challenges"]').click();
    await expect(friend.locator('#challenge-board')).toContainText('Received from friends');
    await expect(friend.locator('#challenge-board')).toContainText(title);
    await expect(friend.locator('#challenge-board')).toContainText('From Javi');
    await friend.locator('[data-assignment-response="accepted"]').click();
    await expect(friend.locator('#challenge-board')).toContainText('accepted');

    await owner.reload();
    await owner.locator('[data-nav="challenges"]').click();
    await expect(owner.locator('#challenge-board')).toContainText(title);
    await expect(owner.locator('#challenge-board')).toContainText('accepted');
  } finally {
    await friendContext.close();
    await ownerContext.close();
  }
});
