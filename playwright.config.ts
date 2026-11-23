import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  // CI: one retry for flaky WebGL/CPU stalls, one worker (SwiftShader is CPU-bound), HTML report for the artifact.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PORT}`,
        // Full runs are slow (WebGL + Rapier); traces are only recorded for CI retries.
        trace: process.env.CI ? 'on-first-retry' : 'off',
        viewport: { width: 1280, height: 800 },
        // Headless Chromium has no GPU; SwiftShader gives three.js a working WebGL context.
        launchOptions: {
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
