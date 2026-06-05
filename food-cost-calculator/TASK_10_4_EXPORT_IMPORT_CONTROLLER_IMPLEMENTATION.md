# Task 10.4 Implementation Summary: Export/Import Controller Endpoints

## Overview
Implemented REST controller endpoints for venue data export and import with Staff-write-block RBAC enforcement.

## Implementation Details

### Files Created

1. **VenueDataController.java**
   - Location: `modules/api/src/main/java/com/cogschecker/foodcost/api/controller/VenueDataController.java`
   - Endpoints implemented:
     - `GET /api/v1/venues/:venueId/export` - Export all venue data as JSON
     - `POST /api/v1/venues/:venueId/import` - Import JSON data with schema validation
   - RBAC: `@PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")` - Staff cannot access these endpoints

2. **VenueDataControllerTest.java**
   - Location: `modules/api/src/test/java/com/cogschecker/foodcost/api/controller/VenueDataControllerTest.java`
   - Comprehensive unit tests covering:
     - Successful export with complete and empty venue data
     - Successful import with valid JSON
     - Import validation failures (invalid schema, malformed JSON)
     - RBAC tests for Admin, Manager, Staff, and Unauthenticated users

### Key Features

#### Export Endpoint (`GET /venues/:venueId/export`)
- Returns `VenueExportData` as JSON with `Content-Type: application/json`
- Uses `DataExportService.export(venueId)` for data serialization
- Includes all ingredients, recipes (with ingredient lines), and target food cost percentage
- Versioned envelope format (`{"version": 1, "exportedAt": "...", "venue": {...}}`)

#### Import Endpoint (`POST /venues/:venueId/import`)
- Accepts JSON in `VenueExportData` format
- Uses `DataImportService.importData(venueId, json)` for validation and persistence
- Validates JSON schema and rejects malformed or non-conforming data
- Returns HTTP 200 with success message on successful import
- Returns HTTP 400 with error details on validation failure (via GlobalExceptionHandler)
- Atomically replaces all existing venue data within a single transaction

### RBAC Enforcement - Staff-Write-Block

**Requirement 9.4:** Staff users have read-only access and cannot export data.

- **Admin**: Full access to export and import ✅
- **Manager**: Full access to export and import ✅
- **Staff**: BLOCKED (403 Forbidden) ❌
- **Unauthenticated**: BLOCKED (401/403) ❌

Both endpoints use `@PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")` to enforce that only Admin and Manager roles can access these write operations, implementing the Staff-write-block requirement.

### Test Coverage

#### Functional Tests
- Export with complete venue data
- Export with empty venue (no ingredients/recipes)
- Import with valid JSON
- Import rejection for invalid schema
- Import rejection for malformed JSON

#### RBAC Tests
- Admin can export ✅
- Admin can import ✅
- Manager can export ✅
- Manager can import ✅
- Staff cannot export (403 Forbidden) ✅
- Staff cannot import (403 Forbidden) ✅
- Unauthenticated cannot export (401/403) ✅
- Unauthenticated cannot import (401/403) ✅

**All 13 tests pass successfully** ✅

### Requirements Validated

- **Requirement 7.4**: System allows users to export all data as a single JSON file download ✅
- **Requirement 7.5**: System validates imported JSON against expected schema and replaces existing data ✅
- **Requirement 9.4**: Staff role cannot export data (Staff-write-block) ✅
- **Requirement 5.1**: Export enforces that all displayed recipes have non-empty names (handled by service layer)

### Integration with Existing Services

The controller delegates to existing service implementations:
- `DataExportService.export(venueId)` - Already implemented (Task 10.1)
- `DataImportService.importData(venueId, json)` - Already implemented (Task 10.2)

### API Documentation

#### Export Endpoint
```
GET /api/v1/venues/:venueId/export
Authorization: Bearer <JWT>
Requires: ADMIN or MANAGER role

Response: 200 OK
Content-Type: application/json
Body: {
  "version": 1,
  "exportedAt": "2024-01-15T10:30:00Z",
  "venue": {
    "ingredients": [...],
    "recipes": [...],
    "targetFoodCostPercentage": 30.0
  }
}
```

#### Import Endpoint
```
POST /api/v1/venues/:venueId/import
Authorization: Bearer <JWT>
Requires: ADMIN or MANAGER role
Content-Type: application/json
Body: {<VenueExportData>}

Response: 200 OK
Body: {
  "message": "Venue data imported successfully"
}

Error Response: 400 Bad Request
Body: {
  "errorCode": "INVALID_IMPORT_SCHEMA",
  "message": "Missing required field: version",
  "details": {...}
}
```

### Testing Notes

The test suite uses Spring Security test support with `@WithMockUser` to simulate different roles. The `@Import(SecurityConfig.class)` annotation ensures that method-level security (`@PreAuthorize`) is properly enforced in the test environment.

Some tests validate that either 401 Unauthorized OR 403 Forbidden is returned for access denied scenarios, as the exact status code can vary depending on Spring Security configuration and whether the user is authenticated but lacks permissions (403) vs completely unauthenticated (401).

## Completion Status

✅ **Task 10.4 Complete**
- Export endpoint implemented with Staff-write-block RBAC
- Import endpoint implemented with Staff-write-block RBAC
- Comprehensive unit tests passing (13/13)
- Requirements 7.4, 7.5, 9.4 validated
