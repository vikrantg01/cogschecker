# Task 9.4: CSV Export Implementation Summary

## Overview
Implemented CSV export functionality for the recipe costing report with correct rounding as per Requirements 5.6 and 5.7.

## Implementation Details

### Files Created

1. **CsvExportService.java** (`modules/api/src/main/java/com/cogschecker/foodcost/api/service/CsvExportService.java`)
   - Core service that generates CSV content from a list of `RecipeResponse` objects
   - Implements correct rounding:
     - Food Cost Per Portion: 2 decimal places (HALF_UP rounding)
     - Menu Price: 2 decimal places (HALF_UP rounding)
     - Food Cost Percentage: 1 decimal place (HALF_UP rounding)
     - Portions Per Batch: Integer (no decimal places)
   - Handles CSV escaping:
     - Wraps fields in quotes if they contain commas, newlines, or quotes
     - Doubles internal quotes per CSV RFC 4180
   - Handles null values appropriately:
     - Displays "N/A" for Food Cost Percentage when menu price is null
     - Displays empty string for null numeric fields

2. **ReportController.java** (`modules/api/src/main/java/com/cogschecker/foodcost/api/controller/ReportController.java`)
   - REST controller for recipe costing reports
   - Endpoints:
     - `GET /api/v1/venues/:venueId/reports/costing` - Get costing report with sorting and filtering
     - `GET /api/v1/venues/:venueId/reports/costing/export` - Export report as CSV
   - RBAC implementation:
     - All roles (Admin, Manager, Staff) can view reports (read-only)
     - Only Admin and Manager can export CSV (Staff cannot per Requirement 9.4)
   - Export functionality:
     - Accepts same sorting and filtering parameters as the main report endpoint
     - Calls `ReportService.getCostingReport()` with the same parameters (Requirement 5.7)
     - Generates CSV using `CsvExportService.export()`
     - Returns CSV file with proper Content-Type and Content-Disposition headers

3. **CsvExportServiceTest.java** (`modules/api/src/test/java/com/cogschecker/foodcost/api/service/CsvExportServiceTest.java`)
   - Comprehensive unit tests for CSV export functionality
   - Tests cover:
     - Empty list returns header only
     - Single and multiple recipe exports
     - Correct rounding for all numeric fields (2 d.p. and 1 d.p.)
     - Rounding edge cases (HALF_UP behavior)
     - Null value handling
     - CSV escaping (commas, quotes, newlines)
     - Filtered export (verifies only provided recipes are exported)
     - Header row validation
     - Large decimal values
     - Zero values
   - All 13 tests pass ✅

4. **ReportControllerTest.java** (`modules/api/src/test/java/com/cogschecker/foodcost/api/controller/ReportControllerTest.java`)
   - Integration tests for the ReportController endpoints
   - Tests cover:
     - GET report endpoint returns recipes
     - Sort and filter parameters are passed to service
     - Staff can access reports (read-only)
     - CSV export returns correct content type and headers
     - Filtered export exports only filtered rows (Requirement 5.7)
     - Staff is forbidden from exporting (Requirement 9.4)
     - Admin can export
     - Authentication is required for both endpoints

## Requirements Satisfied

### Requirement 5.6: CSV Export Format
✅ Implemented CSV export with the following columns:
- Recipe Name
- Food Cost Per Portion (2 decimal places)
- Menu Price (2 decimal places)
- Food Cost Percentage (1 decimal place)
- Portions Per Batch

✅ Numeric values are correctly rounded:
- Food Cost Per Portion and Menu Price: 2 d.p. using HALF_UP rounding
- Food Cost Percentage: 1 d.p. using HALF_UP rounding

### Requirement 5.7: Filtered Export
✅ When the report is filtered, the export only includes the filtered rows
- The `exportCostingReport` endpoint accepts the same filter parameters as `getCostingReport`
- Calls `reportService.getCostingReport()` with the same parameters to get the filtered list
- Passes the filtered list directly to `csvExportService.export()`

