/**
 * OWNER: package F. Browser smoke tests against the Vite dev server (see playwright.config.ts).
 *
 * Tests marked `PENDING` depend on packages that are still stubs on main:
 *  - physics (pkg A): PhysicsSim is a no-op, so no disaster ever ends.
 *  - presets/build (pkg C): BuildController.loadPreset is a no-op, so towers and houses are empty.
 * Flip the flag to false when the package lands. Screenshots go to test-results/ (gitignored).
 */
import { expect, test, type Page } from '@playwright/test';

const PENDING = {
  physics: false, // pkg A
  presets: false, // pkg C
};

const DISASTER_TIMEOUT_MS = 30_000; // 8 s disaster plus Rapier load and slow CI frames

/** Ignore noise the browser emits on its own, not from the game. */
const IGNORED_CONSOLE = [/favicon/i, /Download the React DevTools/i];

async function openGame(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__GAME_DEBUG__), null, { timeout: 30_000 });
}

async function telemetry(page: Page) {
  return page.evaluate(() => window.__GAME_DEBUG__!.getTelemetry());
}

async function waitForMode(page: Page, mode: 'failed' | 'survived' | 'build') {
  await page.waitForFunction((m) => window.__GAME_DEBUG__!.getTelemetry().mode === m, mode, {
    timeout: DISASTER_TIMEOUT_MS,
    polling: 250,
  });
}

test.describe('boot', () => {
  test('loads with no console or page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push(`console.error: ${text}`);
    });

    await openGame(page);
    await page.screenshot({ path: 'test-results/boot.png' });

    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('debug API starts in build mode with an empty island', async ({ page }) => {
    await openGame(page);
    const t = await telemetry(page);
    expect(t.mode).toBe('build');
    expect(t.blockCount).toBe(0);
    expect(t.strutCount).toBe(0);
  });
});

test.describe('towers and houses', () => {
  test.fixme(PENDING.presets || PENDING.physics, 'needs presets (pkg C) and PhysicsSim (pkg A)');

  test('tower fails, reports a first break, and rewinds', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__GAME_DEBUG__!.loadPreset('tower'));
    expect((await telemetry(page)).blockCount).toBeGreaterThan(0);

    await page.evaluate(() => window.__GAME_DEBUG__!.startDisaster('earthquake', 1));
    await waitForMode(page, 'failed');
    expect((await telemetry(page)).firstBrokenId).not.toBeNull();
    await page.screenshot({ path: 'test-results/tower-failed.png' });

    await page.evaluate(() => window.__GAME_DEBUG__!.rewind());
    const after = await telemetry(page);
    expect(after.mode).toBe('build');
    expect(after.firstBrokenId).toBeNull();
    expect(after.blockCount).toBeGreaterThan(0);
    await page.screenshot({ path: 'test-results/tower-rewound.png' });
  });

  test('house survives the disaster and the run is won', async ({ page }) => {
    await openGame(page);
    await page.evaluate(() => window.__GAME_DEBUG__!.loadPreset('house'));
    expect((await telemetry(page)).blockCount).toBeGreaterThan(0);

    await page.evaluate(() => window.__GAME_DEBUG__!.startDisaster('earthquake', 1));
    await waitForMode(page, 'survived');
    expect((await telemetry(page)).firstBrokenId).toBeNull();
    await expect(page.getByTestId('win-banner')).toBeVisible();
    await page.screenshot({ path: 'test-results/house-survived.png' });
  });
});
