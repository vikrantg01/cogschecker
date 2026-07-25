import { test, expect, Page } from '@playwright/test';

/**
 * E2E Test: Critical User Journey
 * 
 * Tests the complete critical path through the application:
 * 1. Register a new user
 * 2. Login with credentials
 * 3. Create an ingredient
 * 4. Create a recipe using the ingredient
 * 5. View cost breakdown
 * 6. View recipe costing report
 * 7. Export CSV
 * 8. Logout
 * 
 * Requirements tested: 1.1, 2.1, 3.1, 4.1, 5.1, 7.4, 8.1, 8.2
 */

// Test data - use timestamp to ensure uniqueness across test runs
const timestamp = Date.now();
const testUser = {
  email: `test.user.${timestamp}@example.com`,
  password: 'TestPassword123!',
  displayName: 'Test User',
};

const testIngredient = {
  name: `Test Flour ${timestamp}`,
  purchasePrice: '25.00',
  purchaseQuantity: '5',
  unitOfMeasure: 'kg',
  yield: '100',
};

const testRecipe = {
  name: `Test Bread ${timestamp}`,
  portionCount: '10',
  ingredientQuantity: '2',
  menuPrice: '15.00',
};

test.describe('Critical User Journey E2E', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('Complete critical user journey: register → login → create ingredient → create recipe → view cost breakdown → view report → export CSV → logout', async () => {
    // ========================================
    // Step 1: Register a new user
    // ========================================
    test.step('Register new user', async () => {
      await page.goto('/register');
      
      // Fill registration form
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      await page.fill('input[name="confirmPassword"]', testUser.password);
      
      // Submit registration
      await page.click('button[type="submit"]');
      
      // Wait for successful registration
      // Should redirect to login or show success message
      await expect(page).toHaveURL(/\/(login|dashboard)/, { timeout: 10000 });
    });

    // ========================================
    // Step 2: Login with credentials
    // ========================================
    test.step('Login with credentials', async () => {
      // Navigate to login if not already there
      if (!page.url().includes('/login')) {
        await page.goto('/login');
      }
      
      // Fill login form
      await page.fill('input[name="email"]', testUser.email);
      await page.fill('input[name="password"]', testUser.password);
      
      // Submit login
      await page.click('button[type="submit"]');
      
      // Wait for successful login and redirect to dashboard
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 10000 });
      
      // Verify user is authenticated
      await expect(page.locator('text=/logout|sign out/i')).toBeVisible();
    });

    // ========================================
    // Step 3: Create an ingredient
    // ========================================
    test.step('Create ingredient', async () => {
      // Navigate to ingredients page
      await page.click('text=/ingredients/i');
      await expect(page).toHaveURL(/\/ingredients/);
      
      // Click create new ingredient button
      await page.click('button:has-text("New Ingredient"), button:has-text("Add Ingredient"), button:has-text("Create")');
      
      // Fill ingredient form
      await page.fill('input[name="name"]', testIngredient.name);
      await page.fill('input[name="purchasePrice"], input[name="purchase_price"]', testIngredient.purchasePrice);
      await page.fill('input[name="purchaseQuantity"], input[name="purchase_quantity"]', testIngredient.purchaseQuantity);
      
      // Select unit of measure
      await page.selectOption('select[name="unitOfMeasure"], select[name="unit_of_measure"]', testIngredient.unitOfMeasure);
      
      // Optional: Fill yield if field exists
      const yieldInput = page.locator('input[name="yieldPercentage"], input[name="yield_percentage"]');
      if (await yieldInput.count() > 0) {
        await yieldInput.fill(testIngredient.yield);
      }
      
      // Save ingredient
      await page.click('button[type="submit"]:has-text("Save"), button:has-text("Create")');
      
      // Verify ingredient was created
      await expect(page.locator(`text=${testIngredient.name}`)).toBeVisible({ timeout: 5000 });
      
      // Verify cost per unit is calculated and displayed
      await expect(page.locator('text=/cost per unit|unit cost/i')).toBeVisible();
    });

    // ========================================
    // Step 4: Create a recipe using the ingredient
    // ========================================
    test.step('Create recipe', async () => {
      // Navigate to recipes page
      await page.click('text=/recipes/i');
      await expect(page).toHaveURL(/\/recipes/);
      
      // Click create new recipe button
      await page.click('button:has-text("New Recipe"), button:has-text("Add Recipe"), button:has-text("Create")');
      
      // Fill recipe basic info
      await page.fill('input[name="name"]', testRecipe.name);
      await page.fill('input[name="portionCount"], input[name="portion_count"]', testRecipe.portionCount);
      
      // Add ingredient line
      await page.click('button:has-text("Add Ingredient")');
      
      // Select the ingredient we created
      await page.click(`text=${testIngredient.name}`);
      
      // Fill ingredient quantity
      await page.fill('input[name="quantity"]', testRecipe.ingredientQuantity);
      
      // Select unit of measure (should default to ingredient's unit)
      // May need to verify or select explicitly
      
      // Save recipe
      await page.click('button[type="submit"]:has-text("Save"), button:has-text("Create")');
      
      // Verify recipe was created
      await expect(page.locator(`text=${testRecipe.name}`)).toBeVisible({ timeout: 5000 });
    });

    // ========================================
    // Step 5: View cost breakdown
    // ========================================
    test.step('View cost breakdown', async () => {
      // Click on the recipe to view details
      await page.click(`text=${testRecipe.name}`);
      
      // Verify cost breakdown is displayed
      await expect(page.locator('text=/cost breakdown|recipe cost/i')).toBeVisible();
      
      // Verify ingredient appears in breakdown
      await expect(page.locator(`text=${testIngredient.name}`)).toBeVisible();
      
      // Verify food cost per portion is calculated
      await expect(page.locator('text=/food cost per portion|cost per serving/i')).toBeVisible();
      
      // Verify batch cost is displayed
      await expect(page.locator('text=/total batch cost|batch cost/i')).toBeVisible();
      
      // Add menu price
      const menuPriceInput = page.locator('input[name="menuPrice"], input[name="menu_price"]');
      if (await menuPriceInput.count() > 0) {
        await menuPriceInput.fill(testRecipe.menuPrice);
        await page.click('button:has-text("Save")');
        
        // Verify food cost percentage is calculated
        await expect(page.locator('text=/%/i')).toBeVisible();
      }
    });

    // ========================================
    // Step 6: View recipe costing report
    // ========================================
    test.step('View recipe costing report', async () => {
      // Navigate to reports page
      await page.click('text=/reports/i');
      await expect(page).toHaveURL(/\/reports/);
      
      // Verify report displays recipes
      await expect(page.locator(`text=${testRecipe.name}`)).toBeVisible();
      
      // Verify report columns are present
      await expect(page.locator('text=/recipe name|name/i')).toBeVisible();
      await expect(page.locator('text=/food cost|cost/i')).toBeVisible();
      await expect(page.locator('text=/menu price|price/i')).toBeVisible();
      
      // Test sorting (click on column header)
      await page.click('th:has-text("Name"), th:has-text("Recipe")');
      
      // Verify the report can be sorted
      // The recipe should still be visible after sorting
      await expect(page.locator(`text=${testRecipe.name}`)).toBeVisible();
    });

    // ========================================
    // Step 7: Export CSV
    // ========================================
    test.step('Export CSV', async () => {
      // Find and click export button
      const downloadPromise = page.waitForEvent('download');
      await page.click('button:has-text("Export"), button:has-text("Download CSV")');
      
      // Wait for download to complete
      const download = await downloadPromise;
      
      // Verify the file was downloaded
      expect(download.suggestedFilename()).toMatch(/\.csv$/i);
      
      // Optional: Save the file and verify contents
      const path = await download.path();
      expect(path).toBeTruthy();
    });

    // ========================================
    // Step 8: Logout
    // ========================================
    test.step('Logout', async () => {
      // Click logout button
      await page.click('button:has-text("Logout"), button:has-text("Sign Out"), a:has-text("Logout")');
      
      // Verify redirect to login page
      await expect(page).toHaveURL(/\/(login|$)/, { timeout: 5000 });
      
      // Verify user is no longer authenticated
      await expect(page.locator('text=/login|sign in/i')).toBeVisible();
      
      // Verify cannot access protected pages
      await page.goto('/dashboard');
      
      // Should redirect to login
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 });
    });
  });
});
