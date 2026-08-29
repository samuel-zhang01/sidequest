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

test('a new viewer automatically joins a real browser camera stream', async ({ browser }) => {
  test.setTimeout(60000);
  const suffix = Date.now();
  const appUrl = process.env.APP_URL || 'http://127.0.0.1:6969';
  const contextOptions = {
    permissions: ['camera', 'microphone', 'geolocation'],
    geolocation: { latitude: 51.502, longitude: -0.122 },
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  };
  const broadcasterContext = await browser.newContext(contextOptions);
  const viewerContext = await browser.newContext(contextOptions);
  const broadcaster = await broadcasterContext.newPage();
  const viewer = await viewerContext.newPage();
  const browserErrors = [];

  for (const page of [broadcaster, viewer]) {
    page.on('pageerror', error => browserErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
  }

  await broadcaster.goto(`${appUrl}/`);
  await broadcaster.locator('#join-identity').fill(`Browser Broadcaster ${suffix}`);
  await Promise.all([
    broadcaster.waitForURL('**/#home'),
    broadcaster.locator('#join-form button').click(),
  ]);
  await broadcaster.goto(`${appUrl}/live`);
  await broadcaster.evaluate(() => {
    const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let attempts = 0;
    navigator.mediaDevices.getUserMedia = constraints => {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new DOMException('Requested device not found', 'NotFoundError'));
      return nativeGetUserMedia({ ...constraints, audio: false });
    };
  });
  await broadcaster.locator('#start-button').click();
  await expect(broadcaster.locator('#broadcast-status')).toContainText('You are live', { timeout: 15000 });
  await expect(broadcaster.locator('#broadcast-status')).toContainText('without microphone audio');
  await expect(broadcaster.locator('#broadcast-live')).toBeVisible();

  await viewer.goto(`${appUrl}/`);
  await viewer.locator('#join-identity').fill(`Browser Viewer ${suffix}`);
  await Promise.all([
    viewer.waitForURL('**/#home'),
    viewer.locator('#join-form button').click(),
  ]);
  await viewer.goto(`${appUrl}/live`);
  await expect(viewer.locator('#watch')).toBeVisible({ timeout: 15000 });
  await expect(viewer.locator('#watch-status')).toContainText('Connected', { timeout: 15000 });
  await expect(viewer.locator('#remote-empty')).toBeHidden({ timeout: 15000 });
  await expect.poll(() => viewer.locator('#remote-video').evaluate(video =>
    video.readyState >= 1 && video.buffered.length > 0 && video.buffered.end(0) > 0
  ), { timeout: 15000 }).toBe(true);
  await expect.poll(() => viewer.locator('#remote-video').evaluate(video =>
    video.buffered.length ? video.buffered.end(video.buffered.length - 1) - video.currentTime : Infinity
  ), { timeout: 10000 }).toBeLessThan(4);

  await viewer.locator('[data-cheer="🎉"]').click();
  await expect(viewer.locator('#cheer-feed')).toContainText('Browser Viewer');
  await expect(broadcaster.locator('#broadcast-viewers')).toContainText('1 viewer');

  await viewer.locator('#live-challenge-amount').fill('5');
  await viewer.locator('#live-challenge-form button').click();
  await expect(viewer.locator('#watch-status')).toContainText('Challenge delivered');
  await expect(broadcaster.locator('#broadcast-challenges')).toContainText('Browser Viewer');
  await expect(broadcaster.locator('#broadcast-challenges')).toContainText('£5.00');
  await expect(broadcaster.locator('#broadcast-challenges')).toContainText('Mind');
  await expect(broadcaster.locator('#broadcast-challenge-count')).toContainText('1 live');
  await expect(broadcaster.locator('[data-live-response="accepted"]')).toBeVisible();
  await broadcaster.locator('[data-live-response="accepted"]').click();
  await expect(broadcaster.locator('#broadcast-challenges')).toContainText('accepted');
  await expect(viewer.locator('#watch-challenges')).toContainText('accepted');

  await broadcaster.locator('#stop-button').click();
  await expect(viewer.locator('#watch-status')).toContainText('ended', { timeout: 10000 });
  expect(browserErrors).toEqual([]);

  await viewerContext.close();
  await broadcasterContext.close();
});
