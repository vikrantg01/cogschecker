# Task 17.3: Invoice Review and Confirm Endpoints Implementation

## Overview

Implemented REST endpoints for invoice review and confirmation workflow as specified in task 17.3 of the food-cost-calculator spec. These endpoints enable users to review OCR-extracted data, correct line items, and confirm invoices to automatically update or create ingredients.

## Implementation Summary

### 1. Repository Layer

**Created: `InvoiceLineItemRepository.java`**
- Standard Spring Data JPA repository for `InvoiceLineItem` entity
- Query methods:
  - `findByInvoiceId(UUID invoiceId)` - Get all line items for an invoice
  - `findByInvoiceIdAndId(UUID invoiceId, UUID lineItemId)` - Get specific line item

### 2. DTOs Created

**`InvoiceLineItemResponse.java`**
- Response DTO for invoice line items
- Fields: id, extractedName, extractedQuantity, extractedUnit, extractedPrice, confidenceScore, isLowConfidence, matchedIngredientId, status
- Uses snake_case serialization via Jackson annotations

**`InvoiceDetailResponse.java`**
- Response DTO for invoice with line items
- Fields: id, venueId, fileName, uploadDate, processingStatus, extractedItemCount, lineItems
- Used by GET endpoint to return full invoice details

**`UpdateInvoiceLineItemRequest.java`**
- Request DTO for updating line items
- Fields: extractedName (required), extractedQuantity (min 0.0001), extractedUnit, extractedPrice (min 0.01)
- Uses Bean Validation annotations

### 3. Exception Classes

**`InvoiceConfirmationException.java`**
- Extends `DomainException`
- Thrown when confirmation fails due to validation issues (e.g., low-confidence fields remaining)
- Includes list of problematic field names
- Maps to HTTP 400 Bad Request

**`InvalidInvoiceStateException.java`**
- Extends `DomainException`
- Thrown when operations are attempted on invoices in invalid states
- Maps to HTTP 409 Conflict

### 4. Service Layer - InvoiceService Enhancements

**Added Methods:**

**`getInvoiceDetail(UUID venueId, UUID invoiceId)`**
- Requirements: 12.7
- Retrieves invoice with line items for review
- Validates invoice belongs to the specified venue
- Throws `ResourceNotFoundException` if not found or venue mismatch

**`updateLineItem(...)`**
- Requirements: 12.8
- Updates individual line item fields before confirmation
- Validates invoice is in REVIEW status
- Automatically marks edited items as high confidence (1.000)
- Throws `InvalidInvoiceStateException` if invoice not in REVIEW status

**`confirmInvoice(UUID venueId, UUID invoiceId)`**
- Requirements: 12.8, 12.9
- Comprehensive confirmation workflow:
  1. Validates invoice is in REVIEW status
  2. Checks all low-confidence fields have been reviewed (Requirement 12.9)
  3. For each line item:
     - Performs case-insensitive name match against existing ingredients
     - Updates matched ingredients' purchase price and quantity
     - Creates new ingredients for unmatched items with default yield (100%)
     - Handles UOM parsing with fallback to GRAM
  4. Updates invoice status to CONFIRMED
  5. Triggers cost propagation for updated ingredients (fire-and-forget)
- Throws `InvoiceConfirmationException` if low-confidence items remain
- Throws `InvalidInvoiceStateException` if not in REVIEW status

**Private Helper Method:**
- `calculateAndSetCostFields(Ingredient ingredient)` - Calculates cost_per_unit and effective_cost_per_usable_unit using shared `CostCalculator`

### 5. Controller Layer - InvoiceController Enhancements

**Added Endpoints:**

**`GET /api/v1/venues/{venueId}/invoices/{invoiceId}`**
- Returns invoice detail with all line items
- Shows OCR results, confidence scores, low-confidence flags
- RBAC: Requires Manager role via `@PreAuthorize("hasVenueRole('MANAGER', #venueId)")`
- Pro/Pro+ tier only

**`PATCH /api/v1/venues/{venueId}/invoices/{invoiceId}/lines/{lineId}`**
- Allows editing/correcting individual line items
- Validates request body using Bean Validation
- Only allowed when invoice is in REVIEW status
- RBAC: Requires Manager role
- Pro/Pro+ tier only

**`POST /api/v1/venues/{venueId}/invoices/{invoiceId}/confirm`**
- Confirms invoice and applies data to ingredients
- Validates all low-confidence fields reviewed
- Performs ingredient matching and updates
- Updates invoice status to CONFIRMED
- RBAC: Requires Manager role
- Pro/Pro+ tier only

**Private Helper Method:**
- `toLineItemResponse(InvoiceLineItem lineItem)` - Converts entity to DTO

### 6. Error Handling

**Updated `GlobalExceptionHandler.java`:**
- Added handling for `InvoiceConfirmationException` → HTTP 400
- Added handling for `InvalidInvoiceStateException` → HTTP 409
- Both exceptions extend `DomainException` and follow existing error response pattern

**Added Error Codes in `ErrorCodes.java`:**
- `INVOICE_NOT_FOUND` = "INVOICE_8009"
- `LINE_ITEM_NOT_FOUND` = "INVOICE_8010"
- `INVOICE_INVALID_STATE` = "INVOICE_8011"
- `INVOICE_CONFIRMATION_FAILED` = "INVOICE_8012"

### 7. Test Updates

**Fixed `InvoiceServiceTest.java`:**
- Updated constructor call to include new dependencies:
  - `InvoiceLineItemRepository`
  - `IngredientRepository`
  - `CostPropagationService`
- All existing tests pass

## Requirements Fulfilled

✅ **Requirement 12.7:** Invoice OCR Processing
- GET endpoint returns extracted data for user review within the API layer
- Line items show confidence scores and flags

