# Ingredient Controller Implementation

## Overview
Implemented the `IngredientController` REST API endpoints for managing ingredients within venues, following the design specifications and requirements.

## Implemented Components

### 1. DTOs (Data Transfer Objects)
- **CreateIngredientRequest**: Request DTO for creating new ingredients with Bean Validation annotations
  - `@NotBlank` on name
  - `@DecimalMin` on purchasePrice and purchaseQuantity
  - `@Size` constraints on name (1-100 characters)
  
- **UpdateIngredientRequest**: Request DTO for updating existing ingredients (all fields optional)
  - Same validation annotations as create request
  - Only provided fields are updated
  
- **IngredientResponse**: Response DTO containing all ingredient fields including computed values
  - Includes `costPerUnit` and `effectiveCostPerUsableUnit`

### 2. REST Endpoints

#### GET /api/v1/venues/:venueId/ingredients
- Lists all ingredients for a venue
- Supports optional search query parameter `?q=searchTerm`
- **Authorization**: Staff, Manager, or Admin can read (Requirement 9.4)
- **Security**: `@PreAuthorize("hasVenueRole('STAFF', #venueId) or hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")`

#### POST /api/v1/venues/:venueId/ingredients
- Creates a new ingredient
- Validates request body with Bean Validation
- Returns HTTP 201 Created with the created ingredient
- **Authorization**: Only Manager or Admin can create (Requirement 9.3)
- **Security**: `@PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")`

#### GET /api/v1/venues/:venueId/ingredients/:id
- Retrieves a single ingredient by ID
- **Authorization**: Staff, Manager, or Admin can read (Requirement 9.4)
- **Security**: Same as GET list endpoint

#### PATCH /api/v1/venues/:venueId/ingredients/:id
- Updates an existing ingredient
- Accepts partial updates (only provided fields are updated)
- Validates request body with Bean Validation
- **Authorization**: Only Manager or Admin can update (Requirement 9.3)
- **Security**: `@PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")`

#### DELETE /api/v1/venues/:venueId/ingredients/:id
- Deletes an ingredient
- Supports optional `?confirmed=true` query parameter for deletion confirmation
- Throws `DeleteConflictException` if ingredient is in use and not confirmed (Requirement 1.8)
- **Authorization**: Only Manager or Admin can delete (Requirement 9.3)
- **Security**: `@PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")`

### 3. Business Logic Integration
- All endpoints integrate with `IngredientService` for business logic
- Cost calculations are handled automatically by the service layer
- Duplicate name detection (case-insensitive) - Requirement 1.10
- Delete conflict warnings when ingredient is referenced by recipes - Requirement 1.8

### 4. Error Handling
- Bean Validation errors are handled by `GlobalExceptionHandler`
- Returns structured `ErrorResponse` with field-level validation errors
- Domain exceptions (DuplicateResourceException, ResourceNotFoundException, DeleteConflictException) are properly mapped to HTTP status codes

### 5. Testing
- **IngredientControllerTest**: Comprehensive unit tests with mocked service layer
  - Tests all CRUD operations
  - Tests validation errors
  - Tests duplicate name detection
  - Tests delete conflict scenarios
  - All tests pass successfully

## Requirements Coverage

### Functional Requirements
- ✅ **1.1**: Create ingredient with all fields
- ✅ **1.2**: Cost per unit calculation (delegated to service)
- ✅ **1.3**: Update ingredient and recalculate costs
- ✅ **1.6**: Edit and retrieve ingredients
- ✅ **1.7**: Delete ingredients
- ✅ **1.8**: Delete confirmation when ingredient is in use
- ✅ **1.9**: Search ingredients by name

### Authorization Requirements
- ✅ **9.3**: Mutating endpoints (POST, PATCH, DELETE) require Manager role
- ✅ **9.4**: Staff users can only perform GET operations

## Security Implementation Notes

The controller uses `@PreAuthorize` annotations with the `hasVenueRole` custom expression. The actual implementation of `hasVenueRole` will be provided in **task 7.1** (Authentication Infrastructure).

For now:
- The security annotations are correctly applied according to the design spec
- Unit tests bypass security using `@WebMvcTest` which doesn't load full security context
- The controller is ready for the security infrastructure to be plugged in

## Validation

All Bean Validation annotations are in place:
- `@NotBlank` for required string fields
- `@Size(min=1, max=100)` for name field length
- `@DecimalMin` for numeric fields that must be positive
- `@NotNull` for required fields

The GlobalExceptionHandler already handles validation exceptions and returns proper error responses.

## Next Steps

The controller implementation is complete and tested. The security infrastructure (`hasVenueRole` evaluation) will be implemented in task 7.1.
