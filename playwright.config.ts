import { defineConfig, devices } from '@playwright/test';

const PORT = 5173;

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PORT}`,
        // Full runs are slow (WebGL + Rapier); keep traces off unless debugging a failure.
        trace: 'off',
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
