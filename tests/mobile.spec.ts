import { expect, test } from '@playwright/test';

// Mobile landscape-forcing: portrait phones rotate the whole app 90° via CSS
// instead of showing a "rotate your device" interstitial. Narrow DESKTOP
// windows must never be rotated or gated.
//
// These specs are written to match the shipped behavior; run with
// `npx playwright test tests/mobile.spec.ts` on a machine with browsers
// installed. The in-session gate used `matchMedia('(pointer: coarse)')`,
// which Playwright emulates via `hasTouch` + `isMobile`.

test.describe('mobile landscape forcing', () => {
  test('narrow desktop portrait window keeps the app upright and visible', async ({ browser }) => {
    // Fine pointer + no touch: matches any narrow desktop window (the old
    // regression showed an interstitial here).
    const context = await browser.newContext({
      viewport: { width: 500, height: 900 },
      isMobile: false,
      hasTouch: false,
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForSelector('#viewport canvas');
    const app = page.locator('#app');
    await expect(app).toBeVisible();
    expect(await app.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    // No interstitial element may exist at all.
    await expect(page.locator('#mobile-landscape-gate')).toHaveCount(0);
    // Placing a panel still works with a plain mouse click.
    const box = await page.locator('#viewport canvas').boundingBox();
    await page.mouse.click(box.x + box.width * 0.44, box.y + box.height * 0.58);
    const panels = await page.evaluate(() => (window as unknown as { __builder: { world: { panels: { size: number } } } }).__builder.world.panels.size);
    expect(panels).toBe(1);
    await context.close();
  });

  test('portrait phone rotates the app to landscape and remaps taps', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/');
    await page.waitForSelector('#viewport canvas');
    // Rotation applied: the app's screen AABB covers the portrait viewport
    // while its local layout box is landscape (width > height).
    const rotated = await page.locator('#app').evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return { transform: style.transform, screenW: Math.round(rect.width), screenH: Math.round(rect.height) };
    });
    expect(rotated.transform).not.toBe('none');
    expect(rotated.screenW).toBe(390);
    expect(rotated.screenH).toBe(844);
    // Tap the screen center of the rotated layout; the canvas occupies the
    // area right of/below the rotated sidebar, and a tap near the table's
    // center in rotated screen space must place a panel.
    const tap = await page.locator('#viewport canvas').evaluate((canvas) => {
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left + rect.width * 0.37, y: rect.top + rect.height * 0.5 };
    });
    await page.touchscreen.tap(tap.x, tap.y);
    const panels = await page.evaluate(() => (window as unknown as { __builder: { world: { panels: { size: number } } } }).__builder.world.panels.size);
    expect(panels).toBe(1);
    // Undo works the same on touch.
    await page.locator('button[title^="Undo"]').click();
    expect(await page.evaluate(() => (window as unknown as { __builder: { world: { panels: { size: number } } } }).__builder.world.panels.size)).toBe(0);
    await context.close();
  });
});
