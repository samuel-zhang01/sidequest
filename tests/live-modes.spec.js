const { test, expect } = require('@playwright/test');

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

const appUrl = process.env.APP_URL || 'http://127.0.0.1:6969';

async function join(page, name) {
  await page.goto(`${appUrl}/`);
  await page.locator('#join-identity').fill(name);
  await Promise.all([
    page.waitForURL('**/#home'),
    page.locator('#join-form button').click(),
  ]);
  await page.goto(`${appUrl}/live`);
}

test('Me and Watch others keep a sustained run, cockpit, challenges, and reactions clear', async ({ browser }) => {
  test.setTimeout(90000);
  const suffix = Date.now();
  const contextOptions = {
    permissions: ['camera', 'microphone', 'geolocation'],
    geolocation: { latitude: 51.502, longitude: -0.122, accuracy: 8 },
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  };
  const runnerContext = await browser.newContext(contextOptions);
  const viewerContext = await browser.newContext(contextOptions);
  const runner = await runnerContext.newPage();
  const viewer = await viewerContext.newPage();
  const browserErrors = [];

  for (const page of [runner, viewer]) {
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
  }

  try {
    await join(runner, `Modes Runner ${suffix}`);

    const meMode = runner.locator('[data-mode="me"]');
    const watchMode = runner.locator('[data-mode="watch"]');
    await expect(meMode).toBeVisible();
    await expect(meMode).toHaveAttribute('aria-pressed', 'true');
    await expect(watchMode).toBeVisible();
    await expect(runner.locator('.creator-card')).toBeVisible();
    await expect(runner.locator('.feed-card')).toBeHidden();

    await watchMode.click();
    await expect(watchMode).toHaveAttribute('aria-pressed', 'true');
    await expect(runner.locator('.feed-card')).toBeVisible();
    await expect(runner.locator('.creator-card')).toBeHidden();

    await meMode.click();
    await expect(meMode).toHaveAttribute('aria-pressed', 'true');
    await runner.locator('#start-button').click();
    await expect(runner.locator('#broadcast-status')).toContainText('You are live', { timeout: 15000 });
    await expect(runner.locator('#runner-cockpit')).toBeVisible();
    await expect(runner.locator('#broadcast-sponsor-overlay')).toContainText('SideQuest community');
    await expect(runner.locator('#broadcast-sponsor-overlay')).toContainText('Live run');

    const localVideo = runner.locator('#local-video');
    await expect.poll(() => localVideo.evaluate(video =>
      video.readyState >= 2 && !video.paused &&
      video.srcObject?.getVideoTracks().length === 1 &&
      video.srcObject.getVideoTracks()[0].readyState === 'live'
    ), { timeout: 15000 }).toBe(true);

    const fullscreenToggle = runner.locator('#cockpit-toggle');
    await expect(fullscreenToggle).toBeVisible();
    await fullscreenToggle.click();
    await expect(fullscreenToggle).toHaveAttribute('aria-pressed', 'true');
    await expect(runner.locator('#runner-cockpit')).toHaveClass(/is-fullscreen/);
    await expect(runner.locator('#runner-cockpit .map')).toBeVisible();
    await expect(runner.locator('#runner-cockpit .stats')).toBeVisible();
    await expect(runner.locator('#runner-cockpit')).toContainText('GPS');
    await expect(runner.locator('#runner-cockpit')).toContainText('pace', { ignoreCase: true });

    await join(viewer, `Modes Viewer ${suffix}`);
    await expect(viewer.locator('[data-mode="watch"]')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
    await expect(viewer.locator('#watch')).toBeVisible({ timeout: 15000 });
    await expect(viewer.locator('#watch-status')).toContainText('Connected', { timeout: 15000 });
    await expect(viewer.locator('#remote-empty')).toBeHidden({ timeout: 15000 });

    await viewer.locator('[data-cheer="🔥"]').click();
    await expect(runner.locator('#broadcast-reaction-overlay')).toContainText('🔥', { timeout: 10000 });
    await expect(runner.locator('#broadcast-reaction-overlay')).toContainText('Modes Viewer');

    await viewer.locator('#live-challenge-amount').fill('9');
    await viewer.locator('#live-challenge-form button').click();
    await expect(viewer.locator('#watch-status')).toContainText('Challenge delivered');
    await expect(runner.locator('#broadcast-challenge-overlay')).toContainText('Modes Viewer', { timeout: 10000 });
    await expect(runner.locator('#broadcast-challenge-overlay')).toContainText('£9.00');
    await expect(runner.locator('#broadcast-challenge-overlay')).toContainText('Mind');

    // Keep the fake camera and relay active across many recorder slices. This
    // catches the mobile failure mode where preview succeeds and then stops.
    await runner.waitForTimeout(6000);
    await expect(runner.locator('#broadcast-status')).toContainText('You are live');
    await expect.poll(() => localVideo.evaluate(video =>
      !video.paused && video.srcObject?.getVideoTracks()[0]?.readyState === 'live'
    )).toBe(true);
    await expect.poll(() => viewer.locator('#remote-video').evaluate(video =>
      video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0
    ), { timeout: 10000 }).toBeGreaterThan(2);

    await fullscreenToggle.click();
    await expect(fullscreenToggle).toHaveAttribute('aria-pressed', 'false');
    await runner.locator('#stop-button').click();
    await expect(viewer.locator('#watch-status')).toContainText('ended', { timeout: 10000 });
    expect(browserErrors).toEqual([]);
  } finally {
    if (!runner.isClosed() && await runner.locator('#stop-button').isVisible().catch(() => false)) {
      await runner.locator('#stop-button').click().catch(() => {});
    }
    await viewerContext.close();
    await runnerContext.close();
  }
});
