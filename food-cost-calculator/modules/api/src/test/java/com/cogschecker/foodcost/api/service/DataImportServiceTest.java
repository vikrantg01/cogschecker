package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.exception.InvalidImportSchemaException;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Captor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for DataImportService.
 * Requirements: 7.5, 7.6
 */
@ExtendWith(MockitoExtension.class)
class DataImportServiceTest {
    
    @Mock
    private IngredientRepository ingredientRepository;
    
    @Mock
    private RecipeRepository recipeRepository;
    
    @Mock
    private RecipeIngredientLineRepository ingredientLineRepository;
    
    @Mock
    private SystemConfigRepository systemConfigRepository;
    
    @Mock
    private ObjectMapper objectMapper;
    
    @InjectMocks
    private DataImportService dataImportService;
    
    @Captor
    private ArgumentCaptor<Ingredient> ingredientCaptor;
    
    @Captor
    private ArgumentCaptor<Recipe> recipeCaptor;
    
    @Captor
    private ArgumentCaptor<RecipeIngredientLine> lineCaptor;
    
    @Captor
    private ArgumentCaptor<SystemConfig> configCaptor;
    
    private UUID venueId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        // Use a real ObjectMapper for these tests
        dataImportService = new DataImportService(
            ingredientRepository,
            recipeRepository,
            ingredientLineRepository,
            systemConfigRepository,
            new ObjectMapper()
        );
    }
    
    @Test
    void importData_withValidJson_shouldImportSuccessfully() {
        // Arrange
        String validJson = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [
                  {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "name": "Flour",
                    "purchasePrice": 10.00,
                    "purchaseQuantity": 1000.0000,
                    "unitOfMeasure": "GRAM",
                    "yieldPercentage": 100.00,
                    "costPerUnit": 0.0100,
                    "effectiveCostPerUsableUnit": 0.0100,
                    "createdAt": "2024-01-10T10:00:00Z",
                    "updatedAt": "2024-01-10T10:00:00Z"
                  }
                ],
                "recipes": [
                  {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "name": "Bread",
                    "portionCount": 10,
                    "menuSellingPrice": 5.00,
                    "totalBatchCost": 3.00,
                    "foodCostPerPortion": 0.30,
                    "foodCostPercentage": 6.0,
                    "ingredientLines": [
                      {
                        "id": "33333333-3333-3333-3333-333333333333",
                        "ingredientId": "11111111-1111-1111-1111-111111111111",
                        "subRecipeId": null,
                        "quantityUsed": 500.0000,
                        "unitOfMeasure": "GRAM",
                        "lineCost": 5.0000,
                        "createdAt": "2024-01-10T10:00:00Z",
                        "updatedAt": "2024-01-10T10:00:00Z"
                      }
                    ],
                    "createdAt": "2024-01-10T10:00:00Z",
                    "updatedAt": "2024-01-10T10:00:00Z"
                  }
                ],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.empty());
        when(ingredientRepository.save(any(Ingredient.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(recipeRepository.save(any(Recipe.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ingredientLineRepository.save(any(RecipeIngredientLine.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(systemConfigRepository.save(any(SystemConfig.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // Act
        dataImportService.importData(venueId, validJson);
        
        // Assert
        verify(ingredientRepository).deleteByVenueId(venueId);
        verify(recipeRepository).deleteByVenueId(venueId);
        verify(ingredientRepository).save(ingredientCaptor.capture());
        verify(recipeRepository).save(recipeCaptor.capture());
        verify(ingredientLineRepository).save(lineCaptor.capture());
        verify(systemConfigRepository).save(configCaptor.capture());
        
        Ingredient savedIngredient = ingredientCaptor.getValue();
        assertThat(savedIngredient.getName()).isEqualTo("Flour");
        assertThat(savedIngredient.getVenueId()).isEqualTo(venueId);
        assertThat(savedIngredient.getPurchasePrice()).isEqualByComparingTo("10.00");
        
        Recipe savedRecipe = recipeCaptor.getValue();
        assertThat(savedRecipe.getName()).isEqualTo("Bread");
        assertThat(savedRecipe.getVenueId()).isEqualTo(venueId);
        assertThat(savedRecipe.getPortionCount()).isEqualTo(10);
        
        RecipeIngredientLine savedLine = lineCaptor.getValue();
        assertThat(savedLine.getQuantityUsed()).isEqualByComparingTo("500.0000");
        assertThat(savedLine.getUnitOfMeasure()).isEqualTo(UomEnum.GRAM);
        
        SystemConfig savedConfig = configCaptor.getValue();
        assertThat(savedConfig.getTargetFoodCostPercentage()).isEqualByComparingTo("30.0");
    }
    
    @Test
    void importData_withMalformedJson_shouldThrowInvalidImportSchemaException() {
        // Arrange
        String malformedJson = "{ this is not valid json }";
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, malformedJson))
            .isInstanceOf(InvalidImportSchemaException.class)
            .hasMessageContaining("Invalid JSON format");
        
        verify(ingredientRepository, never()).deleteByVenueId(any());
        verify(ingredientRepository, never()).save(any());
    }
    
    @Test
    void importData_withMissingVersion_shouldThrowInvalidImportSchemaException() {
        // Arrange
        String jsonWithoutVersion = """
            {
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [],
                "recipes": [],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, jsonWithoutVersion))
            .isInstanceOf(InvalidImportSchemaException.class)
            .hasMessageContaining("Missing required field: version");
        
        verify(ingredientRepository, never()).deleteByVenueId(any());
    }
    
    @Test
    void importData_withMissingVenue_shouldThrowInvalidImportSchemaException() {
        // Arrange
        String jsonWithoutVenue = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z"
            }
            """;
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, jsonWithoutVenue))
            .isInstanceOf(InvalidImportSchemaException.class)
            .hasMessageContaining("Missing required field: venue");
        
        verify(ingredientRepository, never()).deleteByVenueId(any());
    }
    
    @Test
    void importData_withMissingIngredientName_shouldThrowInvalidImportSchemaException() {
        // Arrange
        String jsonWithMissingName = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [
                  {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "purchasePrice": 10.00,
                    "purchaseQuantity": 1000.0000,
                    "unitOfMeasure": "GRAM",
                    "yieldPercentage": 100.00
                  }
                ],
                "recipes": [],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, jsonWithMissingName))
            .isInstanceOf(InvalidImportSchemaException.class)
            .hasMessageContaining("Missing required field: venue.ingredients[0].name");
        
        verify(ingredientRepository, never()).deleteByVenueId(any());
    }
    
    @Test
    void importData_withInvalidUom_shouldThrowInvalidImportSchemaException() {
        // Arrange
        String jsonWithInvalidUom = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [
                  {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "name": "Flour",
                    "purchasePrice": 10.00,
                    "purchaseQuantity": 1000.0000,
                    "unitOfMeasure": "INVALID_UNIT",
                    "yieldPercentage": 100.00
                  }
                ],
                "recipes": [],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, jsonWithInvalidUom))
            .isInstanceOf(InvalidImportSchemaException.class)
            .hasMessageContaining("Invalid unitOfMeasure at venue.ingredients[0]");
        
        verify(ingredientRepository, never()).deleteByVenueId(any());
    }
    
    @Test
    void importData_withMissingIngredientLineId_shouldThrowInvalidImportSchemaException() {
        // Arrange
        String jsonWithMissingLineId = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [],
                "recipes": [
                  {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "name": "Bread",
                    "portionCount": 10,
                    "ingredientLines": [
                      {
                        "ingredientId": "11111111-1111-1111-1111-111111111111",
                        "quantityUsed": 500.0000,
                        "unitOfMeasure": "GRAM"
                      }
                    ]
                  }
                ],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, jsonWithMissingLineId))
            .isInstanceOf(InvalidImportSchemaException.class)
            .hasMessageContaining("Missing required field: venue.recipes[0].ingredientLines[0].id");
        
        verify(ingredientRepository, never()).deleteByVenueId(any());
    }
    
    @Test
    void importData_withBothIngredientIdAndSubRecipeId_shouldThrowInvalidImportSchemaException() {
        // Arrange
        String jsonWithBothIds = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [],
                "recipes": [
                  {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "name": "Bread",
                    "portionCount": 10,
                    "ingredientLines": [
                      {
                        "id": "33333333-3333-3333-3333-333333333333",
                        "ingredientId": "11111111-1111-1111-1111-111111111111",
                        "subRecipeId": "44444444-4444-4444-4444-444444444444",
                        "quantityUsed": 500.0000,
                        "unitOfMeasure": "GRAM"
                      }
                    ]
                  }
                ],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, jsonWithBothIds))
            .isInstanceOf(InvalidImportSchemaException.class)
            .hasMessageContaining("cannot have both ingredientId and subRecipeId");
        
        verify(ingredientRepository, never()).deleteByVenueId(any());
    }
    
    @Test
    void importData_withNeitherIngredientIdNorSubRecipeId_shouldThrowInvalidImportSchemaException() {
        // Arrange
        String jsonWithNeitherIds = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [],
                "recipes": [
                  {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "name": "Bread",
                    "portionCount": 10,
                    "ingredientLines": [
                      {
                        "id": "33333333-3333-3333-3333-333333333333",
                        "quantityUsed": 500.0000,
                        "unitOfMeasure": "GRAM"
                      }
                    ]
                  }
                ],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, jsonWithNeitherIds))
            .isInstanceOf(InvalidImportSchemaException.class)
            .hasMessageContaining("must have either ingredientId or subRecipeId");
        
        verify(ingredientRepository, never()).deleteByVenueId(any());
    }
    
    @Test
    void importData_shouldDeleteExistingDataBeforeImport() {
        // Arrange
        String validJson = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [],
                "recipes": [],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        Recipe existingRecipe = new Recipe();
        existingRecipe.setId(UUID.randomUUID());
        
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of(existingRecipe));
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.empty());
        when(systemConfigRepository.save(any(SystemConfig.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // Act
        dataImportService.importData(venueId, validJson);
        
        // Assert
        verify(ingredientLineRepository).deleteByRecipeId(existingRecipe.getId());
        verify(recipeRepository).deleteByVenueId(venueId);
        verify(ingredientRepository).deleteByVenueId(venueId);
    }
    
    @Test
    void importData_withSubRecipe_shouldImportCorrectly() {
        // Arrange
        String jsonWithSubRecipe = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [],
                "recipes": [
                  {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "name": "Base Sauce",
                    "portionCount": 5,
                    "ingredientLines": []
                  },
                  {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "name": "Complete Dish",
                    "portionCount": 10,
                    "ingredientLines": [
                      {
                        "id": "33333333-3333-3333-3333-333333333333",
                        "ingredientId": null,
                        "subRecipeId": "11111111-1111-1111-1111-111111111111",
                        "quantityUsed": 2.0000,
                        "unitOfMeasure": "EACH",
                        "lineCost": 1.5000
                      }
                    ]
                  }
                ],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        when(recipeRepository.findByVenueId(venueId)).thenReturn(List.of());
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.empty());
        when(recipeRepository.save(any(Recipe.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ingredientLineRepository.save(any(RecipeIngredientLine.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(systemConfigRepository.save(any(SystemConfig.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // Act
        dataImportService.importData(venueId, jsonWithSubRecipe);
        
        // Assert
        verify(recipeRepository, times(2)).save(recipeCaptor.capture());
        verify(ingredientLineRepository).save(lineCaptor.capture());
        
        RecipeIngredientLine savedLine = lineCaptor.getValue();
        assertThat(savedLine.getIngredientId()).isNull();
        assertThat(savedLine.getSubRecipeId()).isNotNull();
        assertThat(savedLine.getUnitOfMeasure()).isEqualTo(UomEnum.EACH);
        assertThat(savedLine.getQuantityUsed()).isEqualByComparingTo("2.0000");
    }
    
    @Test
    void importData_onValidationFailure_shouldNotModifyData() {
        // Arrange
        String invalidJson = """
            {
              "version": 1,
              "exportedAt": "2024-01-15T10:30:00Z",
              "venue": {
                "ingredients": [
                  {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "purchasePrice": 10.00
                  }
                ],
                "recipes": [],
                "targetFoodCostPercentage": 30.0
              }
            }
            """;
        
        // Act & Assert
        assertThatThrownBy(() -> dataImportService.importData(venueId, invalidJson))
            .isInstanceOf(InvalidImportSchemaException.class);
        
        // Verify no data was modified
        verify(ingredientRepository, never()).deleteByVenueId(any());
        verify(recipeRepository, never()).deleteByVenueId(any());
        verify(ingredientRepository, never()).save(any());
        verify(recipeRepository, never()).save(any());
        verify(ingredientLineRepository, never()).save(any());
    }
}
