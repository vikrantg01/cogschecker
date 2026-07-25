import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for Food Cost Calculator
 * 
 * Tests run against a deployed staging environment.
 * Set the BASE_URL environment variable to target different environments.
 * 
 * Usage:
 *   npm run test:e2e                    # Run all E2E tests
 *   BASE_URL=https://staging.example.com npm run test:e2e
 */
export default defineConfig({
  testDir: './e2e',
  
  // Test execution settings
  fullyParallel: false, // Critical user journeys should run sequentially
  forbidOnly: !!process.env.CI, // Fail in CI if test.only is used
  retries: process.env.CI ? 2 : 0, // Retry failed tests in CI
  workers: 1, // Run tests one at a time for critical paths
  
  // Test timeout settings
  timeout: 60000, // 60 seconds per test
  expect: {
    timeout: 10000, // 10 seconds for assertions
  },
  
  // Reporter configuration
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'], // Console output
    ...(process.env.CI ? [['junit', { outputFile: 'test-results/junit.xml' }]] : []),
  ],
  
  // Output folders
  outputDir: 'test-results/',
  
  use: {
    // Base URL for the application under test
    // Default to localhost for local testing, but should be overridden in CI
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    
    // Browser context options
    trace: 'on-first-retry', // Capture trace on first retry
    screenshot: 'only-on-failure', // Capture screenshots on failure
    video: 'retain-on-failure', // Capture video on failure
    
    // Navigation timeout
    navigationTimeout: 30000, // 30 seconds
    
    // Action timeout
    actionTimeout: 10000, // 10 seconds
  },

  // Test projects for different browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test on other browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Web server configuration (for local testing only)
  // In CI, the staging environment should already be running
  webServer: process.env.CI ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // 2 minutes to start
  },
});
