package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.RecipeResponse;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.ThresholdStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for ReportService.
 * Tests Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
@ExtendWith(MockitoExtension.class)
class ReportServiceTest {
    
    @Mock
    private RecipeRepository recipeRepository;
    
    @Mock
    private SystemConfigService systemConfigService;
    
    @InjectMocks
    private ReportService reportService;
    
    private UUID venueId;
    private BigDecimal threshold;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        threshold = new BigDecimal("30.0");
        
        SystemConfig config = new SystemConfig(venueId, threshold);
        when(systemConfigService.getConfig(venueId)).thenReturn(config);
    }
    
    // Requirement 5.1: Pre-inclusion validation tests
    
    @Test
    void getCostingReport_AllValidRecipes_ReturnsAllRecipes() {
        // Given
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Recipe B", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0")),
            createRecipe("Recipe C", new BigDecimal("15.00"), new BigDecimal("30.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, null);
        
        // Then
        assertThat(result).hasSize(3);
    }
    
    @Test
    void getCostingReport_RecipeWithEmptyName_ExcludesFromReport() {
        // Given - Requirement 5.1: non-empty name
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Valid Recipe", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0")),
            createRecipe(null, new BigDecimal("8.00"), new BigDecimal("15.00"), new BigDecimal("53.3"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, null);
        
        // Then - only valid recipe should be included
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getName()).isEqualTo("Valid Recipe");
    }
    
    @Test
    void getCostingReport_RecipeWithNegativeFoodCost_ExcludesFromReport() {
        // Given - Requirement 5.1: non-negative food cost
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Valid Recipe", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Invalid Recipe", new BigDecimal("-5.00"), new BigDecimal("10.00"), new BigDecimal("-50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, null);
        
        // Then - only valid recipe should be included
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getName()).isEqualTo("Valid Recipe");
    }
    
    @Test
    void getCostingReport_RecipeWithNegativeMenuPrice_ExcludesFromReport() {
        // Given - Requirement 5.1: non-negative menu selling price
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Valid Recipe", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Invalid Recipe", new BigDecimal("5.00"), new BigDecimal("-10.00"), null)
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, null);
        
        // Then - only valid recipe should be included
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getName()).isEqualTo("Valid Recipe");
    }
    
    @Test
    void getCostingReport_RecipeWithNullCostsAndPrices_IncludesInReport() {
        // Given - null values are acceptable, just negative values are not
        Recipe recipe = createRecipe("Recipe with nulls", null, null, null);
        when(recipeRepository.findByVenueId(venueId)).thenReturn(Arrays.asList(recipe));
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, null);
        
        // Then - recipe with null values should be included
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getName()).isEqualTo("Recipe with nulls");
        assertThat(result.get(0).getFoodCostPerPortion()).isNull();
        assertThat(result.get(0).getMenuSellingPrice()).isNull();
        assertThat(result.get(0).getFoodCostPercentage()).isNull();
    }
    
    // Requirement 5.3: Default sort by recipe name ASC
    
    @Test
    void getCostingReport_NoSortSpecified_SortsByNameAscending() {
        // Given - Requirement 5.3: default sort by recipe name ASC
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Zebra Cake", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Apple Pie", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0")),
            createRecipe("Banana Split", new BigDecimal("15.00"), new BigDecimal("30.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, null);
        
        // Then - should be sorted alphabetically by name
        assertThat(result).hasSize(3);
        assertThat(result.get(0).getName()).isEqualTo("Apple Pie");
        assertThat(result.get(1).getName()).isEqualTo("Banana Split");
        assertThat(result.get(2).getName()).isEqualTo("Zebra Cake");
    }
    
    @Test
    void getCostingReport_EmptySortColumn_SortsByNameAscending() {
        // Given
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Zebra Cake", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Apple Pie", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "", null, null);
        
        // Then
        assertThat(result.get(0).getName()).isEqualTo("Apple Pie");
        assertThat(result.get(1).getName()).isEqualTo("Zebra Cake");
    }
    
    // Requirement 5.2: Sort by different columns
    
    @Test
    void getCostingReport_SortByName_Ascending() {
        // Given
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Zebra", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Apple", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0")),
            createRecipe("Banana", new BigDecimal("15.00"), new BigDecimal("30.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "name", "asc", null);
        
        // Then
        assertThat(result.get(0).getName()).isEqualTo("Apple");
        assertThat(result.get(1).getName()).isEqualTo("Banana");
        assertThat(result.get(2).getName()).isEqualTo("Zebra");
    }
    
    @Test
    void getCostingReport_SortByName_Descending() {
        // Given
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Zebra", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Apple", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0")),
            createRecipe("Banana", new BigDecimal("15.00"), new BigDecimal("30.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "name", "desc", null);
        
        // Then
        assertThat(result.get(0).getName()).isEqualTo("Zebra");
        assertThat(result.get(1).getName()).isEqualTo("Banana");
        assertThat(result.get(2).getName()).isEqualTo("Apple");
    }
    
    @Test
    void getCostingReport_SortByFoodCostPerPortion_Ascending() {
        // Given - Requirement 5.2: sort by food cost per portion
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("15.00"), new BigDecimal("30.00"), new BigDecimal("50.0")),
            createRecipe("Recipe B", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0")),
            createRecipe("Recipe C", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "foodCostPerPortion", "asc", null);
        
        // Then
        assertThat(result.get(0).getFoodCostPerPortion()).isEqualByComparingTo("5.00");
        assertThat(result.get(1).getFoodCostPerPortion()).isEqualByComparingTo("10.00");
        assertThat(result.get(2).getFoodCostPerPortion()).isEqualByComparingTo("15.00");
    }
    
    @Test
    void getCostingReport_SortByFoodCostPerPortion_Descending() {
        // Given
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("15.00"), new BigDecimal("30.00"), new BigDecimal("50.0")),
            createRecipe("Recipe B", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0")),
            createRecipe("Recipe C", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "foodCostPerPortion", "desc", null);
        
        // Then
        assertThat(result.get(0).getFoodCostPerPortion()).isEqualByComparingTo("15.00");
        assertThat(result.get(1).getFoodCostPerPortion()).isEqualByComparingTo("10.00");
        assertThat(result.get(2).getFoodCostPerPortion()).isEqualByComparingTo("5.00");
    }
    
    @Test
    void getCostingReport_SortByMenuSellingPrice_Ascending() {
        // Given - Requirement 5.2: sort by menu selling price
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("10.00"), new BigDecimal("30.00"), new BigDecimal("33.3")),
            createRecipe("Recipe B", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0")),
            createRecipe("Recipe C", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "menuSellingPrice", "asc", null);
        
        // Then
        assertThat(result.get(0).getMenuSellingPrice()).isEqualByComparingTo("10.00");
        assertThat(result.get(1).getMenuSellingPrice()).isEqualByComparingTo("20.00");
        assertThat(result.get(2).getMenuSellingPrice()).isEqualByComparingTo("30.00");
    }
    
    @Test
    void getCostingReport_SortByFoodCostPercentage_Ascending() {
        // Given - Requirement 5.2: sort by food cost percentage
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Recipe B", new BigDecimal("5.00"), new BigDecimal("20.00"), new BigDecimal("25.0")),
            createRecipe("Recipe C", new BigDecimal("15.00"), new BigDecimal("20.00"), new BigDecimal("75.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "foodCostPercentage", "asc", null);
        
        // Then
        assertThat(result.get(0).getFoodCostPercentage()).isEqualByComparingTo("25.0");
        assertThat(result.get(1).getFoodCostPercentage()).isEqualByComparingTo("50.0");
        assertThat(result.get(2).getFoodCostPercentage()).isEqualByComparingTo("75.0");
    }
    
    @Test
    void getCostingReport_SortWithNullValues_NullsComeLast() {
        // Given - recipes with null food cost per portion
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Recipe A", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Recipe B", null, new BigDecimal("20.00"), null),
            createRecipe("Recipe C", new BigDecimal("5.00"), new BigDecimal("10.00"), new BigDecimal("50.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "foodCostPerPortion", "asc", null);
        
        // Then - nulls should come last
        assertThat(result.get(0).getFoodCostPerPortion()).isEqualByComparingTo("5.00");
        assertThat(result.get(1).getFoodCostPerPortion()).isEqualByComparingTo("10.00");
        assertThat(result.get(2).getFoodCostPerPortion()).isNull();
    }
    
    // Requirement 5.4: "Exceeds threshold" filter
    
    @Test
    void getCostingReport_ExceedsThresholdFilter_OnlyIncludesExceedingRecipes() {
        // Given - Requirement 5.4: only recipes where food_cost_percentage > threshold
        // threshold is 30.0
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Below Threshold", new BigDecimal("5.00"), new BigDecimal("20.00"), new BigDecimal("25.0")),
            createRecipe("At Threshold", new BigDecimal("6.00"), new BigDecimal("20.00"), new BigDecimal("30.0")),
            createRecipe("Above Threshold", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("Way Above", new BigDecimal("15.00"), new BigDecimal("20.00"), new BigDecimal("75.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, "exceedsThreshold");
        
        // Then - only recipes exceeding 30.0 should be included
        assertThat(result).hasSize(2);
        assertThat(result.get(0).getName()).isEqualTo("Above Threshold");
        assertThat(result.get(1).getName()).isEqualTo("Way Above");
    }
    
    @Test
    void getCostingReport_ExceedsThresholdFilter_ExcludesRecipesWithoutMenuPrice() {
        // Given - Requirement 5.4: recipes with no menu selling price SHALL be excluded
        List<Recipe> recipes = Arrays.asList(
            createRecipe("With Price Above", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("No Price", new BigDecimal("10.00"), null, null),
            createRecipe("Zero Price", new BigDecimal("10.00"), BigDecimal.ZERO, null)
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, "exceedsThreshold");
        
        // Then - only recipe with valid menu price and exceeding threshold
        assertThat(result).hasSize(1);
        assertThat(result.get(0).getName()).isEqualTo("With Price Above");
    }
    
    @Test
    void getCostingReport_ExceedsThresholdFilter_ExcludesAtOrBelowThreshold() {
        // Given - threshold is 30.0
        List<Recipe> recipes = Arrays.asList(
            createRecipe("At Threshold", new BigDecimal("6.00"), new BigDecimal("20.00"), new BigDecimal("30.0")),
            createRecipe("Below Threshold", new BigDecimal("5.00"), new BigDecimal("20.00"), new BigDecimal("25.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, "exceedsThreshold");
        
        // Then - no recipes should be included (only EXCEEDING, not at threshold)
        assertThat(result).isEmpty();
    }
    
    // Requirement 5.5: Empty result when no recipes match filter
    
    @Test
    void getCostingReport_NoRecipesExceedThreshold_ReturnsEmptyList() {
        // Given - Requirement 5.5: return empty list when no matches
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Below", new BigDecimal("5.00"), new BigDecimal("20.00"), new BigDecimal("25.0")),
            createRecipe("At Threshold", new BigDecimal("6.00"), new BigDecimal("20.00"), new BigDecimal("30.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, "exceedsThreshold");
        
        // Then
        assertThat(result).isEmpty();
    }
    
    @Test
    void getCostingReport_NoRecipesAtAll_ReturnsEmptyList() {
        // Given
        when(recipeRepository.findByVenueId(venueId)).thenReturn(new ArrayList<>());
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, null);
        
        // Then
        assertThat(result).isEmpty();
    }
    
    // Threshold status tests - Requirements 4.7, 4.8
    
    @Test
    void getCostingReport_RecipesWithThresholdStatus_IncludesCorrectStatus() {
        // Given
        List<Recipe> recipes = Arrays.asList(
            createRecipe("A Exceeding", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("B Passing", new BigDecimal("5.00"), new BigDecimal("20.00"), new BigDecimal("25.0")),
            createRecipe("C No Price", new BigDecimal("10.00"), null, null)
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When
        List<RecipeResponse> result = reportService.getCostingReport(venueId, null, null, null);
        
        // Then - results are sorted by name, so order is A, B, C
        assertThat(result).hasSize(3);
        assertThat(result.get(0).getName()).isEqualTo("A Exceeding");
        assertThat(result.get(0).getThresholdStatus()).isEqualTo(ThresholdStatus.EXCEEDING);
        assertThat(result.get(1).getName()).isEqualTo("B Passing");
        assertThat(result.get(1).getThresholdStatus()).isEqualTo(ThresholdStatus.PASSING);
        assertThat(result.get(2).getName()).isEqualTo("C No Price");
        assertThat(result.get(2).getThresholdStatus()).isNull(); // No menu price
    }
    
    @Test
    void getCostingReport_SortAndFilter_BothAppliedCorrectly() {
        // Given - test combining sort and filter
        List<Recipe> recipes = Arrays.asList(
            createRecipe("Z Recipe", new BigDecimal("15.00"), new BigDecimal("20.00"), new BigDecimal("75.0")),
            createRecipe("A Recipe", new BigDecimal("10.00"), new BigDecimal("20.00"), new BigDecimal("50.0")),
            createRecipe("M Recipe", new BigDecimal("5.00"), new BigDecimal("20.00"), new BigDecimal("25.0"))
        );
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        
        // When - filter for exceeding threshold and sort by name
        List<RecipeResponse> result = reportService.getCostingReport(venueId, "name", "asc", "exceedsThreshold");
        
        // Then - should have 2 recipes (50% and 75%) sorted by name
        assertThat(result).hasSize(2);
        assertThat(result.get(0).getName()).isEqualTo("A Recipe");
        assertThat(result.get(1).getName()).isEqualTo("Z Recipe");
    }
    
    // Helper methods
    
    private Recipe createRecipe(String name, BigDecimal foodCostPerPortion, 
                                BigDecimal menuSellingPrice, BigDecimal foodCostPercentage) {
        Recipe recipe = new Recipe();
        recipe.setId(UUID.randomUUID());
        recipe.setVenueId(venueId);
        recipe.setName(name);
        recipe.setPortionCount(4);
        recipe.setFoodCostPerPortion(foodCostPerPortion);
        recipe.setMenuSellingPrice(menuSellingPrice);
        recipe.setFoodCostPercentage(foodCostPercentage);
        recipe.setTotalBatchCost(foodCostPerPortion != null ? 
            foodCostPerPortion.multiply(new BigDecimal("4")) : BigDecimal.ZERO);
        recipe.setCreatedAt(Instant.now());
        recipe.setUpdatedAt(Instant.now());
        return recipe;
    }
}
