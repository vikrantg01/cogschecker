# E2E Tests for Food Cost Calculator

This directory contains end-to-end tests using Playwright for the Food Cost Calculator application.

## Test Coverage

### Task 29.2: Social Login, Venue Switching, and Subscription Upgrade Prompts

The main test file `social-login-venue-subscription.spec.ts` covers:

#### 1. Social Login (Google OAuth)
- ✅ Display Google and Apple social login buttons
- ✅ Initiate OAuth flow when buttons are clicked
- ✅ Handle OAuth callback with authorization code
- ✅ Display errors for failed OAuth flows
- ✅ Handle missing authorization codes
- ✅ Handle token exchange failures
- ✅ Link social login to existing accounts with matching email

**Requirements Validated:**
- Requirement 8.3: Google social login provider
- Requirement 8.4: Apple social login provider
- Requirement 8.5: Create account on first social login
- Requirement 8.6: Link social provider to existing account

#### 2. Venue Switching
- ✅ Display venue selector for multi-venue users
- ✅ Switch between venues using dropdown
- ✅ Load venue-specific data after switching
- ✅ Display current venue name in navigation
- ✅ Show "Create Venue" button when no venues exist
- ✅ Persist venue selection across page navigation
- ✅ Load venue data within 2 seconds (performance requirement)

**Requirements Validated:**
- Requirement 10.9: Venue selector for multi-venue users
- Requirement 10.10: Load venue data within 2 seconds
- Requirement 10.11: Display selected venue name prominently
- Requirement 10.3: Data isolation between venues

#### 3. Subscription Upgrade Prompts
- ✅ Display upgrade modal on 402 Payment Required response
- ✅ Show correct tier name (Free, Pro, Pro+)
- ✅ Display tier-specific features
- ✅ Close modal with "Maybe Later" button
- ✅ Navigate to subscription page with upgrade button
- ✅ Close modal by clicking backdrop
- ✅ Display custom messages from API
- ✅ Prevent third venue creation on Free tier
- ✅ Prevent 26th recipe creation on Free tier

**Requirements Validated:**
- Requirement 11.3: Display upgrade prompt when accessing paid features
- Requirement 10.2: Free tier 2-venue limit
- Requirement 2.12: Free tier 25-recipe limit per venue

## Running Tests

### Prerequisites

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright browsers:
   ```bash
   npx playwright install chromium
   ```

### Run Tests

```bash
# Run all E2E tests (headless)
npm run test:e2e

# Run with UI mode (recommended for development)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed

# Debug mode (step through tests)
npm run test:e2e:debug

# Run specific test file
npx playwright test social-login-venue-subscription.spec.ts

# Run specific test by name
npx playwright test -g "should display Google social login button"
```

### View Test Report

After running tests, view the HTML report:

```bash
npx playwright show-report
```

## Test Architecture

### Fixtures (`fixtures/auth.ts`)

Provides reusable test utilities:

- **`createMockUser(tier)`**: Create mock users with different subscription tiers
- **`createMockVenues(count)`**: Generate mock venue data
- **`createMockAuthResponse(tier)`**: Generate mock authentication responses
- **`setAuthState(page, tier)`**: Set up authenticated state in localStorage
- **`setVenueState(page, venues, currentVenueId)`**: Set up venue state
- **`mockApiRoutes(page)`**: Mock common API endpoints for testing

### Test Structure

Tests are organized into three main describe blocks:

1. **Social Login (Google OAuth)**: Tests OAuth flow initiation, callback handling, error cases
2. **Venue Switching**: Tests venue selection, data loading, persistence
3. **Subscription Upgrade Prompt**: Tests upgrade modal display, tier limits, navigation

## Configuration

Test configuration is in `playwright.config.ts`:

- **Base URL**: `http://localhost:5173` (Vite dev server)
- **Browser**: Chromium (can be extended to Firefox, WebKit)
- **Dev Server**: Automatically starts Vite before tests
- **Retry**: 2 retries on CI, 0 locally
- **Screenshots**: Captured on failure
- **Traces**: Captured on first retry

## Mocking Strategy

Tests use Playwright's `page.route()` to mock API endpoints:

- **Authentication endpoints**: Return mock tokens and user data
- **Venue endpoints**: Return mock venue lists
- **Feature endpoints**: Return 402 responses for tier-gated features

This allows tests to run without a backend server and ensures consistent, reliable test results.

## Test Data

All test data is generated programmatically using fixture functions:

- User IDs: `user-123`
- Organisation IDs: `org-123`
- Venue IDs: `venue-1`, `venue-2`, etc.
- Mock tokens: `mock-access-token`, `mock-refresh-token`

## CI/CD Integration

Tests are configured to run in CI environments (GitHub Actions):

- Use headless mode
- Run with 1 worker (sequential) for stability
- Retry failed tests up to 2 times
- Fail build if `test.only` is found

## Debugging Tips

1. **Use UI Mode**: Run `npm run test:e2e:ui` to interactively explore tests
2. **Debug Mode**: Use `npm run test:e2e:debug` to step through tests
3. **Headed Mode**: Run `npm run test:e2e:headed` to watch browser execution
4. **Console Logs**: Check terminal for `console.log()` output from tests
5. **Screenshots**: Failed tests automatically capture screenshots in `test-results/`
6. **Traces**: View detailed traces with `npx playwright show-trace <trace-file>`

## Writing New Tests

When adding new E2E tests:

1. Use the fixtures in `fixtures/auth.ts` for common setup
2. Mock API routes at the start of each test
3. Use descriptive test names that explain what is being tested
4. Follow the AAA pattern: Arrange, Act, Assert
5. Use `await expect()` for all assertions
6. Add comments for complex test logic

## Known Limitations

- OAuth flow tests mock the backend redirect; full OAuth with Cognito requires integration environment
- Performance tests use simulated delays; actual network conditions may vary
- Tests assume English locale; internationalization not yet covered
