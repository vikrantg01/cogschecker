# Task 16.4 Implementation Summary

## Overview

Task 16.4 involves implementing three REST endpoints for Square POS integration:
1. **DELETE /venues/:venueId/square/connection** - Disconnect Square integration
2. **GET /venues/:venueId/square/unmatched** - Get unmatched Square items
3. **PATCH /venues/:venueId/square/unmatched/:id** - Manage/resolve unmatched items

**Status:** ✅ **COMPLETE** - All endpoints have been fully implemented with proper RBAC, validation, error handling, and unit tests.

## Requirements Addressed

- **Requirement 12.4**: Square sync - unmatched item management (logging, review, and mapping)
- **Requirement 12.5**: Square disconnect functionality (delete tokens, retain synced prices)

## Implementation Details

### 1. Disconnect Endpoint

**Endpoint:** `DELETE /venues/:venueId/square/connection`

**Implementation:**
- **Controller:** `SquareController.disconnectSquare()`
- **Service:** `SquareOAuthService.disconnect()`
- **Authorization:** Admin only (`@PreAuthorize("hasVenueRole('ADMIN', #venueId)")`)
- **Response:** HTTP 204 No Content on success

**Functionality:**
- Deletes the Square connection record from the database
- Removes encrypted access and refresh tokens
- Previously synced menu prices are retained in recipes
- Future scheduled syncs are stopped automatically

**Code Location:**
```
modules/api/src/main/java/com/cogschecker/foodcost/api/controller/SquareController.java:146-159
modules/api/src/main/java/com/cogschecker/foodcost/api/service/SquareOAuthService.java:146-152
```

### 2. Get Unmatched Items Endpoint

**Endpoint:** `GET /venues/:venueId/square/unmatched`

**Implementation:**
- **Controller:** `SquareController.getUnmatchedItems()`
- **Service:** `SquareUnmatchedItemService.getUnmatchedItems()`
- **Authorization:** Manager or Admin (`@PreAuthorize("hasVenueRole('MANAGER', #venueId)")`)
- **Response:** List of `SquareUnmatchedItemResponse` DTOs

**Functionality:**
- Retrieves all unmatched Square items for a venue
- Returns items with status: `PENDING`, `MAPPED`, or `DISMISSED`
- Each item includes: id, venueId, squareItemName, squareItemPrice, status, mappedRecipeId

**Response Example:**
```json
[
  {
    "id": "uuid",
    "venueId": "uuid",
    "squareItemName": "Latte",
    "squareItemPrice": "4.50",
    "status": "PENDING",
    "mappedRecipeId": null
  }
]
```

**Code Location:**
```
modules/api/src/main/java/com/cogschecker/foodcost/api/controller/SquareController.java:161-175
modules/api/src/main/java/com/cogschecker/foodcost/api/service/SquareUnmatchedItemService.java:35-45
```

### 3. Update Unmatched Item Endpoint

**Endpoint:** `PATCH /venues/:venueId/square/unmatched/:id`

**Implementation:**
- **Controller:** `SquareController.updateUnmatchedItem()`
- **Service:** `SquareUnmatchedItemService.updateUnmatchedItem()`
- **Authorization:** Admin only (`@PreAuthorize("hasVenueRole('ADMIN', #venueId)")`)
- **Request Body:** `UpdateUnmatchedItemRequest`
- **Response:** Updated `SquareUnmatchedItemResponse`

**Functionality:**
- **Map to Recipe:** Sets status to `MAPPED` and associates with a recipe
  - Validates that the recipe exists and belongs to the venue
  - Requires `mappedRecipeId` in request body
- **Dismiss:** Sets status to `DISMISSED` and clears any mapping
  - Dismissed items are excluded from future sync consideration

**Request Example (Map):**
```json
{
  "status": "mapped",
  "mappedRecipeId": "uuid"
}
```

**Request Example (Dismiss):**
```json
{
  "status": "dismissed"
}
```

**Validation:**
- Status must be either "mapped" or "dismissed"
- If status is "mapped", `mappedRecipeId` is required
- Recipe must exist and belong to the venue
- Unmatched item must belong to the specified venue

