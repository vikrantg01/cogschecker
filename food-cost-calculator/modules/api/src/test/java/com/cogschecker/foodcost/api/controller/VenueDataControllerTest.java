package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.config.MethodSecurityConfig;
import com.cogschecker.foodcost.api.config.SecurityConfig;
import com.cogschecker.foodcost.api.dto.VenueExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.IngredientExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.RecipeExportData;
import com.cogschecker.foodcost.api.dto.VenueExportData.VenueData;
import com.cogschecker.foodcost.api.exception.InvalidImportSchemaException;
import com.cogschecker.foodcost.api.security.RbacAuthorizationManager;
import com.cogschecker.foodcost.api.service.DataExportService;
import com.cogschecker.foodcost.api.service.DataImportService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
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
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for VenueDataController REST endpoints.
 * Tests Requirements: 7.4, 7.5, 7.6, 9.4
 * 
 * Tests:
 * - GET /venues/:venueId/export - Export venue data (Admin/Manager only)
 * - POST /venues/:venueId/import - Import venue data (Admin/Manager only)
 * - RBAC: Staff-write-block (Staff cannot export or import)
 */
@WebMvcTest(controllers = VenueDataController.class)
@Import({SecurityConfig.class, MethodSecurityConfig.class})
class VenueDataControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @MockBean
    private DataExportService dataExportService;
    
    @MockBean
    private DataImportService dataImportService;
    
    @MockBean
    private JwtDecoder jwtDecoder;
    
    @MockBean
    private RbacAuthorizationManager rbacAuthorizationManager;
    
    private UUID venueId;
    private VenueExportData testExportData;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        
        // Create test export data
        List<IngredientExportData> ingredients = new ArrayList<>();
        IngredientExportData ingredient = new IngredientExportData();
        ingredient.setId(UUID.randomUUID().toString());
        ingredient.setName("Test Ingredient");
        ingredient.setPurchasePrice(new BigDecimal("10.00"));
        ingredient.setPurchaseQuantity(new BigDecimal("5.0000"));
        ingredient.setUnitOfMeasure("KILOGRAM");
        ingredient.setYieldPercentage(new BigDecimal("100.00"));
        ingredient.setCostPerUnit(new BigDecimal("2.0000"));
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("2.0000"));
        ingredient.setCreatedAt(Instant.now().toString());
        ingredient.setUpdatedAt(Instant.now().toString());
        ingredients.add(ingredient);
        
        List<RecipeExportData> recipes = new ArrayList<>();
        RecipeExportData recipe = new RecipeExportData();
        recipe.setId(UUID.randomUUID().toString());
        recipe.setName("Test Recipe");
        recipe.setPortionCount(4);
        recipe.setMenuSellingPrice(new BigDecimal("25.00"));
        recipe.setTotalBatchCost(new BigDecimal("10.00"));
        recipe.setFoodCostPerPortion(new BigDecimal("2.50"));
        recipe.setFoodCostPercentage(new BigDecimal("10.0"));
        recipe.setIngredientLines(new ArrayList<>());
        recipe.setCreatedAt(Instant.now().toString());
        recipe.setUpdatedAt(Instant.now().toString());
        recipes.add(recipe);
        
        VenueData venueData = new VenueData(
            ingredients,
            recipes,
            new BigDecimal("30.0")
        );
        
        testExportData = new VenueExportData(
            1,
            Instant.now().toString(),
            venueData
        );
    }
    
    /**
     * Test GET /venues/:venueId/export - successful export.
     * Requirements: 7.4 - Export all venue data as JSON
     */
    @Test
    @WithMockUser(roles = "MANAGER")
    void testExportVenueData_Success() throws Exception {
        when(dataExportService.export(venueId)).thenReturn(testExportData);
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/export", venueId))
            .andExpect(status().isOk())
            .andExpect(content().contentType(MediaType.APPLICATION_JSON))
            .andExpect(jsonPath("$.version").value(1))
            .andExpect(jsonPath("$.exportedAt").exists())
            .andExpect(jsonPath("$.venue.ingredients").isArray())
            .andExpect(jsonPath("$.venue.recipes").isArray())
            .andExpect(jsonPath("$.venue.targetFoodCostPercentage").value(30.0));
        
        verify(dataExportService, times(1)).export(venueId);
    }
    
    /**
     * Test GET /venues/:venueId/export - empty venue (no ingredients/recipes).
     * Requirements: 7.4 - Export should work even with no data
     */
    @Test
    @WithMockUser(roles = "MANAGER")
    void testExportVenueData_EmptyVenue() throws Exception {
        VenueData emptyVenueData = new VenueData(
            new ArrayList<>(),
            new ArrayList<>(),
            new BigDecimal("30.0")
        );
        VenueExportData emptyExportData = new VenueExportData(
            1,
            Instant.now().toString(),
            emptyVenueData
        );
        
        when(dataExportService.export(venueId)).thenReturn(emptyExportData);
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/export", venueId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.venue.ingredients").isArray())
            .andExpect(jsonPath("$.venue.ingredients").isEmpty())
            .andExpect(jsonPath("$.venue.recipes").isArray())
            .andExpect(jsonPath("$.venue.recipes").isEmpty());
        
        verify(dataExportService, times(1)).export(venueId);
    }
    
    /**
     * Test POST /venues/:venueId/import - successful import.
     * Requirements: 7.5 - Import JSON data with validation
     */
    @Test
    @WithMockUser(roles = "MANAGER")
    void testImportVenueData_Success() throws Exception {
        String importJson = objectMapper.writeValueAsString(testExportData);
        
        doNothing().when(dataImportService).importData(eq(venueId), anyString());
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/import", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(importJson))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.message").value("Venue data imported successfully"));
        
        verify(dataImportService, times(1)).importData(eq(venueId), anyString());
    }
    
    /**
     * Test POST /venues/:venueId/import - invalid schema.
     * Requirements: 7.6 - Reject malformed or non-conforming JSON
     */
    @Test
    @WithMockUser(roles = "MANAGER")
    void testImportVenueData_InvalidSchema() throws Exception {
        String invalidJson = "{\"invalid\": \"data\"}";
        
        doThrow(new InvalidImportSchemaException("Missing required field: version"))
            .when(dataImportService).importData(eq(venueId), anyString());
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/import", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(invalidJson))
            .andExpect(status().isBadRequest());
        
        verify(dataImportService, times(1)).importData(eq(venueId), anyString());
    }
    
    /**
     * Test POST /venues/:venueId/import - malformed JSON.
     * Requirements: 7.6 - Reject malformed JSON
     */
    @Test
    @WithMockUser(roles = "MANAGER")
    void testImportVenueData_MalformedJson() throws Exception {
        String malformedJson = "{not valid json}";
        
        doThrow(new InvalidImportSchemaException(
            "Invalid JSON format: com.fasterxml.jackson.core.JsonParseException",
            Map.of("error", "JsonParseException")
        )).when(dataImportService).importData(eq(venueId), anyString());
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/import", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(malformedJson))
            .andExpect(status().isBadRequest());
        
        verify(dataImportService, times(1)).importData(eq(venueId), anyString());
    }
    
    /**
     * Test RBAC: Admin can export.
     * Requirements: 9.4 - Admin has full access
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testExportVenueData_AdminAccess() throws Exception {
        when(dataExportService.export(venueId)).thenReturn(testExportData);
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/export", venueId))
            .andExpect(status().isOk());
        
        verify(dataExportService, times(1)).export(venueId);
    }
    
    /**
     * Test RBAC: Manager can export.
     * Requirements: 9.3 - Manager has full access to their venue
     */
    @Test
    @WithMockUser(roles = "MANAGER")
    void testExportVenueData_ManagerAccess() throws Exception {
        when(dataExportService.export(venueId)).thenReturn(testExportData);
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/export", venueId))
            .andExpect(status().isOk());
        
        verify(dataExportService, times(1)).export(venueId);
    }
    
    /**
     * Test RBAC: Staff cannot export (Staff-write-block).
     * Requirements: 9.4 - Staff cannot export data
     */
    @Test
    @WithMockUser(roles = "STAFF")
    void testExportVenueData_StaffDenied() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/export", venueId))
            .andExpect(result -> {
                int status = result.getResponse().getStatus();
                if (status != 403 && status != 500) {
                    throw new AssertionError("Expected status 403 or 500 but was: " + status);
                }
            });
        
        verify(dataExportService, never()).export(any());
    }
    
    /**
     * Test RBAC: Admin can import.
     * Requirements: 9.4 - Admin has full access
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testImportVenueData_AdminAccess() throws Exception {
        String importJson = objectMapper.writeValueAsString(testExportData);
        
        doNothing().when(dataImportService).importData(eq(venueId), anyString());
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/import", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(importJson))
            .andExpect(status().isOk());
        
        verify(dataImportService, times(1)).importData(eq(venueId), anyString());
    }
    
    /**
     * Test RBAC: Manager can import.
     * Requirements: 9.3 - Manager has full access to their venue
     */
    @Test
    @WithMockUser(roles = "MANAGER")
    void testImportVenueData_ManagerAccess() throws Exception {
        String importJson = objectMapper.writeValueAsString(testExportData);
        
        doNothing().when(dataImportService).importData(eq(venueId), anyString());
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/import", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(importJson))
            .andExpect(status().isOk());
        
        verify(dataImportService, times(1)).importData(eq(venueId), anyString());
    }
    
    /**
     * Test RBAC: Staff cannot import (Staff-write-block).
     * Requirements: 9.4 - Staff cannot create, edit, delete, or export any data
     */
    @Test
    @WithMockUser(roles = "STAFF")
    void testImportVenueData_StaffDenied() throws Exception {
        String importJson = objectMapper.writeValueAsString(testExportData);
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/import", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(importJson))
            .andExpect(result -> {
                int status = result.getResponse().getStatus();
                if (status != 403 && status != 500) {
                    throw new AssertionError("Expected status 403 or 500 but was: " + status);
                }
            });
        
        verify(dataImportService, never()).importData(any(), any());
    }
    
    /**
     * Test RBAC: Unauthenticated user cannot export.
     */
    @Test
    void testExportVenueData_Unauthenticated() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/export", venueId))
            .andExpect(result -> {
                int status = result.getResponse().getStatus();
                // Accept either 401 or 403 as both indicate access is denied
                if (status != 401 && status != 403) {
                    throw new AssertionError("Expected status 401 or 403 but was: " + status);
                }
            });
        
        verify(dataExportService, never()).export(any());
    }
    
    /**
     * Test RBAC: Unauthenticated user cannot import.
     */
    @Test
    void testImportVenueData_Unauthenticated() throws Exception {
        String importJson = objectMapper.writeValueAsString(testExportData);
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/import", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(importJson))
            .andExpect(result -> {
                int status = result.getResponse().getStatus();
                // Accept either 401 or 403 as both indicate access is denied
                if (status != 401 && status != 403) {
                    throw new AssertionError("Expected status 401 or 403 but was: " + status);
                }
            });
        
        verify(dataImportService, never()).importData(any(), any());
    }
}
