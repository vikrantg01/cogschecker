package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.VenueExportData;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for DataExportService.
 * Requirements: 7.4
 */
@ExtendWith(MockitoExtension.class)
class DataExportServiceTest {
    
    @Mock
    private IngredientRepository ingredientRepository;
    
    @Mock
    private RecipeRepository recipeRepository;
    
    @Mock
    private RecipeIngredientLineRepository ingredientLineRepository;
    
    @Mock
    private SystemConfigRepository systemConfigRepository;
    
    @InjectMocks
    private DataExportService dataExportService;
    
    private UUID venueId;
    private UUID ingredientId;
    private UUID recipeId;
    private UUID lineId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        ingredientId = UUID.randomUUID();
        recipeId = UUID.randomUUID();
        lineId = UUID.randomUUID();
    }
    
    @Test
    void export_shouldReturnVersionedEnvelope() {
        // Arrange
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(systemConfigRepository.findById(venueId))
                .thenReturn(Optional.of(createSystemConfig()));
        
        // Act
        VenueExportData result = dataExportService.export(venueId);
        
        // Assert
        assertThat(result).isNotNull();
        assertThat(result.getVersion()).isEqualTo(1);
        assertThat(result.getExportedAt()).isNotNull();
        assertThat(result.getVenue()).isNotNull();
    }
    
    @Test
    void export_shouldIncludeAllIngredients() {
        // Arrange
        Ingredient ingredient = createIngredient();
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(List.of(ingredient));
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(systemConfigRepository.findById(venueId))
                .thenReturn(Optional.of(createSystemConfig()));
        
        // Act
        VenueExportData result = dataExportService.export(venueId);
        
        // Assert
        assertThat(result.getVenue().getIngredients()).hasSize(1);
        VenueExportData.IngredientExportData exportedIngredient = result.getVenue().getIngredients().get(0);
        
        assertThat(exportedIngredient.getId()).isEqualTo(ingredient.getId().toString());
        assertThat(exportedIngredient.getName()).isEqualTo("Flour");
        assertThat(exportedIngredient.getPurchasePrice()).isEqualByComparingTo("10.00");
        assertThat(exportedIngredient.getPurchaseQuantity()).isEqualByComparingTo("1000.0000");
        assertThat(exportedIngredient.getUnitOfMeasure()).isEqualTo("GRAM");
        assertThat(exportedIngredient.getYieldPercentage()).isEqualByComparingTo("100.00");
        assertThat(exportedIngredient.getCostPerUnit()).isEqualByComparingTo("0.0100");
        assertThat(exportedIngredient.getEffectiveCostPerUsableUnit()).isEqualByComparingTo("0.0100");
    }
    
    @Test
    void export_shouldIncludeAllRecipesWithIngredientLines() {
        // Arrange
        Recipe recipe = createRecipe();
        RecipeIngredientLine line = createIngredientLine();
        
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of(recipe));
        when(ingredientLineRepository.findByRecipeId(recipeId)).thenReturn(List.of(line));
        when(systemConfigRepository.findById(venueId))
                .thenReturn(Optional.of(createSystemConfig()));
        
        // Act
        VenueExportData result = dataExportService.export(venueId);
        
        // Assert
        assertThat(result.getVenue().getRecipes()).hasSize(1);
        VenueExportData.RecipeExportData exportedRecipe = result.getVenue().getRecipes().get(0);
        
        assertThat(exportedRecipe.getId()).isEqualTo(recipe.getId().toString());
        assertThat(exportedRecipe.getName()).isEqualTo("Bread");
        assertThat(exportedRecipe.getPortionCount()).isEqualTo(10);
        assertThat(exportedRecipe.getMenuSellingPrice()).isEqualByComparingTo("5.00");
        assertThat(exportedRecipe.getTotalBatchCost()).isEqualByComparingTo("3.00");
        assertThat(exportedRecipe.getFoodCostPerPortion()).isEqualByComparingTo("0.30");
        assertThat(exportedRecipe.getFoodCostPercentage()).isEqualByComparingTo("6.0");
        
        assertThat(exportedRecipe.getIngredientLines()).hasSize(1);
        VenueExportData.IngredientLineExportData exportedLine = exportedRecipe.getIngredientLines().get(0);
        
        assertThat(exportedLine.getId()).isEqualTo(line.getId().toString());
        assertThat(exportedLine.getIngredientId()).isEqualTo(ingredientId.toString());
        assertThat(exportedLine.getSubRecipeId()).isNull();
        assertThat(exportedLine.getQuantityUsed()).isEqualByComparingTo("500.0000");
        assertThat(exportedLine.getUnitOfMeasure()).isEqualTo("GRAM");
        assertThat(exportedLine.getLineCost()).isEqualByComparingTo("5.0000");
    }
    
    @Test
    void export_shouldIncludeTargetFoodCostPercentage() {
        // Arrange
        SystemConfig config = new SystemConfig(venueId, new BigDecimal("35.5"));
        config.setCreatedAt(Instant.now());
        config.setUpdatedAt(Instant.now());
        
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.of(config));
        
        // Act
        VenueExportData result = dataExportService.export(venueId);
        
        // Assert
        assertThat(result.getVenue().getTargetFoodCostPercentage()).isEqualByComparingTo("35.5");
    }
    
    @Test
    void export_shouldUseDefaultTargetWhenConfigNotFound() {
        // Arrange
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.empty());
        
        // Act
        VenueExportData result = dataExportService.export(venueId);
        
        // Assert
        assertThat(result.getVenue().getTargetFoodCostPercentage()).isEqualByComparingTo("30.0");
    }
    
    @Test
    void export_shouldHandleSubRecipeLines() {
        // Arrange
        Recipe recipe = createRecipe();
        RecipeIngredientLine subRecipeLine = new RecipeIngredientLine();
        subRecipeLine.setId(lineId);
        subRecipeLine.setRecipeId(recipeId);
        subRecipeLine.setIngredientId(null);
        subRecipeLine.setSubRecipeId(UUID.randomUUID());
        subRecipeLine.setQuantityUsed(new BigDecimal("2.0000"));
        subRecipeLine.setUnitOfMeasure(UomEnum.EACH);
        subRecipeLine.setLineCost(new BigDecimal("1.5000"));
        subRecipeLine.setCreatedAt(Instant.now());
        subRecipeLine.setUpdatedAt(Instant.now());
        
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of(recipe));
        when(ingredientLineRepository.findByRecipeId(recipeId)).thenReturn(List.of(subRecipeLine));
        when(systemConfigRepository.findById(venueId))
                .thenReturn(Optional.of(createSystemConfig()));
        
        // Act
        VenueExportData result = dataExportService.export(venueId);
        
        // Assert
        assertThat(result.getVenue().getRecipes()).hasSize(1);
        VenueExportData.RecipeExportData exportedRecipe = result.getVenue().getRecipes().get(0);
        assertThat(exportedRecipe.getIngredientLines()).hasSize(1);
        
        VenueExportData.IngredientLineExportData exportedLine = exportedRecipe.getIngredientLines().get(0);
        assertThat(exportedLine.getIngredientId()).isNull();
        assertThat(exportedLine.getSubRecipeId()).isNotNull();
        assertThat(exportedLine.getQuantityUsed()).isEqualByComparingTo("2.0000");
    }
    
    @Test
    void export_shouldHandleEmptyVenue() {
        // Arrange
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(systemConfigRepository.findById(venueId))
                .thenReturn(Optional.of(createSystemConfig()));
        
        // Act
        VenueExportData result = dataExportService.export(venueId);
        
        // Assert
        assertThat(result.getVenue().getIngredients()).isEmpty();
        assertThat(result.getVenue().getRecipes()).isEmpty();
        assertThat(result.getVenue().getTargetFoodCostPercentage()).isEqualByComparingTo("30.0");
    }
    
    // Helper methods to create test entities
    
    private Ingredient createIngredient() {
        Ingredient ingredient = new Ingredient();
        ingredient.setId(ingredientId);
        ingredient.setVenueId(venueId);
        ingredient.setName("Flour");
        ingredient.setPurchasePrice(new BigDecimal("10.00"));
        ingredient.setPurchaseQuantity(new BigDecimal("1000.0000"));
        ingredient.setUnitOfMeasure(UomEnum.GRAM);
        ingredient.setYieldPercentage(new BigDecimal("100.00"));
        ingredient.setCostPerUnit(new BigDecimal("0.0100"));
        ingredient.setEffectiveCostPerUsableUnit(new BigDecimal("0.0100"));
        ingredient.setCreatedAt(Instant.now());
        ingredient.setUpdatedAt(Instant.now());
        return ingredient;
    }
    
    private Recipe createRecipe() {
        Recipe recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setName("Bread");
        recipe.setPortionCount(10);
        recipe.setMenuSellingPrice(new BigDecimal("5.00"));
        recipe.setTotalBatchCost(new BigDecimal("3.00"));
        recipe.setFoodCostPerPortion(new BigDecimal("0.30"));
        recipe.setFoodCostPercentage(new BigDecimal("6.0"));
        recipe.setCreatedAt(Instant.now());
        recipe.setUpdatedAt(Instant.now());
        return recipe;
    }
    
    private RecipeIngredientLine createIngredientLine() {
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setId(lineId);
        line.setRecipeId(recipeId);
        line.setIngredientId(ingredientId);
        line.setSubRecipeId(null);
        line.setQuantityUsed(new BigDecimal("500.0000"));
        line.setUnitOfMeasure(UomEnum.GRAM);
        line.setLineCost(new BigDecimal("5.0000"));
        line.setCreatedAt(Instant.now());
        line.setUpdatedAt(Instant.now());
        return line;
    }
    
    private SystemConfig createSystemConfig() {
        SystemConfig config = new SystemConfig(venueId, new BigDecimal("30.0"));
        config.setCreatedAt(Instant.now());
        config.setUpdatedAt(Instant.now());
        return config;
    }
}