✅ **Requirement 12.8:** Invoice Confirmation
- PATCH endpoint allows editing line items
- POST confirm endpoint performs case-insensitive ingredient matching
- Updates existing ingredients or creates new ones
- Applies purchase price and quantity changes

✅ **Requirement 12.9:** Low-Confidence Field Validation
- Confirmation requires all low-confidence fields to be reviewed
- Throws `InvoiceConfirmationException` with field list if validation fails
- Edited fields automatically marked as high confidence

✅ **Requirement 12.10:** Invoice History (already implemented in task 17.1)
- Invoice details accessible via GET endpoint

## API Examples

### Get Invoice Detail
```bash
GET /api/v1/venues/123e4567-e89b-12d3-a456-426614174000/invoices/987fcdeb-51a2-43f1-9d41-5a9e1e3f4b2c
Authorization: Bearer <JWT>
```

Response:
```json
{
  "id": "987fcdeb-51a2-43f1-9d41-5a9e1e3f4b2c",
  "venue_id": "123e4567-e89b-12d3-a456-426614174000",
  "file_name": "supplier_invoice.pdf",
  "upload_date": "2024-01-15T10:30:00Z",
  "processing_status": "REVIEW",
  "extracted_item_count": 5,
  "line_items": [
    {
      "id": "aaa-111",
      "extracted_name": "Tomatoes",
      "extracted_quantity": 10.0,
      "extracted_unit": "kg",
      "extracted_price": 25.50,
      "confidence_score": 0.950,
      "is_low_confidence": false,
      "matched_ingredient_id": null,
      "status": "PENDING"
    },
    {
      "id": "bbb-222",
      "extracted_name": "Onions",
      "extracted_quantity": 5.0,
      "extracted_unit": "kg",
      "extracted_price": 12.75,
      "confidence_score": 0.720,
      "is_low_confidence": true,
      "matched_ingredient_id": null,
      "status": "PENDING"
    }
  ]
}
```

### Update Line Item
```bash
PATCH /api/v1/venues/123e4567-e89b-12d3-a456-426614174000/invoices/987fcdeb-51a2-43f1-9d41-5a9e1e3f4b2c/lines/bbb-222
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "extracted_name": "Red Onions",
  "extracted_quantity": 5.0,
  "extracted_unit": "kg",
  "extracted_price": 12.80
}
```

Response:
```json
{
  "id": "bbb-222",
  "extracted_name": "Red Onions",
  "extracted_quantity": 5.0,
  "extracted_unit": "kg",
  "extracted_price": 12.80,
  "confidence_score": 1.000,
  "is_low_confidence": false,
  "matched_ingredient_id": null,
  "status": "PENDING"
}
```

### Confirm Invoice
```bash
POST /api/v1/venues/123e4567-e89b-12d3-a456-426614174000/invoices/987fcdeb-51a2-43f1-9d41-5a9e1e3f4b2c/confirm
Authorization: Bearer <JWT>
```

Response:
```json
{
  "message": "Invoice confirmed successfully. Ingredients have been updated."
}
```

## Error Handling Examples

### Low-Confidence Fields Remaining
```bash
POST /confirm (with unreviewed low-confidence items)
```

Response (400 Bad Request):
```json
{
  "error_code": "INVOICE_8012",
  "message": "Cannot confirm invoice with low-confidence fields. Please review and correct these items: Onions, Garlic",
  "path": "/api/v1/venues/.../invoices/.../confirm",
  "details": {
    "low_confidence_fields": ["Onions", "Garlic"]
  }
}
```

### Invalid Invoice State
```bash
PATCH /lines/{lineId} (when invoice is CONFIRMED)
```

Response (409 Conflict):
```json
{
  "error_code": "INVOICE_8011",
  "message": "Cannot edit line items for invoice in status CONFIRMED. Invoice must be in REVIEW status.",
  "path": "/api/v1/venues/.../invoices/.../lines/..."
}
```

## Security & RBAC

- All endpoints require authentication via JWT
- `@PreAuthorize("hasVenueRole('MANAGER', #venueId)")` enforces Manager or Admin roles
- Staff users (read-only) cannot access these endpoints
- VenueScopeFilter validates invoice belongs to the authenticated user's venue
- SubscriptionGateFilter ensures Pro/Pro+ tier (implemented elsewhere)

## Cost Propagation Integration

- When confirming an invoice updates existing ingredients, the service calls `costPropagationService.enqueue(venueId, ingredientId)`
- This triggers asynchronous recalculation of all dependent recipes (Requirement 3.3)
- Fire-and-forget pattern: confirmation succeeds even if propagation queueing fails (logged as error)
- Worker processes the propagation job via SQS (implemented in task 6.4)

## Testing

✅ All existing unit tests pass
✅ `InvoiceServiceTest` updated with new mocks
✅ Build succeeds: `./gradlew :modules:api:build`

## Files Created/Modified

**Created:**
- `InvoiceLineItemRepository.java`
- `InvoiceLineItemResponse.java`
- `InvoiceDetailResponse.java`
- `UpdateInvoiceLineItemRequest.java`
- `InvoiceConfirmationException.java`
- `InvalidInvoiceStateException.java`

**Modified:**
- `InvoiceService.java` - Added 3 new methods
- `InvoiceController.java` - Added 3 new endpoints
- `GlobalExceptionHandler.java` - Added 2 exception handlers
- `ErrorCodes.java` - Added 4 error codes
- `InvoiceServiceTest.java` - Fixed constructor calls

## Next Steps

This completes task 17.3. The next task in the spec is:
- **Task 18.1:** Implement AI insights worker for Pro+ tier

The invoice pipeline is now complete with upload (17.1), OCR processing (17.2), and review/confirm (17.3) functionality.