**Code Location:**
```
modules/api/src/main/java/com/cogschecker/foodcost/api/controller/SquareController.java:177-200
modules/api/src/main/java/com/cogschecker/foodcost/api/service/SquareUnmatchedItemService.java:47-96
```

## Data Model

### SquareConnection Entity
```java
@Entity
@Table(name = "square_connections")
class SquareConnection {
    UUID id;
    UUID venueId;                      // UNIQUE
    String squareMerchantId;
    byte[] accessTokenEncrypted;       // KMS encrypted
    byte[] refreshTokenEncrypted;      // KMS encrypted
    Instant tokenExpiresAt;
    Instant lastSyncedAt;
    SyncStatus syncStatus;             // IDLE, SYNCING, ERROR
}
```

### SquareUnmatchedItem Entity
```java
@Entity
@Table(name = "square_unmatched_items")
class SquareUnmatchedItem {
    UUID id;
    UUID venueId;
    String squareItemName;
    BigDecimal squareItemPrice;
    UnmatchedStatus status;            // PENDING, MAPPED, DISMISSED
    UUID mappedRecipeId;               // nullable
    Instant createdAt;
    Instant updatedAt;
}
```

## Repository Methods

### SquareConnectionRepository
- `Optional<SquareConnection> findByVenueId(UUID venueId)`
- `boolean existsByVenueId(UUID venueId)`
- `void deleteByVenueId(UUID venueId)` ⭐ Used by disconnect endpoint

### SquareUnmatchedItemRepository
- `List<SquareUnmatchedItem> findByVenueId(UUID venueId)` ⭐ Used by GET unmatched
- `Optional<SquareUnmatchedItem> findByVenueIdAndSquareItemNameIgnoreCase(UUID venueId, String name)`
- `void deleteByVenueIdAndStatusDismissed(UUID venueId)` - Cleanup dismissed items

## Unit Tests

All endpoints have comprehensive unit tests in `SquareControllerTest`:

### Test Coverage:
1. ✅ `disconnectSquare_success()` - Verifies disconnect endpoint works
2. ✅ `getUnmatchedItems_success()` - Tests retrieving unmatched items list
3. ✅ `updateUnmatchedItem_mapToRecipe_success()` - Tests mapping an item to a recipe
4. ✅ `updateUnmatchedItem_dismiss_success()` - Tests dismissing an item
5. ✅ `updateUnmatchedItem_invalidStatus_badRequest()` - Tests validation error handling

**Test File Location:**
```
modules/api/src/test/java/com/cogschecker/foodcost/api/controller/SquareControllerTest.java
```

### Test Fix Applied
Fixed missing `@Import(TestSecurityConfig.class)` annotation to properly configure security beans for @WebMvcTest.

## Error Handling

All endpoints use the global exception handler with proper error responses:

- **ResourceNotFoundException** → HTTP 404
  - Unmatched item not found
  - Recipe not found for mapping
- **ValidationException** → HTTP 400
  - Invalid status value
  - Missing mappedRecipeId when status is "mapped"
  - Recipe doesn't belong to venue
- **RuntimeException** → HTTP 500
  - Square service failures
  - Database errors

## Security & RBAC

### Authorization Matrix:
| Endpoint | Admin | Manager | Staff |
|----------|-------|---------|-------|
| DELETE /connection | ✅ | ❌ | ❌ |
| GET /unmatched | ✅ | ✅ | ❌ |
| PATCH /unmatched/:id | ✅ | ❌ | ❌ |

### Implementation:
- Uses Spring Security `@PreAuthorize` annotations
- RBAC is enforced via `RbacAuthorizationManager`
- Venue scope is validated by `VenueScopeFilter`
- Pro/Pro+ tier required (enforced by `SubscriptionGateFilter`)

## Integration with Square Sync Worker

The unmatched items management endpoints work in conjunction with the Square sync worker (`SquareSyncWorker`):

1. **Sync Worker** (Task 16.2) syncs menu items from Square
2. Items that don't match any recipe by name are logged as **unmatched**
3. **GET /unmatched** endpoint retrieves these for Admin/Manager review
4. **PATCH /unmatched/:id** allows Admin to:
   - Map to an existing recipe (manual matching)
   - Dismiss false positives or irrelevant items
