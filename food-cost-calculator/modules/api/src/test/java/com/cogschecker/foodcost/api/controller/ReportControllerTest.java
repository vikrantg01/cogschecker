package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.config.MethodSecurityConfig;
import com.cogschecker.foodcost.api.config.MethodSecurityConfig;
import com.cogschecker.foodcost.api.config.SecurityConfig;
import com.cogschecker.foodcost.api.dto.RecipeResponse;
import com.cogschecker.foodcost.api.security.RbacAuthorizationManager;
import com.cogschecker.foodcost.api.service.CsvExportService;
import com.cogschecker.foodcost.api.service.ReportService;
import com.cogschecker.foodcost.shared.ThresholdStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Tests for ReportController.
 * Requirements: 5.1-5.7
 */
@WebMvcTest(ReportController.class)
@Import({SecurityConfig.class, MethodSecurityConfig.class})
class ReportControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @MockBean
    private ReportService reportService;
    
    @MockBean
    private CsvExportService csvExportService;
    
    @MockBean
    private JwtDecoder jwtDecoder; // Required by SecurityConfig
    
    @MockBean
    private RbacAuthorizationManager rbacAuthorizationManager; // Required by MethodSecurityConfig
    
    private final UUID venueId = UUID.randomUUID();
    
    @Test
    @WithMockUser(roles = "MANAGER")
    void getCostingReport_ReturnsRecipes() throws Exception {
        // Given
        List<RecipeResponse> mockReport = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("10.00"), new BigDecimal("30.00"), new BigDecimal("33.3"), 2),
            createRecipe("Recipe B", new BigDecimal("15.00"), new BigDecimal("40.00"), new BigDecimal("37.5"), 4)
        );
        
        when(reportService.getCostingReport(eq(venueId), isNull(), isNull(), isNull()))
            .thenReturn(mockReport);
        
        // When & Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing", venueId))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.length()").value(2))
            .andExpect(jsonPath("$[0].name").value("Recipe A"))
            .andExpect(jsonPath("$[1].name").value("Recipe B"));
    }
    
    @Test
    @WithMockUser(roles = "MANAGER")
    void getCostingReport_WithSortAndFilter_PassesParametersToService() throws Exception {
        // Given
        List<RecipeResponse> mockReport = Collections.emptyList();
        
        when(reportService.getCostingReport(eq(venueId), eq("foodCostPerPortion"), eq("desc"), eq("exceedsThreshold")))
            .thenReturn(mockReport);
        
        // When & Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing", venueId)
                .param("sortColumn", "foodCostPerPortion")
                .param("sortDir", "desc")
                .param("filter", "exceedsThreshold"))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON));
    }
    
    @Test
    @WithMockUser(roles = "STAFF")
    void getCostingReport_AsStaff_CanAccessReport() throws Exception {
        // Given - Staff should be able to view reports (Requirement 9.4: read-only access)
        List<RecipeResponse> mockReport = Collections.emptyList();
        when(reportService.getCostingReport(eq(venueId), isNull(), isNull(), isNull()))
            .thenReturn(mockReport);
        
        // When & Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing", venueId))
            .andExpect(status().isOk());
    }
    
    @Test
    @WithMockUser(roles = "MANAGER")
    void exportCostingReport_ReturnsCsvFile() throws Exception {
        // Given - Requirement 5.6, 5.7: CSV export
        List<RecipeResponse> mockReport = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("10.00"), new BigDecimal("30.00"), new BigDecimal("33.3"), 2),
            createRecipe("Recipe B", new BigDecimal("15.00"), new BigDecimal("40.00"), new BigDecimal("37.5"), 4)
        );
        
        String expectedCsv = "Recipe Name,Food Cost Per Portion,Menu Price,Food Cost Percentage,Portions Per Batch\n" +
                            "Recipe A,10.00,30.00,33.3,2\n" +
                            "Recipe B,15.00,40.00,37.5,4\n";
        
        when(reportService.getCostingReport(eq(venueId), isNull(), isNull(), isNull()))
            .thenReturn(mockReport);
        when(csvExportService.export(mockReport))
            .thenReturn(expectedCsv);
        
        // When & Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing/export", venueId))
            .andExpect(status().isOk())
            .andExpect(content().contentType("text/csv"))
            .andExpect(header().string("Content-Disposition", "attachment; filename=\"recipe-costing-report.csv\""))
            .andExpect(content().string(expectedCsv));
    }
    
    @Test
    @WithMockUser(roles = "MANAGER")
    void exportCostingReport_WithFilter_ExportsOnlyFilteredRows() throws Exception {
        // Given - Requirement 5.7: export only filtered rows
        List<RecipeResponse> filteredReport = Collections.singletonList(
            createRecipe("High Cost Recipe", new BigDecimal("20.00"), new BigDecimal("40.00"), new BigDecimal("50.0"), 3)
        );
        
        String expectedCsv = "Recipe Name,Food Cost Per Portion,Menu Price,Food Cost Percentage,Portions Per Batch\n" +
                            "High Cost Recipe,20.00,40.00,50.0,3\n";
        
        when(reportService.getCostingReport(eq(venueId), isNull(), isNull(), eq("exceedsThreshold")))
            .thenReturn(filteredReport);
        when(csvExportService.export(filteredReport))
            .thenReturn(expectedCsv);
        
        // When & Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing/export", venueId)
                .param("filter", "exceedsThreshold"))
            .andExpect(status().isOk())
            .andExpect(content().contentType("text/csv"))
            .andExpect(content().string(expectedCsv));
    }
    
    @Test
    @WithMockUser(roles = "STAFF")
    void exportCostingReport_AsStaff_IsForbidden() throws Exception {
        // Given - Requirement 9.4: Staff cannot export
        // When & Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing/export", venueId))
            .andExpect(status().isForbidden());
    }
    
    @Test
    @WithMockUser(roles = "ADMIN")
    void exportCostingReport_AsAdmin_CanExport() throws Exception {
        // Given - Requirement 9.4: Admin can export
        List<RecipeResponse> mockReport = Collections.emptyList();
        String expectedCsv = "Recipe Name,Food Cost Per Portion,Menu Price,Food Cost Percentage,Portions Per Batch\n";
        
        when(reportService.getCostingReport(eq(venueId), isNull(), isNull(), isNull()))
            .thenReturn(mockReport);
        when(csvExportService.export(mockReport))
            .thenReturn(expectedCsv);
        
        // When & Then
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing/export", venueId))
            .andExpect(status().isOk());
    }
    
    // Note: Authentication tests (401 Unauthorized) are framework-level concerns
    // handled by Spring Security. The @PreAuthorize annotations on controller methods
    // ensure proper RBAC enforcement, which is tested above.
    
    // Helper method to create a RecipeResponse for testing
    private RecipeResponse createRecipe(String name, BigDecimal foodCostPerPortion, 
                                       BigDecimal menuSellingPrice, BigDecimal foodCostPercentage,
                                       Integer portionCount) {
        RecipeResponse recipe = new RecipeResponse();
        recipe.setId(UUID.randomUUID());
        recipe.setVenueId(venueId);
        recipe.setName(name);
        recipe.setFoodCostPerPortion(foodCostPerPortion);
        recipe.setMenuSellingPrice(menuSellingPrice);
        recipe.setFoodCostPercentage(foodCostPercentage);
        recipe.setPortionCount(portionCount);
        recipe.setThresholdStatus(ThresholdStatus.PASSING);
        recipe.setCreatedAt(Instant.now());
        recipe.setUpdatedAt(Instant.now());
        return recipe;
    }
}
