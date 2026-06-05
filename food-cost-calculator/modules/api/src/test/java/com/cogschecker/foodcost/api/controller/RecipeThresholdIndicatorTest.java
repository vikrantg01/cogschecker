package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.RecipeResponse;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import com.cogschecker.foodcost.shared.ThresholdStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests for threshold indicator functionality.
 * Requirements: 4.7, 4.8
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RecipeThresholdIndicatorTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @Autowired
    private RecipeRepository recipeRepository;
    
    @Autowired
    private SystemConfigRepository systemConfigRepository;
    
    private UUID venueId;
    private SystemConfig config;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        
        // Set target threshold to 30%
        config = new SystemConfig(venueId, new BigDecimal("30.0"));
        systemConfigRepository.save(config);
    }
    
    @AfterEach
    void tearDown() {
        recipeRepository.deleteAll();
        systemConfigRepository.deleteAll();
    }
    
    /**
     * Requirement 4.7: When food cost percentage exceeds threshold, return EXCEEDING status.
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testThresholdIndicator_WhenExceedingThreshold_ReturnsExceeding() throws Exception {
        // Create recipe with food cost percentage > 30%
        Recipe recipe = createRecipe("High Cost Item", new BigDecimal("35.5"));
        recipeRepository.save(recipe);
        
        // Get recipe via API
        MvcResult result = mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venueId))
            .andExpect(status().isOk())
            .andReturn();
        
        String json = result.getResponse().getContentAsString();
        RecipeResponse[] recipes = objectMapper.readValue(json, RecipeResponse[].class);
        
        assertThat(recipes).hasSize(1);
        assertThat(recipes[0].getThresholdStatus()).isEqualTo(ThresholdStatus.EXCEEDING);
        assertThat(recipes[0].getFoodCostPercentage()).isEqualByComparingTo(new BigDecimal("35.5"));
    }
    
    /**
     * Requirement 4.8: When food cost percentage equals threshold, return PASSING status.
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testThresholdIndicator_WhenEqualsThreshold_ReturnsPassing() throws Exception {
        // Create recipe with food cost percentage == 30%
        Recipe recipe = createRecipe("At Threshold Item", new BigDecimal("30.0"));
        recipeRepository.save(recipe);
        
        // Get recipe via API
        MvcResult result = mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venueId))
            .andExpect(status().isOk())
            .andReturn();
        
        String json = result.getResponse().getContentAsString();
        RecipeResponse[] recipes = objectMapper.readValue(json, RecipeResponse[].class);
        
        assertThat(recipes).hasSize(1);
        assertThat(recipes[0].getThresholdStatus()).isEqualTo(ThresholdStatus.PASSING);
        assertThat(recipes[0].getFoodCostPercentage()).isEqualByComparingTo(new BigDecimal("30.0"));
    }
    
    /**
     * Requirement 4.8: When food cost percentage is below threshold, return PASSING status.
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testThresholdIndicator_WhenBelowThreshold_ReturnsPassing() throws Exception {
        // Create recipe with food cost percentage < 30%
        Recipe recipe = createRecipe("Low Cost Item", new BigDecimal("25.0"));
        recipeRepository.save(recipe);
        
        // Get recipe via API
        MvcResult result = mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venueId))
            .andExpect(status().isOk())
            .andReturn();
        
        String json = result.getResponse().getContentAsString();
        RecipeResponse[] recipes = objectMapper.readValue(json, RecipeResponse[].class);
        
        assertThat(recipes).hasSize(1);
        assertThat(recipes[0].getThresholdStatus()).isEqualTo(ThresholdStatus.PASSING);
        assertThat(recipes[0].getFoodCostPercentage()).isEqualByComparingTo(new BigDecimal("25.0"));
    }
    
    /**
     * When food cost percentage is null (no menu price), threshold status should be null.
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testThresholdIndicator_WhenNoMenuPrice_ReturnsNull() throws Exception {
        // Create recipe with no menu price (null food cost percentage)
        Recipe recipe = createRecipe("No Price Item", null);
        recipeRepository.save(recipe);
        
        // Get recipe via API
        MvcResult result = mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venueId))
            .andExpect(status().isOk())
            .andReturn();
        
        String json = result.getResponse().getContentAsString();
        RecipeResponse[] recipes = objectMapper.readValue(json, RecipeResponse[].class);
        
        assertThat(recipes).hasSize(1);
        assertThat(recipes[0].getThresholdStatus()).isNull();
        assertThat(recipes[0].getFoodCostPercentage()).isNull();
    }
    
    /**
     * Test with different threshold value.
     */
    @Test
    @WithMockUser(roles = "ADMIN")
    void testThresholdIndicator_WithDifferentThreshold() throws Exception {
        // Update threshold to 40%
        config.setTargetFoodCostPercentage(new BigDecimal("40.0"));
        systemConfigRepository.save(config);
        
        // Create recipe with 35% food cost (now passing with 40% threshold)
        Recipe recipe = createRecipe("Medium Cost Item", new BigDecimal("35.0"));
        recipeRepository.save(recipe);
        
        // Get recipe via API
        MvcResult result = mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venueId))
            .andExpect(status().isOk())
            .andReturn();
        
        String json = result.getResponse().getContentAsString();
        RecipeResponse[] recipes = objectMapper.readValue(json, RecipeResponse[].class);
        
        assertThat(recipes).hasSize(1);
        assertThat(recipes[0].getThresholdStatus()).isEqualTo(ThresholdStatus.PASSING);
        assertThat(recipes[0].getFoodCostPercentage()).isEqualByComparingTo(new BigDecimal("35.0"));
    }
    
    private Recipe createRecipe(String name, BigDecimal foodCostPercentage) {
        Recipe recipe = new Recipe();
        recipe.setVenueId(venueId);
        recipe.setName(name);
        recipe.setPortionCount(10);
        recipe.setTotalBatchCost(new BigDecimal("100.00"));
        recipe.setFoodCostPerPortion(new BigDecimal("10.00"));
        
        if (foodCostPercentage != null) {
            // Calculate menu price that would give this percentage
            // foodCostPercentage = (foodCostPerPortion / menuPrice) * 100
            // menuPrice = (foodCostPerPortion * 100) / foodCostPercentage
            BigDecimal menuPrice = new BigDecimal("10.00")
                .multiply(new BigDecimal("100"))
                .divide(foodCostPercentage, 2, java.math.RoundingMode.HALF_UP);
            recipe.setMenuSellingPrice(menuPrice);
            recipe.setFoodCostPercentage(foodCostPercentage);
        } else {
            recipe.setMenuSellingPrice(null);
            recipe.setFoodCostPercentage(null);
        }
        
        recipe.setCreatedAt(Instant.now());
        recipe.setUpdatedAt(Instant.now());
        
        return recipe;
    }
}
