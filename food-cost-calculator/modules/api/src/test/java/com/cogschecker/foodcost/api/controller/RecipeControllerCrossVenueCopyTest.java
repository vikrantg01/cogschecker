package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.dto.CopyRecipeRequest;
import com.cogschecker.foodcost.api.dto.IngredientMapping;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.service.IngredientService;
import com.cogschecker.foodcost.api.service.RecipeIngredientLineService;
import com.cogschecker.foodcost.api.service.RecipeService;
import com.cogschecker.foodcost.api.service.SystemConfigService;
import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for cross-venue recipe copy functionality.
 * Tests Requirements: 10.6, 10.7
 * 
 * Note: RBAC tests (Admin-only access) are covered in integration tests.
 * These unit tests focus on the cross-venue copy logic and missing ingredient resolution.
 */
@WebMvcTest(RecipeController.class)
class RecipeControllerCrossVenueCopyTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @MockBean
    private RecipeService recipeService;
    
    @MockBean
    private RecipeIngredientLineService lineService;
    
    @MockBean
    private IngredientService ingredientService;
    
    @MockBean
    private IngredientRepository ingredientRepository;
    
    @MockBean
    private RecipeRepository recipeRepository;
    
    @MockBean
    private SystemConfigService systemConfigService;
    
    private UUID sourceVenueId;
    private UUID destVenueId;
    private UUID sourceRecipeId;
    private Recipe sourceRecipe;
    private Ingredient sourceFlour;
    private Ingredient sourceSugar;
    private Ingredient destFlour;
    private RecipeIngredientLine flourLine;
    private RecipeIngredientLine sugarLine;
    
    @BeforeEach
    void setUp() {
        sourceVenueId = UUID.randomUUID();
        destVenueId = UUID.randomUUID();
        sourceRecipeId = UUID.randomUUID();
        
        // Source recipe
        sourceRecipe = new Recipe();
        sourceRecipe.setId(sourceRecipeId);
        sourceRecipe.setVenueId(sourceVenueId);
        sourceRecipe.setName("Chocolate Cake");
        sourceRecipe.setPortionCount(8);
        sourceRecipe.setMenuSellingPrice(new BigDecimal("25.00"));
        sourceRecipe.setCreatedAt(Instant.now());
        sourceRecipe.setUpdatedAt(Instant.now());
        
        // Source ingredients
        sourceFlour = new Ingredient();
        sourceFlour.setId(UUID.randomUUID());
        sourceFlour.setVenueId(sourceVenueId);
        sourceFlour.setName("Flour");
        sourceFlour.setPurchasePrice(new BigDecimal("10.00"));
        sourceFlour.setPurchaseQuantity(new BigDecimal("5.0000"));
        sourceFlour.setUnitOfMeasure(UomEnum.KILOGRAM);
        sourceFlour.setYieldPercentage(new BigDecimal("100.00"));
        
        sourceSugar = new Ingredient();
        sourceSugar.setId(UUID.randomUUID());
        sourceSugar.setVenueId(sourceVenueId);
        sourceSugar.setName("Sugar");
        sourceSugar.setPurchasePrice(new BigDecimal("5.00"));
        sourceSugar.setPurchaseQuantity(new BigDecimal("2.0000"));
        sourceSugar.setUnitOfMeasure(UomEnum.KILOGRAM);
        sourceSugar.setYieldPercentage(new BigDecimal("100.00"));
        
        // Destination ingredient (only flour exists)
        destFlour = new Ingredient();
        destFlour.setId(UUID.randomUUID());
        destFlour.setVenueId(destVenueId);
        destFlour.setName("Flour");
        destFlour.setPurchasePrice(new BigDecimal("12.00"));
        destFlour.setPurchaseQuantity(new BigDecimal("5.0000"));
        destFlour.setUnitOfMeasure(UomEnum.KILOGRAM);
        destFlour.setYieldPercentage(new BigDecimal("100.00"));
        
        // Recipe ingredient lines
        flourLine = new RecipeIngredientLine();
        flourLine.setId(UUID.randomUUID());
        flourLine.setRecipeId(sourceRecipeId);
        flourLine.setIngredientId(sourceFlour.getId());
        flourLine.setQuantityUsed(new BigDecimal("0.5000"));
        flourLine.setUnitOfMeasure(UomEnum.KILOGRAM);
        
        sugarLine = new RecipeIngredientLine();
        sugarLine.setId(UUID.randomUUID());
        sugarLine.setRecipeId(sourceRecipeId);
        sugarLine.setIngredientId(sourceSugar.getId());
        sugarLine.setQuantityUsed(new BigDecimal("0.3000"));
        sugarLine.setUnitOfMeasure(UomEnum.KILOGRAM);
        
        // Mock SystemConfig for threshold evaluation
        com.cogschecker.foodcost.api.domain.SystemConfig mockConfig = 
            new com.cogschecker.foodcost.api.domain.SystemConfig();
        mockConfig.setVenueId(destVenueId);
        mockConfig.setTargetFoodCostPercentage(new BigDecimal("30.0"));
        when(systemConfigService.getConfig(any(UUID.class))).thenReturn(mockConfig);
    }
    
    /**
     * Test successful cross-venue copy when all ingredients exist in destination.
     * Requirement: 10.6 - Copy recipe with all ingredient lines
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testCopyRecipe_AllIngredientsExist_Success() throws Exception {
        // Mock source recipe
        when(recipeService.getRecipe(sourceVenueId, sourceRecipeId)).thenReturn(sourceRecipe);
        when(lineService.getIngredientLines(sourceRecipeId))
            .thenReturn(Arrays.asList(flourLine, sugarLine));
        
        // Mock ingredient lookups
        when(ingredientService.getIngredient(sourceVenueId, sourceFlour.getId())).thenReturn(sourceFlour);
        when(ingredientService.getIngredient(sourceVenueId, sourceSugar.getId())).thenReturn(sourceSugar);
        
        // Both ingredients exist in destination (auto-mapped by name)
        when(ingredientRepository.findByVenueIdAndNameIgnoreCase(destVenueId, "Flour"))
            .thenReturn(Optional.of(destFlour));
        Ingredient destSugar = new Ingredient();
        destSugar.setId(UUID.randomUUID());
        destSugar.setName("Sugar");
        when(ingredientRepository.findByVenueIdAndNameIgnoreCase(destVenueId, "Sugar"))
            .thenReturn(Optional.of(destSugar));
        
        // Mock recipe creation
        Recipe copiedRecipe = new Recipe();
        copiedRecipe.setId(UUID.randomUUID());
        copiedRecipe.setVenueId(destVenueId);
        copiedRecipe.setName("Chocolate Cake");
        copiedRecipe.setPortionCount(8);
        when(recipeService.createRecipe(eq(destVenueId), eq("Chocolate Cake"), eq(8), anyList(), eq(false)))
            .thenReturn(copiedRecipe);
        
        // Mock recipe repository save
        when(recipeRepository.save(any(Recipe.class))).thenReturn(copiedRecipe);
        
        CopyRecipeRequest request = new CopyRecipeRequest();
        request.setSourceVenueId(sourceVenueId);
        request.setRecipeId(sourceRecipeId);
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/recipes/copy", destVenueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("Chocolate Cake"))
            .andExpect(jsonPath("$.venueId").value(destVenueId.toString()));
        
        verify(lineService, times(2)).saveIngredientLine(any(RecipeIngredientLine.class));
    }
    
    /**
     * Test cross-venue copy returns 409 when ingredients are missing.
     * Requirement: 10.7 - Return list of missing ingredients
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testCopyRecipe_MissingIngredients_Returns409() throws Exception {
        // Mock source recipe
        when(recipeService.getRecipe(sourceVenueId, sourceRecipeId)).thenReturn(sourceRecipe);
        when(lineService.getIngredientLines(sourceRecipeId))
            .thenReturn(Arrays.asList(flourLine, sugarLine));
        
        // Mock ingredient lookups
        when(ingredientService.getIngredient(sourceVenueId, sourceFlour.getId())).thenReturn(sourceFlour);
        when(ingredientService.getIngredient(sourceVenueId, sourceSugar.getId())).thenReturn(sourceSugar);
        
        // Only flour exists in destination, sugar is missing
        when(ingredientRepository.findByVenueIdAndNameIgnoreCase(destVenueId, "Flour"))
            .thenReturn(Optional.of(destFlour));
        when(ingredientRepository.findByVenueIdAndNameIgnoreCase(destVenueId, "Sugar"))
            .thenReturn(Optional.empty());
        
        CopyRecipeRequest request = new CopyRecipeRequest();
        request.setSourceVenueId(sourceVenueId);
        request.setRecipeId(sourceRecipeId);
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/recipes/copy", destVenueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").exists())
            .andExpect(jsonPath("$.missingIngredients").isArray())
            .andExpect(jsonPath("$.missingIngredients[0].sourceIngredientId").value(sourceSugar.getId().toString()))
            .andExpect(jsonPath("$.missingIngredients[0].ingredientName").value("Sugar"))
            .andExpect(jsonPath("$.missingIngredients[0].unitOfMeasure").value("kg"));
        
        // Should not create recipe or lines
        verify(recipeService, never()).createRecipe(any(), any(), anyInt(), anyList(), anyBoolean());
        verify(lineService, never()).saveIngredientLine(any());
    }
    
    /**
     * Test cross-venue copy with ingredient mappings to existing ingredients.
     * Requirement: 10.7 - Accept ingredient mappings on re-submission
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testCopyRecipe_WithIngredientMappings_Success() throws Exception {
        // Mock source recipe
        when(recipeService.getRecipe(sourceVenueId, sourceRecipeId)).thenReturn(sourceRecipe);
        when(lineService.getIngredientLines(sourceRecipeId))
            .thenReturn(Arrays.asList(flourLine, sugarLine));
        
        // Mock ingredient lookups
        when(ingredientService.getIngredient(sourceVenueId, sourceFlour.getId())).thenReturn(sourceFlour);
        when(ingredientService.getIngredient(sourceVenueId, sourceSugar.getId())).thenReturn(sourceSugar);
        
        // Only flour exists by name
        when(ingredientRepository.findByVenueIdAndNameIgnoreCase(destVenueId, "Flour"))
            .thenReturn(Optional.of(destFlour));
        when(ingredientRepository.findByVenueIdAndNameIgnoreCase(destVenueId, "Sugar"))
            .thenReturn(Optional.empty());
        
        // Mock recipe creation
        Recipe copiedRecipe = new Recipe();
        copiedRecipe.setId(UUID.randomUUID());
        copiedRecipe.setVenueId(destVenueId);
        copiedRecipe.setName("Chocolate Cake");
        copiedRecipe.setPortionCount(8);
        when(recipeService.createRecipe(eq(destVenueId), eq("Chocolate Cake"), eq(8), anyList(), eq(false)))
            .thenReturn(copiedRecipe);
        
        // Mock recipe repository save
        when(recipeRepository.save(any(Recipe.class))).thenReturn(copiedRecipe);
        
        // Create request with ingredient mapping (sugar mapped to existing destSugar)
        UUID destSugarId = UUID.randomUUID();
        IngredientMapping sugarMapping = new IngredientMapping();
        sugarMapping.setSourceIngredientId(sourceSugar.getId());
        sugarMapping.setDestinationIngredientId(destSugarId);
        
        CopyRecipeRequest request = new CopyRecipeRequest();
        request.setSourceVenueId(sourceVenueId);
        request.setRecipeId(sourceRecipeId);
        request.setIngredientMappings(Arrays.asList(sugarMapping));
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/recipes/copy", destVenueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("Chocolate Cake"));
        
        verify(lineService, times(2)).saveIngredientLine(any(RecipeIngredientLine.class));
    }
    
    /**
     * Test cross-venue copy with createNew flag to create new ingredients.
     * Requirement: 10.7 - Accept create-new flags
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testCopyRecipe_WithCreateNewFlag_Success() throws Exception {
        // Mock source recipe
        when(recipeService.getRecipe(sourceVenueId, sourceRecipeId)).thenReturn(sourceRecipe);
        when(lineService.getIngredientLines(sourceRecipeId))
            .thenReturn(Arrays.asList(flourLine, sugarLine));
        
        // Mock ingredient lookups
        when(ingredientService.getIngredient(sourceVenueId, sourceFlour.getId())).thenReturn(sourceFlour);
        when(ingredientService.getIngredient(sourceVenueId, sourceSugar.getId())).thenReturn(sourceSugar);
        
        // Only flour exists by name
        when(ingredientRepository.findByVenueIdAndNameIgnoreCase(destVenueId, "Flour"))
            .thenReturn(Optional.of(destFlour));
        when(ingredientRepository.findByVenueIdAndNameIgnoreCase(destVenueId, "Sugar"))
            .thenReturn(Optional.empty());
        
        // Mock new ingredient creation
        Ingredient newSugar = new Ingredient();
        newSugar.setId(UUID.randomUUID());
        newSugar.setVenueId(destVenueId);
        newSugar.setName("Sugar");
        when(ingredientService.createIngredient(
            eq(destVenueId),
            eq("Sugar"),
            any(BigDecimal.class),
            any(BigDecimal.class),
            eq(UomEnum.KILOGRAM),
            any(BigDecimal.class)
        )).thenReturn(newSugar);
        
        // Mock recipe creation
        Recipe copiedRecipe = new Recipe();
        copiedRecipe.setId(UUID.randomUUID());
        copiedRecipe.setVenueId(destVenueId);
        copiedRecipe.setName("Chocolate Cake");
        copiedRecipe.setPortionCount(8);
        when(recipeService.createRecipe(eq(destVenueId), eq("Chocolate Cake"), eq(8), anyList(), eq(false)))
            .thenReturn(copiedRecipe);
        
        // Mock recipe repository save
        when(recipeRepository.save(any(Recipe.class))).thenReturn(copiedRecipe);
        
        // Create request with createNew flag for sugar
        IngredientMapping sugarMapping = new IngredientMapping();
        sugarMapping.setSourceIngredientId(sourceSugar.getId());
        sugarMapping.setCreateNew(true);
        
        CopyRecipeRequest request = new CopyRecipeRequest();
        request.setSourceVenueId(sourceVenueId);
        request.setRecipeId(sourceRecipeId);
        request.setIngredientMappings(Arrays.asList(sugarMapping));
        
        mockMvc.perform(post("/api/v1/venues/{venueId}/recipes/copy", destVenueId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.name").value("Chocolate Cake"));
        
        verify(ingredientService, times(1)).createIngredient(
            eq(destVenueId),
            eq("Sugar"),
            any(BigDecimal.class),
            any(BigDecimal.class),
            eq(UomEnum.KILOGRAM),
            any(BigDecimal.class)
        );
        verify(lineService, times(2)).saveIngredientLine(any(RecipeIngredientLine.class));
    }
}
