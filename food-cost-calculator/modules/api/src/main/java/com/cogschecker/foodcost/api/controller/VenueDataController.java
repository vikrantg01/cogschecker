package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.dto.VenueExportData;
import com.cogschecker.foodcost.api.service.DataExportService;
import com.cogschecker.foodcost.api.service.DataImportService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

/**
 * REST controller for venue data export and import.
 * Requirements: 7.4, 7.5, 9.4
 * 
 * Endpoints:
 * - GET /api/v1/venues/:venueId/export - Export all venue data as JSON
 * - POST /api/v1/venues/:venueId/import - Import JSON data with schema validation
 * 
 * RBAC: Staff-write-block - Staff role cannot write (POST), only Admin/Manager can
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}")
public class VenueDataController {
    
    private static final Logger logger = LoggerFactory.getLogger(VenueDataController.class);
    
    private final DataExportService dataExportService;
    private final DataImportService dataImportService;
    
    public VenueDataController(DataExportService dataExportService,
                              DataImportService dataImportService) {
        this.dataExportService = dataExportService;
        this.dataImportService = dataImportService;
    }
    
    /**
     * Export all venue data as JSON.
     * 
     * Exports all ingredients, recipes (with ingredient lines), and the target food cost
     * percentage in a versioned envelope format to support future schema evolution.
     * 
     * Requirements: 7.4, 9.4
     * RBAC: Admin or Manager only (Staff cannot export)
     * 
     * GET /api/v1/venues/:venueId/export
     * 
     * @param venueId the venue ID to export
     * @return VenueExportData containing the complete venue state as JSON
     */
    @GetMapping(path = "/export", produces = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<VenueExportData> exportVenueData(@PathVariable UUID venueId) {
        logger.info("GET /venues/{}/export - Exporting venue data", venueId);
        
        VenueExportData exportData = dataExportService.export(venueId);
        
        logger.info("Successfully exported data for venueId: {} - {} ingredients, {} recipes",
                venueId,
                exportData.getVenue().getIngredients().size(),
                exportData.getVenue().getRecipes().size());
        
        return ResponseEntity.ok(exportData);
    }
    
    /**
     * Import venue data from JSON.
     * 
     * Validates the JSON against the expected schema, and if valid, atomically replaces
     * all existing venue data with the imported data. If validation fails, returns HTTP 400
     * with error details and leaves existing data unchanged.
     * 
     * Requirements: 7.5, 7.6, 9.4
     * RBAC: Admin or Manager only (Staff cannot import - Staff-write-block)
     * 
     * POST /api/v1/venues/:venueId/import
     * Content-Type: application/json
     * 
     * Request body: VenueExportData JSON structure
     * 
     * @param venueId the venue ID to import data into
     * @param json the JSON string containing venue export data
     * @return HTTP 200 on success, HTTP 400 on validation failure
     */
    @PostMapping(path = "/import", consumes = MediaType.APPLICATION_JSON_VALUE)
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<?> importVenueData(
            @PathVariable UUID venueId,
            @RequestBody String json) {
        
        logger.info("POST /venues/{}/import - Importing venue data", venueId);
        
        try {
            dataImportService.importData(venueId, json);
            
            logger.info("Successfully imported data for venueId: {}", venueId);
            
            return ResponseEntity.ok()
                    .body(new ImportSuccessResponse("Venue data imported successfully"));
            
        } catch (Exception e) {
            // Error handling is done by GlobalExceptionHandler
            // which will catch InvalidImportSchemaException and return appropriate HTTP 400
            throw e;
        }
    }
    
    /**
     * DTO for import success response.
     */
    public static class ImportSuccessResponse {
        private String message;
        
        public ImportSuccessResponse(String message) {
            this.message = message;
        }
        
        public String getMessage() {
            return message;
        }
        
        public void setMessage(String message) {
            this.message = message;
        }
    }
}
