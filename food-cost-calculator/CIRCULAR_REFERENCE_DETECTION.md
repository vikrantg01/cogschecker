# Circular Reference Detection Implementation

## Overview
This document describes the implementation of circular sub-recipe reference detection for task 5.2.

## Requirements
- **Requirement 2.3**: Allow users to add sub-recipes as ingredient lines
- **Requirement 2.4**: Detect and prevent circular references when adding sub-recipes

## Implementation

### 1. Database Query (Recursive CTE)
**File**: `RecipeRepository.java`

The `existsCircularReference(parentRecipeId, candidateSubRecipeId)` method uses a recursive Common Table Expression (CTE) to detect circular references:

```sql
WITH RECURSIVE ancestors(recipe_id) AS (
  -- Base case: Find all direct sub-recipes of the candidate
  SELECT sub_recipe_id FROM recipe_ingredient_lines
  WHERE recipe_id = :candidateSubRecipeId AND sub_recipe_id IS NOT NULL
  
  UNION ALL
  
  -- Recursive case: Find sub-recipes of sub-recipes
  SELECT ril.sub_recipe_id FROM recipe_ingredient_lines ril
  INNER JOIN ancestors ON ril.recipe_id = ancestors.recipe_id
  WHERE ril.sub_recipe_id IS NOT NULL
)
SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END 
FROM ancestors WHERE recipe_id = :parentRecipeId
```

**How it works**:
1. Starts with the candidate sub-recipe and finds all its direct dependencies
2. Recursively traverses down the dependency tree to find all transitive dependencies
3. Checks if the parent recipe appears anywhere in that dependency tree
4. If the parent is found, adding the candidate would create a cycle

**Example**:
- Recipe A contains Recipe B
- Recipe B contains Recipe C
- Trying to add Recipe A to Recipe C
- CTE finds: C → B → A
- Since A (the parent) appears in C's dependencies, it returns `true` (circular reference detected)

### 2. Exception Class
**File**: `CircularReferenceException.java`

A domain exception that extends `DomainException` and is mapped to HTTP 409 Conflict by the `GlobalExceptionHandler`.

### 3. Service Layer
**File**: `RecipeIngredientLineService.java`

The service provides:
- `saveIngredientLine()`: Validates circular references before persisting lines with sub-recipes
- `validateNoCircularReference()`: Explicit validation method that can be called independently
- Direct self-reference check (before hitting the database)
- Transitive circular reference check (using the CTE query)

### 4. Global Exception Handler
**File**: `GlobalExceptionHandler.java`

Updated to map `CircularReferenceException` to HTTP 409 Conflict status.

## Test Coverage

### Unit Tests
**File**: `RecipeIngredientLineServiceTest.java`

Tests include:
- Regular ingredient lines (no validation needed)
- Valid sub-recipe addition (no circular reference)
- Direct self-reference detection
- Transitive circular reference detection
- Validation method behavior

### Integration Tests
**File**: `RecipeRepositoryCircularReferenceTest.java`

Database integration tests covering:
1. **No sub-recipes**: Two independent recipes → no circular reference
2. **Direct circle**: A → B, trying to add A to B → circular reference detected
3. **Transitive circle**: A → B → C, trying to add A to C → circular reference detected
4. **Deep transitive**: A → B → C → D, trying to add A to D → circular reference detected
5. **Diamond pattern**: A → B → D, A → C → D, adding E to D → no circular reference
6. **Complex graph**: A → B → C, A → D, trying to add A to C → circular reference detected
7. **Multiple sub-recipes**: A → B, C, D, adding E to D → no circular reference

All tests pass with both H2 (test environment) and PostgreSQL (production).

## Usage

When creating or updating a `recipe_ingredient_line` that sets `sub_recipe_id`:

```java
RecipeIngredientLine line = new RecipeIngredientLine();
line.setRecipeId(parentRecipeId);
line.setSubRecipeId(candidateSubRecipeId);
line.setQuantityUsed(quantity);
line.setUnitOfMeasure(uom);

// This will throw CircularReferenceException if a cycle would be created
RecipeIngredientLine saved = recipeIngredientLineService.saveIngredientLine(line);
```

The exception will be automatically caught by the `GlobalExceptionHandler` and returned as:
- HTTP Status: 409 Conflict
- Error Code: `RECIPE_2005` (RECIPE_CIRCULAR_REFERENCE)
- Error Message: Details about the circular reference

## Performance Considerations

- The CTE query traverses the dependency graph depth-first
- Performance is O(d) where d is the maximum depth of the sub-recipe tree
- For typical use cases (2-5 levels of nesting), this is very fast
- The query is only executed when sub-recipes are involved (not for regular ingredients)
- Database indexes on `recipe_ingredient_lines.recipe_id` and `recipe_ingredient_lines.sub_recipe_id` optimize the join operations

## Future Enhancements

Possible optimizations if needed:
1. Cache the dependency graph per venue in Redis
2. Add a materialized path or nested set model for faster ancestor queries
3. Limit maximum sub-recipe depth to prevent excessively deep trees
