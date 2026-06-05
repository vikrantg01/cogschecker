# Task 10.2 Implementation Summary

## Overview
Implemented `DataImportService.import(venueId, json)` with comprehensive schema validation and atomic data replacement within a transactional boundary.

## Requirements Implemented
- **Requirement 7.5**: Import JSON data and atomically replace all venue data within a transaction
- **Requirement 7.6**: Validate JSON against schema; throw `InvalidImportSchemaException` on validation failure without modifying data

## Components Created

### 1. InvalidImportSchemaException
**Location**: `modules/api/src/main/java/com/cogschecker/foodcost/api/exception/InvalidImportSchemaException.java`

- Custom exception extending `ValidationException`
- Maps to HTTP 400 status code via `GlobalExceptionHandler`
- Uses error code `DATA_IMPORT_INVALID_FORMAT` from `ErrorCodes`

### 2. DataImportService
**Location**: `modules/api/src/main/java/com/cogschecker/foodcost/api/service/DataImportService.java`

#### Key Features:
- **Schema Validation**: Uses Jackson ObjectMapper to parse and validate JSON structure
- **Comprehensive Field Validation**:
  - Validates all required fields (version, venue, ingredients, recipes, etc.)
  - Validates ingredient fields: id, name, purchasePrice, purchaseQuantity, unitOfMeasure, yieldPercentage
  - Validates recipe fields: id, name, portionCount, ingredientLines
  - Validates ingredient line fields: id, quantityUsed, unitOfMeasure
  - Validates XOR constraint: each line must have either ingredientId OR subRecipeId (not both, not neither)
  - Validates UOM enum values
- **Atomic Transaction**: All operations wrapped in `@Transactional` annotation
- **Delete-Then-Insert Pattern**:
  1. Deletes all existing ingredient lines for all recipes in venue
  2. Deletes all recipes for venue
  3. Deletes all ingredients for venue
  4. Inserts imported ingredients with new UUIDs
  5. Inserts imported recipes with new UUIDs
  6. Inserts imported ingredient lines with remapped foreign keys
  7. Updates system config
- **ID Remapping**: Maintains mapping of old IDs to new UUIDs to preserve relationships

#### Error Handling:
- Any schema violation throws `InvalidImportSchemaException` before any data modification
- Detailed error messages indicate exact field path (e.g., "venue.recipes[0].ingredientLines[1].id")
- JSON parsing errors wrapped in `InvalidImportSchemaException`

### 3. Repository Updates
Added delete methods to support atomic data replacement:

**IngredientRepository**:
```java
void deleteByVenueId(UUID venueId);
```

**RecipeRepository**:
```java
void deleteByVenueId(UUID venueId);
```

**RecipeIngredientLineRepository**:
```java
void deleteByRecipeId(UUID recipeId);
```

### 4. DataImportServiceTest
**Location**: `modules/api/src/test/java/com/cogschecker/foodcost/api/service/DataImportServiceTest.java`

Comprehensive unit tests covering:
- ✅ Valid JSON import success
- ✅ Malformed JSON rejection
- ✅ Missing required fields (version, venue, ingredients, recipes, etc.)
- ✅ Invalid UOM enum values
- ✅ Missing ingredient line IDs
- ✅ Both ingredientId and subRecipeId present (should fail)
- ✅ Neither ingredientId nor subRecipeId present (should fail)
- ✅ Existing data deletion before import
- ✅ Sub-recipe import handling
- ✅ No data modification on validation failure

## Transaction Guarantees

The `@Transactional` annotation ensures:
1. **Atomicity**: All operations succeed or all fail together
2. **No Partial State**: If validation fails, no data is modified
3. **Consistency**: Foreign key relationships are maintained through ID remapping
4. **Isolation**: Concurrent operations don't see intermediate state

## Data Fidelity

The import service preserves:
- All ingredient fields (name, prices, quantities, UOM, yield, computed costs)
- All recipe fields (name, portions, menu price, batch costs, percentages)
- All ingredient line fields (quantities, UOM, costs)
- Sub-recipe relationships (remapped to new UUIDs)
- System config (target food cost percentage)
- Timestamps (parsed from ISO-8601 format, defaults to current time on parse failure)

## Usage Example

```java
@Autowired
private DataImportService dataImportService;

public void importVenueData(UUID venueId, String jsonData) {
    try {
        dataImportService.importData(venueId, jsonData);
        // Success - all venue data replaced atomically
    } catch (InvalidImportSchemaException e) {
        // Validation failed - no data was modified
        // Error details in exception message and details map
    }
}
```

## Test Results

All unit tests pass:
```
DataImportServiceTest
  ✓ importData_withValidJson_shouldImportSuccessfully
  ✓ importData_withMalformedJson_shouldThrowInvalidImportSchemaException
  ✓ importData_withMissingVersion_shouldThrowInvalidImportSchemaException
  ✓ importData_withMissingVenue_shouldThrowInvalidImportSchemaException
  ✓ importData_withMissingIngredientName_shouldThrowInvalidImportSchemaException
  ✓ importData_withInvalidUom_shouldThrowInvalidImportSchemaException
  ✓ importData_withMissingIngredientLineId_shouldThrowInvalidImportSchemaException
  ✓ importData_withBothIngredientIdAndSubRecipeId_shouldThrowInvalidImportSchemaException
  ✓ importData_withNeitherIngredientIdNorSubRecipeId_shouldThrowInvalidImportSchemaException
  ✓ importData_shouldDeleteExistingDataBeforeImport
  ✓ importData_withSubRecipe_shouldImportCorrectly
  ✓ importData_onValidationFailure_shouldNotModifyData
```

## Compilation Status

✅ All Java source files compile successfully
✅ All test files compile successfully
✅ No compilation errors or warnings

## Next Steps

This implementation can be integrated with:
- REST controller endpoint: `POST /venues/:venueId/import`
- File upload handling for JSON import
- Error response formatting via existing `GlobalExceptionHandler`
- Authentication and authorization checks via existing security filters
