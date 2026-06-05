# RecipeController Implementation Summary

## Task 5.5: Implement RecipeController REST endpoints

### Completed Implementation

#### REST Endpoints Implemented

1. **GET /api/v1/venues/:venueId/recipes**
   - Lists all recipes for a venue
   - Supports search via query parameter `?q=searchTerm`
   - Requirements: 2.9 (search support)
   - RBAC: All roles (read-only)

2. **POST /api/v1/venues/:venueId/recipes**
   - Creates a new recipe with ingredient lines
   - Validates recipe fields and ingredient lines
   - Calculates initial costs after creation
   - Requirements: 2.1, 2.2, 2.10, 2.11, 2.12
   - RBAC: Admin or Manager only

3. **GET /api/v1/venues/:venueId/recipes/:id**
   - Returns recipe with full cost breakdown
   - Each line includes: name, quantity, UOM, unit cost, line cost
   - Missing-price lines: null cost fields + `missingPrice: true` flag
   - Displays totals and incomplete data flag
   - Requirements: 3.5, 3.6, 3.7
   - RBAC: All roles (read-only)

4. **PATCH /api/v1/venues/:venueId/recipes/:id**
   - Updates recipe name, portion count, menu selling price
   - Optionally updates ingredient lines (replaces all)
   - Recalculates costs after update
   - Requirements: 2.5, 2.10, 2.11
   - RBAC: Admin or Manager only

5. **DELETE /api/v1/venues/:venueId/recipes/:id**
   - Deletes a recipe
   - Requires confirmation if used as sub-recipe (via `confirmed=true` query param)
   - Requirements: 2.7, 2.8
   - RBAC: Admin or Manager only

6. **POST /api/v1/venues/:venueId/recipes/:id/duplicate**
   - Duplicates a recipe with "Copy of" prefix
   - Copies all ingredient lines
   - Handles name collision with counter suffix
   - Requirement: 2.6
   - RBAC: Admin or Manager only

7. **POST /api/v1/venues/:venueId/recipes/copy**
   - Copies recipe from another venue (cross-venue copy)
   - Maps ingredients by name to destination venue
   - Skips lines if ingredient not found in destination
   - Requirements: 10.6, 10.7
   - RBAC: Admin only

### DTOs Created

1. **RecipeResponse** - Basic recipe information for list views
2. **RecipeDetailResponse** - Extended response with cost breakdown
3. **CostBreakdownLineResponse** - Individual line in cost breakdown with missing price flag
4. **CreateRecipeRequest** - Request DTO for recipe creation with validation
5. **UpdateRecipeRequest** - Request DTO for recipe updates
6. **IngredientLineRequest** - Ingredient/sub-recipe line with quantity and UOM
7. **CopyRecipeRequest** - Request for cross-venue recipe copy

### Key Features

#### Cost Breakdown (Requirements 3.5, 3.6, 3.7)
- Full breakdown showing each ingredient line with:
  - Name (ingredient or sub-recipe)
  - Quantity used
  - Unit of measure
  - Unit cost (effective cost per usable unit)
  - Line cost (quantity × unit cost)
  - Missing price flag for incomplete data
- Total batch cost and food cost per portion
- `hasIncompleteData` flag at recipe level

#### Cost Calculation
- Automatic recalculation after ingredient line changes
- UOM conversion using `UomConverter.convert()`
- Yield-adjusted costs using `effectiveCostPerUsableUnit`
- Sub-recipe costs calculated from `foodCostPerPortion`
- Requirements: 3.1, 3.2, 3.3, 3.4

#### RBAC Integration (Requirements 9.3, 9.4)
- `@PreAuthorize` annotations on all endpoints
- Manager/Admin for mutations (create, update, delete, duplicate, copy)
- Staff read-only access (list, get detail)
- Admin-only for cross-venue copy

#### Validation
- Recipe name: 1-100 non-whitespace characters
- Portion count: 1-9999 inclusive
- Ingredient lines: max 200 per recipe
- Quantity > 0 for all ingredient lines

### Repository Methods Added

#### RecipeRepository
- `findByVenueIdAndNameIgnoreCase()` - Find recipe by exact name match (case-insensitive)

#### IngredientRepository
- `findByVenueIdAndNameIgnoreCase()` - Find ingredient by exact name match (case-insensitive)

### Implementation Notes

1. **Security Placeholder**: Controller uses `@PreAuthorize` with role-based checks. Full Cognito JWT verification will be implemented in task 7.1.

2. **Tier Checking**: Free tier limit checking is stubbed (`isFreeTier = false`) until JWT claims include tier information.

3. **Cost Propagation**: Controller performs immediate cost recalculation. Async cost propagation via SQS will be implemented in task 5.7.

4. **Cross-Venue Copy**: Currently skips lines with missing ingredients. Full implementation with user mapping UI will be added in task 10.7.

5. **Missing Price Handling**: Correctly implements Requirement 3.6 by:
   - Setting `unitCost` and `lineCost` to `null`
   - Including `missingPrice: true` flag per line
   - Displaying breakdown structure even with incomplete data

### Files Created/Modified

**Created:**
- `modules/api/src/main/java/com/cogschecker/foodcost/api/controller/RecipeController.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/RecipeResponse.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/RecipeDetailResponse.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/CostBreakdownLineResponse.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/CreateRecipeRequest.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/UpdateRecipeRequest.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/IngredientLineRequest.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/CopyRecipeRequest.java`

**Modified:**
- `modules/api/src/main/java/com/cogschecker/foodcost/api/repository/RecipeRepository.java` - Added `findByVenueIdAndNameIgnoreCase()`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/repository/IngredientRepository.java` - Added `findByVenueIdAndNameIgnoreCase()`

### Build Status

✅ Code compiles successfully
✅ No compilation errors
✅ Follows existing codebase patterns
✅ All requirements addressed

### Requirements Coverage

- ✅ 2.1 - Recipe creation with ingredient lines
- ✅ 2.2 - Add ingredient line with quantity and UOM
- ✅ 2.3 - Sub-recipe support (via RecipeIngredientLineService)
- ✅ 2.4 - Circular reference prevention (via RecipeIngredientLineService)
- ✅ 2.5 - Recipe editing
- ✅ 2.6 - Recipe duplication
- ✅ 2.7 - Recipe deletion
- ✅ 2.8 - Sub-recipe warning on delete
- ✅ 2.9 - Recipe search
- ✅ 2.10 - Validation
- ✅ 2.11 - Validation error messages
- ✅ 2.12 - Free tier limit checking (stubbed)
- ✅ 3.5 - Cost breakdown display
- ✅ 3.6 - Missing price handling with flag
- ✅ 3.7 - Always display breakdown structure
- ✅ 9.3 - Manager/Admin mutation access
- ✅ 9.4 - Staff read-only access
- ✅ 10.6 - Cross-venue recipe copy
- ✅ 10.7 - Ingredient mapping (partial - skips missing)
