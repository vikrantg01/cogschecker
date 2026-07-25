import { Page } from '@playwright/test';

/**
 * Mock user for testing
 */
export interface MockUser {
  id: string;
  email: string;
  displayName: string;
  organisationId: string;
  tier: 'free' | 'pro' | 'pro_plus';
}

/**
 * Mock venue for testing
 */
export interface MockVenue {
  id: string;
  organisationId: string;
  name: string;
  address?: string;
}

/**
 * Mock authentication response
 */
export interface MockAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: MockUser;
}

/**
 * Create a mock user with specified tier
 */
export function createMockUser(tier: 'free' | 'pro' | 'pro_plus' = 'free'): MockUser {
  return {
    id: 'user-123',
    email: 'test@example.com',
    displayName: 'Test User',
    organisationId: 'org-123',
    tier,
  };
}

/**
 * Create mock venues for testing
 */
export function createMockVenues(count: number = 2): MockVenue[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `venue-${i + 1}`,
    organisationId: 'org-123',
    name: `Test Venue ${i + 1}`,
    address: `${i + 1} Test Street`,
  }));
}

/**
 * Create a mock auth response
 */
export function createMockAuthResponse(tier: 'free' | 'pro' | 'pro_plus' = 'free'): MockAuthResponse {
  return {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    user: createMockUser(tier),
  };
}

/**
 * Set up auth state in localStorage for authenticated tests
 */
export async function setAuthState(page: Page, tier: 'free' | 'pro' | 'pro_plus' = 'free') {
  const authResponse = createMockAuthResponse(tier);
  
  await page.addInitScript((auth) => {
    localStorage.setItem('auth-storage', JSON.stringify({
      state: {
        token: auth.accessToken,
        refreshToken: auth.refreshToken,
        user: auth.user,
        isAuthenticated: true,
      },
      version: 0,
    }));
  }, authResponse);
}

/**
 * Set up venue state in localStorage for venue tests
 */
export async function setVenueState(page: Page, venues: MockVenue[], currentVenueId?: string) {
  await page.addInitScript((data) => {
    localStorage.setItem('venue-storage', JSON.stringify({
      state: {
        currentVenueId: data.currentVenueId || data.venues[0]?.id || null,
        venues: data.venues,
      },
      version: 0,
    }));
  }, { venues, currentVenueId });
}

/**
 * Mock API routes for testing
 */
export async function mockApiRoutes(page: Page) {
  // Mock login endpoint
  await page.route('**/api/v1/auth/login', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockAuthResponse('free')),
    });
  });

  // Mock venues list endpoint
  await page.route('**/api/v1/organisations/*/venues', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(createMockVenues(2)),
    });
  });

  // Mock 402 response for gated features
  await page.route('**/api/v1/venues/*/insights', async (route) => {
    await route.fulfill({
      status: 402,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'PAYMENT_REQUIRED',
        message: 'This feature requires a Pro+ subscription.',
        requiredTier: 'pro_plus',
      }),
    });
  });
}