5. **Mapped items** will be used in future syncs to update recipe prices
6. **Dismissed items** are excluded from future sync consideration

## API Examples

### Disconnect Square Integration
```bash
curl -X DELETE \
  https://api.foodcostcalc.com/api/v1/venues/{venueId}/square/connection \
  -H "Authorization: Bearer {jwt_token}"
```

### Get Unmatched Items
```bash
curl -X GET \
  https://api.foodcostcalc.com/api/v1/venues/{venueId}/square/unmatched \
  -H "Authorization: Bearer {jwt_token}"
```

### Map Unmatched Item to Recipe
```bash
curl -X PATCH \
  https://api.foodcostcalc.com/api/v1/venues/{venueId}/square/unmatched/{unmatchedItemId} \
  -H "Authorization: Bearer {jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "mapped",
    "mappedRecipeId": "{recipeId}"
  }'
```

### Dismiss Unmatched Item
```bash
curl -X PATCH \
  https://api.foodcostcalc.com/api/v1/venues/{venueId}/square/unmatched/{unmatchedItemId} \
  -H "Authorization: Bearer {jwt_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "dismissed"
  }'
```

## Files Created/Modified

### Controller
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/controller/SquareController.java`
  - Added `disconnectSquare()` method (lines 146-159)
  - Added `getUnmatchedItems()` method (lines 161-175)
  - Added `updateUnmatchedItem()` method (lines 177-200)

### Services
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/service/SquareOAuthService.java`
  - Implemented `disconnect()` method (lines 146-152)
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/service/SquareUnmatchedItemService.java`
  - Implemented `getUnmatchedItems()` method (lines 35-45)
  - Implemented `updateUnmatchedItem()` method (lines 47-96)

### DTOs
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/SquareUnmatchedItemResponse.java`
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/UpdateUnmatchedItemRequest.java`

### Domain
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/domain/SquareUnmatchedItem.java`
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/domain/SquareConnection.java`

### Repositories
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/repository/SquareConnectionRepository.java`
- ✅ `modules/api/src/main/java/com/cogschecker/foodcost/api/repository/SquareUnmatchedItemRepository.java`

### Tests
- ✅ `modules/api/src/test/java/com/cogschecker/foodcost/api/controller/SquareControllerTest.java`
  - Fixed: Added `@Import(TestSecurityConfig.class)` annotation
  - All 5 test cases passing

## Compliance Verification

### Requirements Checklist:
- ✅ **12.4** - Unmatched items can be reviewed via GET endpoint
- ✅ **12.4** - Unmatched items can be manually mapped to recipes via PATCH
- ✅ **12.4** - Unmatched items can be dismissed via PATCH
- ✅ **12.5** - Square connection can be disconnected via DELETE
- ✅ **12.5** - Tokens are deleted on disconnect
- ✅ **12.5** - Previously synced prices are retained after disconnect
- ✅ **12.5** - Future syncs are stopped after disconnect

### Design Compliance:
- ✅ RESTful API design with proper HTTP methods
- ✅ Proper authorization (Admin for disconnect/update, Manager for view)
- ✅ Input validation with Bean Validation annotations
- ✅ Proper error handling with global exception handler
- ✅ Transactional service methods
- ✅ Repository methods for data access
- ✅ Comprehensive unit test coverage

## Next Steps

Task 16.4 is **COMPLETE**. The following related tasks may be next:

1. **Task 17.1** - Invoice OCR pipeline implementation
2. **Task 26.1** - Frontend implementation for Square connection UI
   - Square connection page with OAuth button
   - Unmatched item review list UI
   - Map/dismiss action buttons

## Notes

- All endpoints require Pro or Pro+ subscription tier (enforced by `SubscriptionGateFilter`)
- Encryption of Square tokens uses KMS-managed keys via `EncryptionService`
- The disconnect operation is idempotent (safe to call multiple times)
- Unmatched items are created automatically by the Square sync worker during menu item sync
- Mapped items will be used in future syncs to correctly update recipe prices even when names don't match exactly
