# Recipe API Request Deserialization Fix

## Issue
Recipe creation failed with validation error: "Recipe validation failed: Portion count is required"

### Root Causes
1. **Missing @JsonProperty annotations**: `CreateRecipeRequest`, `UpdateRecipeRequest`, and `IngredientLineRequest` DTOs didn't have `@JsonProperty` annotations, so Jackson couldn't deserialize camelCase fields from frontend
2. **UnitOfMeasure enum mapping**: `RecipeIngredientLine` entity used `@Enumerated(EnumType.STRING)` which saves enum names (e.g., "GRAM") but database constraint expects lowercase symbols (e.g., "g")

## Solutions Applied

### 1. Added @JsonProperty Annotations to Request DTOs

**Files Modified:**
- `/modules/api/src/main/java/com/cogschecker/foodcost/api/dto/CreateRecipeRequest.java`
- `/modules/api/src/main/java/com/cogschecker/foodcost/api/dto/UpdateRecipeRequest.java`
- `/modules/api/src/main/java/com/cogschecker/foodcost/api/dto/IngredientLineRequest.java`

Added `@JsonProperty` annotations to all fields to explicitly specify field names for Jackson deserialization:

```java
@JsonProperty("name")
private String name;

@JsonProperty("portionCount")
private Integer portionCount;

@JsonProperty("menuSellingPrice")
private BigDecimal menuSellingPrice;

@JsonProperty("ingredientLines")
private List<IngredientLineRequest> ingredientLines;
```

### 2. Fixed UnitOfMeasure Persistence in RecipeIngredientLine

**File Modified:**
- `/modules/api/src/main/java/com/cogschecker/foodcost/api/domain/RecipeIngredientLine.java`

**Before:**
```java
@Enumerated(EnumType.STRING)
@Column(name = "unit_of_measure", nullable = false, length = 10)
private UomEnum unitOfMeasure;
```

**After:**
```java
@Convert(converter = UomEnumConverter.class)
@Column(name = "unit_of_measure", nullable = false, length = 10)
private UomEnum unitOfMeasure;
```

This uses the existing `UomEnumConverter` which:
- Converts enum to lowercase symbol for database (GRAM → "g")
- Converts database symbol back to enum ("g" → GRAM)

## Testing

### Successful Recipe Creation:
```bash
curl 'http://localhost:8080/api/v1/venues/70fbf7b7-b22d-44fa-87ec-3ac9dad027df/recipes' \
  -H 'Authorization: Bearer mock-token' \
  -H 'X-Venue-ID: 70fbf7b7-b22d-44fa-87ec-3ac9dad027df' \
  -H 'Content-Type: application/json' \
  --data-raw '{
    "name":"Test Recipe 2",
    "portionCount":1,
    "menuSellingPrice":2,
    "ingredientLines":[{
      "ingredientId":"14d93239-c9f4-4f9e-8038-5c005a1856b2",
      "subRecipeId":null,
      "quantityUsed":0.1,
      "unitOfMeasure":"g"
    }]
  }'
```

**Response (201 Created):**
```json
{
  "id": "52ccbcaf-2311-4243-a4a8-765b654d4631",
  "venue_id": "70fbf7b7-b22d-44fa-87ec-3ac9dad027df",
  "name": "Test Recipe 2",
  "portion_count": 1,
  "total_batch_cost": "0.10000",
  "food_cost_per_portion": "0.10",
  "created_at": "2026-06-07T04:47:40.790103Z",
  "updated_at": "2026-06-07T04:47:40.841051Z"
}
```

## Result
✅ Recipe creation now works correctly
✅ Frontend can submit recipes with camelCase field names
✅ Backend properly deserializes all fields including `portionCount`
✅ Unit of measure is correctly persisted as lowercase symbols
✅ Validation works as expected (duplicate name detection, portion count validation, etc.)

## Related Issues Fixed
This fix complements the earlier ingredient API fixes:
- Ingredient creation DTO also needed `@JsonProperty` annotations (already fixed)
- Ingredient entity also needed `@Convert(converter = UomEnumConverter.class)` (already fixed)
- Frontend response interceptor handles snake_case → camelCase transformation (already implemented)

## Pattern
For all request DTOs accepting JSON from frontend:
1. Add `@JsonProperty("fieldName")` annotations to each field
2. This allows Jackson to deserialize camelCase fields despite snake_case naming strategy
3. For UomEnum fields in entities, use `@Convert(converter = UomEnumConverter.class)` instead of `@Enumerated`