### Requirement 9.4: RBAC for Export
✅ Only Admin and Manager roles can export data
- Export endpoint has `@PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")`
- Staff role cannot export (returns 403 Forbidden)
- All roles can view the report (read-only)

## Testing Results

### Unit Tests (CsvExportServiceTest)
```
✅ export_EmptyList_ReturnsHeaderOnly
✅ export_SingleRecipe_ProducesCorrectlyCsvWithCorrectRounding
✅ export_MultipleRecipes_ProducesMultipleRows
✅ export_RecipeWithNullMenuPrice_DisplaysEmptyFieldForPrice
✅ export_RecipeWithNullFoodCostPerPortion_DisplaysEmptyField
✅ export_RecipeNameWithComma_EscapesFieldInQuotes
✅ export_RecipeNameWithQuotes_EscapesQuotesCorrectly
✅ export_RecipeNameWithNewline_EscapesFieldInQuotes
✅ export_RoundingEdgeCases_RoundsCorrectly
✅ export_FilteredRecipes_ExportsOnlyProvidedRecipes
✅ export_HeaderRow_HasCorrectColumnNames
✅ export_LargeDecimalValues_RoundsAndFormatsCorrectly
✅ export_ZeroValues_DisplaysCorrectly
```

All 13 tests pass successfully.

## Example CSV Output

### Input (RecipeResponse objects):
```
Recipe A: foodCost=5.678, menuPrice=15.999, percentage=35.65, portions=4
Recipe B: foodCost=8.5, menuPrice=25.0, percentage=34.0, portions=3
```

### Output (CSV):
```csv
Recipe Name,Food Cost Per Portion,Menu Price,Food Cost Percentage,Portions Per Batch
Recipe A,5.68,16.00,35.7,4
Recipe B,8.50,25.00,34.0,3
```

Note the correct rounding:
- 5.678 → 5.68 (2 d.p., HALF_UP)
- 15.999 → 16.00 (2 d.p., HALF_UP)
- 35.65 → 35.7 (1 d.p., HALF_UP)

## API Documentation

### GET /api/v1/venues/:venueId/reports/costing
Returns recipe costing report as JSON with sorting and filtering.

**Query Parameters:**
- `sortColumn` (optional): name, foodCostPerPortion, menuSellingPrice, foodCostPercentage
- `sortDir` (optional): asc, desc
- `filter` (optional): exceedsThreshold

**Authorization:** Admin, Manager, Staff (read-only)

**Response:** `200 OK` with JSON array of recipes

### GET /api/v1/venues/:venueId/reports/costing/export
Exports recipe costing report as CSV file.

**Query Parameters:**
- Same as GET /costing endpoint
- Parameters are passed through to filter and sort the export

**Authorization:** Admin, Manager only (Staff forbidden)

**Response:** `200 OK` with CSV file
- Content-Type: `text/csv`
- Content-Disposition: `attachment; filename="recipe-costing-report.csv"`

## Integration with Existing Code

The implementation integrates seamlessly with the existing codebase:

1. **ReportService**: The new controller uses the existing `ReportService.getCostingReport()` method to get filtered and sorted recipe data. No changes to `ReportService` were required.

2. **RecipeResponse DTO**: The CSV export uses the existing `RecipeResponse` DTO, ensuring consistency with the JSON API responses.

3. **Spring Security**: The controller uses the existing security annotations (`@PreAuthorize`) consistent with other controllers.

4. **Rounding**: Uses Java's `BigDecimal.setScale()` with `RoundingMode.HALF_UP`, consistent with the rounding behavior in `CostCalculator` and other financial calculation classes.

## Next Steps

The implementation is complete and tested. The code:
- ✅ Compiles successfully
- ✅ All unit tests pass (13/13 for CsvExportService)
- ✅ Implements all requirements (5.6, 5.7, 9.4)
- ✅ Follows existing code patterns and conventions
- ✅ Has comprehensive test coverage

The endpoints are ready for integration testing and deployment.
