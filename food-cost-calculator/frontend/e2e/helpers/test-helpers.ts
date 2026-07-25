import { Page, expect } from '@playwright/test';

/**
 * E2E Test Helper Utilities
 * 
 * Common patterns and utilities for E2E testing the Food Cost Calculator
 */

/**
 * Login helper - authenticate a user
 */
export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  
  // Wait for successful login
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
}

/**
 * Register helper - create a new user account
 */
export async function register(page: Page, email: string, password: string) {
  await page.goto('/register');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.fill('input[name="confirmPassword"]', password);
  await page.click('button[type="submit"]');
  
  // Wait for successful registration
  await expect(page).toHaveURL(/\/(login|dashboard)/, { timeout: 10000 });
}

/**
 * Logout helper
 */
export async function logout(page: Page) {
  await page.click('button:has-text("Logout"), button:has-text("Sign Out"), a:has-text("Logout")');
  await expect(page).toHaveURL(/\/(login|$)/, { timeout: 5000 });
}

/**
 * Create ingredient helper
 */
export async function createIngredient(
  page: Page,
  ingredient: {
    name: string;
    purchasePrice: string;
    purchaseQuantity: string;
    unitOfMeasure: string;
    yield?: string;
  }
) {
  // Navigate to ingredients
  await page.click('text=/ingredients/i');
  await expect(page).toHaveURL(/\/ingredients/);
  
  // Open create form
  await page.click('button:has-text("New Ingredient"), button:has-text("Add Ingredient"), button:has-text("Create")');
  
  // Fill form
  await page.fill('input[name="name"]', ingredient.name);
  await page.fill('input[name="purchasePrice"], input[name="purchase_price"]', ingredient.purchasePrice);
  await page.fill('input[name="purchaseQuantity"], input[name="purchase_quantity"]', ingredient.purchaseQuantity);
  await page.selectOption('select[name="unitOfMeasure"], select[name="unit_of_measure"]', ingredient.unitOfMeasure);
  
  if (ingredient.yield) {
    const yieldInput = page.locator('input[name="yieldPercentage"], input[name="yield_percentage"]');
    if (await yieldInput.count() > 0) {
      await yieldInput.fill(ingredient.yield);
    }
  }
  
  // Save
  await page.click('button[type="submit"]:has-text("Save"), button:has-text("Create")');
  
  // Verify created
  await expect(page.locator(`text=${ingredient.name}`)).toBeVisible({ timeout: 5000 });
}

/**
 * Create recipe helper
 */
export async function createRecipe(
  page: Page,
  recipe: {
    name: string;
    portionCount: string;
    ingredientName: string;
    ingredientQuantity: string;
    menuPrice?: string;
  }
) {
  // Navigate to recipes
  await page.click('text=/recipes/i');
  await expect(page).toHaveURL(/\/recipes/);
  
  // Open create form
  await page.click('button:has-text("New Recipe"), button:has-text("Add Recipe"), button:has-text("Create")');
  
  // Fill basic info
  await page.fill('input[name="name"]', recipe.name);
  await page.fill('input[name="portionCount"], input[name="portion_count"]', recipe.portionCount);
  
  // Add ingredient
  await page.click('button:has-text("Add Ingredient")');
  await page.click(`text=${recipe.ingredientName}`);
  await page.fill('input[name="quantity"]', recipe.ingredientQuantity);
  
  // Save
  await page.click('button[type="submit"]:has-text("Save"), button:has-text("Create")');
  
  // Verify created
  await expect(page.locator(`text=${recipe.name}`)).toBeVisible({ timeout: 5000 });
  
  // Optionally set menu price
  if (recipe.menuPrice) {
    await page.click(`text=${recipe.name}`);
    const menuPriceInput = page.locator('input[name="menuPrice"], input[name="menu_price"]');
    if (await menuPriceInput.count() > 0) {
      await menuPriceInput.fill(recipe.menuPrice);
      await page.click('button:has-text("Save")');
    }
  }
}

/**
 * Wait for API response helper
 */
export async function waitForApiResponse(page: Page, urlPattern: string | RegExp, timeout = 10000) {
  return page.waitForResponse(
    (response) => {
      const url = response.url();
      if (typeof urlPattern === 'string') {
        return url.includes(urlPattern);
      }
      return urlPattern.test(url);
    },
    { timeout }
  );
}

/**
 * Generate unique test data helper
 */
export function generateTestData(prefix: string) {
  const timestamp = Date.now();
  return {
    timestamp,
    email: `${prefix}.${timestamp}@example.com`,
    name: `${prefix} ${timestamp}`,
  };
}

/**
 * Verify table contains row helper
 */
export async function verifyTableRow(page: Page, values: string[]) {
  for (const value of values) {
    await expect(page.locator(`td:has-text("${value}")`)).toBeVisible();
  }
}

/**
 * Export CSV and verify helper
 */
export async function exportAndVerifyCSV(page: Page) {
  const downloadPromise = page.waitForEvent('download');
  await page.click('button:has-text("Export"), button:has-text("Download CSV")');
  
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  
  const path = await download.path();
  expect(path).toBeTruthy();
  
  return download;
}

/**
 * Clean up test data helper
 * 
 * Note: This would require API access to clean up test data.
 * In a real implementation, you might want to:
 * 1. Use the API to delete test data after tests
 * 2. Use a test database that gets reset between runs
 * 3. Use unique test user accounts per run
 */
export async function cleanupTestData(page: Page, itemNames: string[]) {
  // Implementation depends on your cleanup strategy
  // This is a placeholder for the pattern
  console.log('Cleanup test data:', itemNames);
}
