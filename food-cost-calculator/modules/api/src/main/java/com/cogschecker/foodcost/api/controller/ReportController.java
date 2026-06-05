package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.dto.RecipeResponse;
import com.cogschecker.foodcost.api.service.CsvExportService;
import com.cogschecker.foodcost.api.service.ReportService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

/**
 * REST controller for recipe costing reports.
 * Requirements: 5.1-5.7
 * 
 * Endpoints:
 * - GET /api/v1/venues/:venueId/reports/costing - Get costing report with sorting and filtering
 * - GET /api/v1/venues/:venueId/reports/costing/export - Export report as CSV
 * 
 * RBAC: All roles can view reports, but only Admin/Manager can export (Staff is read-only)
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}/reports")
public class ReportController {
    
    private static final Logger logger = LoggerFactory.getLogger(ReportController.class);
    
    private final ReportService reportService;
    private final CsvExportService csvExportService;
    
    public ReportController(ReportService reportService, CsvExportService csvExportService) {
        this.reportService = reportService;
        this.csvExportService = csvExportService;
    }
    
    /**
     * Get recipe costing report with sorting and filtering.
     * 
     * Requirements:
     * - 5.1: Pre-inclusion validation (non-empty name, non-negative costs)
     * - 5.2: Sort by specified column and direction
     * - 5.3: Default sort by recipe name ASC
     * - 5.4: "Exceeds threshold" filter
     * - 5.5: Return empty list if no matches
     * 
     * RBAC: All roles (read-only)
     * 
     * @param venueId the venue ID
     * @param sortColumn optional sort column (name, foodCostPerPortion, menuSellingPrice, foodCostPercentage)
     * @param sortDir optional sort direction (asc, desc)
     * @param filter optional filter ("exceedsThreshold")
     * @return list of recipe responses
     */
    @GetMapping("/costing")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'STAFF')")
    public ResponseEntity<List<RecipeResponse>> getCostingReport(
            @PathVariable UUID venueId,
            @RequestParam(required = false) String sortColumn,
            @RequestParam(required = false) String sortDir,
            @RequestParam(required = false) String filter) {
        
        logger.info("GET /venues/{}/reports/costing - sortColumn={}, sortDir={}, filter={}", 
                venueId, sortColumn, sortDir, filter);
        
        List<RecipeResponse> report = reportService.getCostingReport(venueId, sortColumn, sortDir, filter);
        
        return ResponseEntity.ok(report);
    }
    
    /**
     * Export recipe costing report as CSV.
     * 
     * Requirements:
     * - 5.6: CSV columns: Recipe Name, Food Cost Per Portion (2 d.p.), Menu Price (2 d.p.), 
     *        Food Cost Percentage (1 d.p.), Portions Per Batch
     * - 5.7: Export only filtered rows
     * 
     * RBAC: Admin or Manager only (Staff cannot export per Requirement 9.4)
     * 
     * @param venueId the venue ID
     * @param sortColumn optional sort column (same as getCostingReport)
     * @param sortDir optional sort direction
     * @param filter optional filter (same as getCostingReport)
     * @return CSV file download
     */
    @GetMapping("/costing/export")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<String> exportCostingReport(
            @PathVariable UUID venueId,
            @RequestParam(required = false) String sortColumn,
            @RequestParam(required = false) String sortDir,
            @RequestParam(required = false) String filter) {
        
        logger.info("GET /venues/{}/reports/costing/export - sortColumn={}, sortDir={}, filter={}", 
                venueId, sortColumn, sortDir, filter);
        
        // Get the same filtered/sorted data as the main report
        // Requirement 5.7: Export only filtered rows
        List<RecipeResponse> report = reportService.getCostingReport(venueId, sortColumn, sortDir, filter);
        
        // Generate CSV
        String csv = csvExportService.export(report);
        
        // Return as downloadable CSV file
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/csv"));
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"recipe-costing-report.csv\"");
        
        logger.info("CSV export completed successfully for venue {}", venueId);
        
        return ResponseEntity.ok()
                .headers(headers)
                .body(csv);
    }
}
