package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.config.TestSecurityConfig;
import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.dto.CreateIngredientRequest;
import com.cogschecker.foodcost.api.dto.UpdateIngredientRequest;
import com.cogschecker.foodcost.api.exception.DeleteConflictException;
import com.cogschecker.foodcost.api.exception.DuplicateResourceException;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.service.IngredientService;
import com.cogschecker.foodcost.shared.ErrorCodes;
import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for IngredientController REST endpoints.
 * Tests Requirements: 1.1, 1.6, 1.7, 1.8, 1.9, 9.3, 9.4
 */
@WebMvcTest(IngredientController.class)
@Import(TestSecurityConfig.class)
class IngredientControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @MockBean
    private IngredientService ingredientService;
    
    private UUID venueId;
    private UUID ingredientId;
    private Ingredient testIngredient;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        ingredientId = UUID.randomUUID();
        
        testIngredient = new Ingredient();
        testIngredient.setId(ingredientId);
        testIngredient.setVenueId(venueId);
        testIngredient.setName("Flour");
        testIngredient.setPurchasePrice(new BigDecimal("10.00"));
        testIngredient.setPurchaseQuantity(new BigDecimal("5.0000"));
        testIngredient.setUnitOfMeasure(UomEnum.KILOGRAM);
        testIngredient.setYieldPercentage(new BigDecimal("100.00"));
        testIngredient.setCostPerUnit(new BigDecimal("2.0000"));
        testIngredient.setEffectiveCostPerUsableUnit(new BigDecimal("2.0000"));
        testIngredient.setCreatedAt(Instant.now());
        testIngredient.setUpdatedAt(Instant.now());
    }
    
    /**
     * Test GET /venues/:venueId/ingredients - list all ingredients.
     * Requirement: 9.4 - Staff can GET
     */
    @Test
    @WithMockUser
    void testGetAllIngredients() throws Exception {
        List<Ingredient> ingredients = Arrays.asList(testIngredient);
        when(ingredientService.getAllIngredients(venueId)).thenReturn(ingredients);
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$[0].id").value(ingredientId.toString()))
            .andExpect(jsonPath("$[0].name").value("Flour"))
            .andExpect(jsonPath("$[0].purchasePrice").value(10.00))
            .andExpect(jsonPath("$[0].unitOfMeasure").value("KILOGRAM"));
        
        verify(ingredientService, times(1)).getAllIngredients(venueId);
    }
    
    /**
     * Test GET /venues/:venueId/ingredients?q=search - search ingredients.
     * Requirement: 1.9 - Search by name
     */
    @Test
    @WithMockUser
    void testSearchIngredients() throws Exception {
        List<Ingredient> ingredients = Arrays.asList(testIngredient);
        when(ingredientService.searchIngredients(venueId, "Flour")).thenReturn(ingredients);
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueId)
                .param("q", "Flour"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray())
            .andExpect(jsonPath("$[0].name").value("Flour"));
        
        verify(ingredientService, times(1)).searchIngredients(venueId, "Flour");
    }
    
    /**
     * Test GET /venues/:venueId/ingredients/:id - get single ingredient.
     * Requirement: 1.6, 9.4 - Staff can GET
     */
    @Test
    @WithMockUser
    void testGetIngredient() throws Exception {
        when(ingredientService.getIngredient(venueId, ingredientId)).thenReturn(testIngredient);
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients/{id}", venueId, ingredientId))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.id").value(ingredientId.toString()))
            .andExpect(jsonPath("$.name").value("Flour"))
            .andExpect(jsonPath("$.costPerUnit").value(2.0000))
            .andExpect(jsonPath("$.effectiveCostPerUsableUnit").value(2.0000));
        
        verify(ingredientService, times(1)).getIngredient(venueId, ingredientId);
    }
    
    /**
     * Test GET /venues/:venueId/ingredients/:id - not found.
     */
    @Test
    @WithMockUser
    void testGetIngredientNotFound() throws Exception {
        when(ingredientService.getIngredient(venueId, ingredientId))
            .thenThrow(new ResourceNotFoundException(ErrorCodes.INGREDIENT_NOT_FOUND, "Ingredient not found"));
        
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients/{id}", venueId, ingredientId))
            .andExpect(status().isNotFound())
            .andExpect(jsonPath("$.errorCode").value(ErrorCodes.INGREDIENT_NOT_FOUND));
        
        verify(ingredientService, times(1)).getIngredient(venueId, ingredientId);
    }
    
    /**
     * Test POST /venues/:venueId/ingredients - create ingredient.
     * Requirements: 1.1, 1.2, 9.3 - MANAGER can create
     */
    @Test
    @WithMockUser
    void testCreateIngredient() throws Exception {
        CreateIngredientRequest request = new CreateIngredientRequest(
            "Flour",
            new BigDecimal("10.00"),
            new BigDecimal("5.0000"),
            UomEnum.KILOGRAM,
            new BigDecimal("100.00")
        );
        
        when(ingredientService.createIngredient(
            eq(venueId),
            eq("Flour"),
            any(BigDecimal.class),
            any(BigDecimal.class),
            eq(UomEnum.KILOGRAM),
            any(BigDecimal.class)
        )).thenReturn(testIngredient);
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.id").value(ingredientId.toString()))
            .andExpect(jsonPath("$.name").value("Flour"));
        
        verify(ingredientService, times(1)).createIngredient(
            eq(venueId),
            eq("Flour"),
            any(BigDecimal.class),
            any(BigDecimal.class),
            eq(UomEnum.KILOGRAM),
            any(BigDecimal.class)
        );
    }
    
    /**
     * Test POST /venues/:venueId/ingredients - validation errors.
     */
    @Test
    @WithMockUser
    void testCreateIngredientValidationErrors() throws Exception {
        CreateIngredientRequest request = new CreateIngredientRequest(
            "", // blank name
            new BigDecimal("-1.00"), // negative price
            new BigDecimal("5.0000"),
            UomEnum.KILOGRAM,
            new BigDecimal("100.00")
        );
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.errorCode").value(ErrorCodes.VALIDATION_CONSTRAINT_VIOLATION));
        
        verify(ingredientService, never()).createIngredient(any(), any(), any(), any(), any(), any());
    }
    
    /**
     * Test POST /venues/:venueId/ingredients - duplicate name.
     * Requirement: 1.10 - Duplicate name detection
     */
    @Test
    @WithMockUser
    void testCreateIngredientDuplicateName() throws Exception {
        CreateIngredientRequest request = new CreateIngredientRequest(
            "Flour",
            new BigDecimal("10.00"),
            new BigDecimal("5.0000"),
            UomEnum.KILOGRAM,
            new BigDecimal("100.00")
        );
        
        when(ingredientService.createIngredient(any(), any(), any(), any(), any(), any()))
            .thenThrow(new DuplicateResourceException(ErrorCodes.INGREDIENT_DUPLICATE_NAME, "Duplicate name"));
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.errorCode").value(ErrorCodes.INGREDIENT_DUPLICATE_NAME));
    }
    
    /**
     * Test PATCH /venues/:venueId/ingredients/:id - update ingredient.
     * Requirements: 1.3, 1.6, 9.3 - MANAGER can update
     */
    @Test
    @WithMockUser
    void testUpdateIngredient() throws Exception {
        UpdateIngredientRequest request = new UpdateIngredientRequest(
            "White Flour",
            new BigDecimal("12.00"),
            null,
            null,
            null
        );
        
        testIngredient.setName("White Flour");
        testIngredient.setPurchasePrice(new BigDecimal("12.00"));
        
        when(ingredientService.updateIngredient(
            eq(venueId),
            eq(ingredientId),
            eq("White Flour"),
            any(BigDecimal.class),
            isNull(),
            isNull(),
            isNull()
        )).thenReturn(testIngredient);
        
        mockMvc.perform(patch("/api/v1/venues/{venueId}/ingredients/{id}", venueId, ingredientId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.name").value("White Flour"))
            .andExpect(jsonPath("$.purchasePrice").value(12.00));
        
        verify(ingredientService, times(1)).updateIngredient(
            eq(venueId),
            eq(ingredientId),
            eq("White Flour"),
            any(BigDecimal.class),
            isNull(),
            isNull(),
            isNull()
        );
    }
    
    /**
     * Test DELETE /venues/:venueId/ingredients/:id - delete ingredient.
     * Requirements: 1.7, 9.3 - MANAGER can delete
     */
    @Test
    @WithMockUser
    void testDeleteIngredient() throws Exception {
        doNothing().when(ingredientService).deleteIngredient(venueId, ingredientId, false);
        
        mockMvc.perform(delete("/api/v1/venues/{venueId}/ingredients/{id}", venueId, ingredientId)
                .with(csrf()))
            .andExpect(status().isNoContent());
        
        verify(ingredientService, times(1)).deleteIngredient(venueId, ingredientId, false);
    }
    
    /**
     * Test DELETE /venues/:venueId/ingredients/:id - delete with confirmation.
     * Requirement: 1.8 - Delete with confirmation when in use
     */
    @Test
    @WithMockUser
    void testDeleteIngredientWithConfirmation() throws Exception {
        doNothing().when(ingredientService).deleteIngredient(venueId, ingredientId, true);
        
        mockMvc.perform(delete("/api/v1/venues/{venueId}/ingredients/{id}", venueId, ingredientId)
                .with(csrf())
                .param("confirmed", "true"))
            .andExpect(status().isNoContent());
        
        verify(ingredientService, times(1)).deleteIngredient(venueId, ingredientId, true);
    }
    
    /**
     * Test DELETE /venues/:venueId/ingredients/:id - delete conflict.
     * Requirement: 1.8 - Warning when ingredient is in use
     */
    @Test
    @WithMockUser
    void testDeleteIngredientConflict() throws Exception {
        List<String> affectedRecipes = Arrays.asList("Pancakes", "Bread");
        doThrow(new DeleteConflictException(
            ErrorCodes.INGREDIENT_IN_USE,
            "Ingredient is in use",
            affectedRecipes
        )).when(ingredientService).deleteIngredient(venueId, ingredientId, false);
        
        mockMvc.perform(delete("/api/v1/venues/{venueId}/ingredients/{id}", venueId, ingredientId)
                .with(csrf()))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.errorCode").value(ErrorCodes.INGREDIENT_IN_USE))
            .andExpect(jsonPath("$.details.affected_resources").isArray())
            .andExpect(jsonPath("$.details.affected_resources[0]").value("Pancakes"));
        
        verify(ingredientService, times(1)).deleteIngredient(venueId, ingredientId, false);
    }
}
