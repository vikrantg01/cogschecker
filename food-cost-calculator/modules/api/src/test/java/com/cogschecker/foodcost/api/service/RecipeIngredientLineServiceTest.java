package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.exception.CircularReferenceException;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for RecipeIngredientLineService with circular reference detection.
 * Tests Requirements: 2.2, 2.3, 2.4
 */
@ExtendWith(MockitoExtension.class)
class RecipeIngredientLineServiceTest {
    
    @Mock
    private RecipeIngredientLineRepository recipeIngredientLineRepository;
    
    @Mock
    private RecipeRepository recipeRepository;
    
    @InjectMocks
    private RecipeIngredientLineService service;
    
    private UUID parentRecipeId;
    private UUID subRecipeId;
    private UUID ingredientId;
    
    @BeforeEach
    void setUp() {
        parentRecipeId = UUID.randomUUID();
        subRecipeId = UUID.randomUUID();
        ingredientId = UUID.randomUUID();
    }
    
    // Requirement 2.2 - Adding ingredient lines with regular ingredients
    
    @Test
    void saveIngredientLine_WithRegularIngredient_SuccessfullySaves() {
        // Given - line with regular ingredient (no sub-recipe)
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setRecipeId(parentRecipeId);
        line.setIngredientId(ingredientId);
        line.setQuantityUsed(new BigDecimal("2.5"));
        line.setUnitOfMeasure(UomEnum.KILOGRAM);
        
        when(recipeIngredientLineRepository.save(any(RecipeIngredientLine.class)))
            .thenReturn(line);
        
        // When
        RecipeIngredientLine result = service.saveIngredientLine(line);
        
        // Then
        assertThat(result).isNotNull();
        assertThat(result.getIngredientId()).isEqualTo(ingredientId);
        assertThat(result.getCreatedAt()).isNotNull();
        assertThat(result.getUpdatedAt()).isNotNull();
        
        // Should not check for circular reference when no sub-recipe
        verify(recipeRepository, never()).existsCircularReference(any(), any());
        verify(recipeIngredientLineRepository).save(line);
    }
    
    // Requirement 2.3, 2.4 - Circular reference detection
    
    @Test
    void saveIngredientLine_WithValidSubRecipe_SuccessfullySaves() {
        // Given - line with sub-recipe that doesn't create circular reference
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setRecipeId(parentRecipeId);
        line.setSubRecipeId(subRecipeId);
        line.setQuantityUsed(new BigDecimal("1.0"));
        line.setUnitOfMeasure(UomEnum.EACH);
        
        when(recipeRepository.existsCircularReference(parentRecipeId, subRecipeId))
            .thenReturn(false); // No circular reference
        when(recipeIngredientLineRepository.save(any(RecipeIngredientLine.class)))
            .thenReturn(line);
        
        // When
        RecipeIngredientLine result = service.saveIngredientLine(line);
        
        // Then
        assertThat(result).isNotNull();
        assertThat(result.getSubRecipeId()).isEqualTo(subRecipeId);
        
        verify(recipeRepository).existsCircularReference(parentRecipeId, subRecipeId);
        verify(recipeIngredientLineRepository).save(line);
    }
    
    @Test
    void saveIngredientLine_DirectSelfReference_ThrowsCircularReferenceException() {
        // Given - line trying to add recipe as sub-recipe of itself
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setRecipeId(parentRecipeId);
        line.setSubRecipeId(parentRecipeId); // Same ID = direct self-reference
        line.setQuantityUsed(new BigDecimal("1.0"));
        line.setUnitOfMeasure(UomEnum.EACH);
        
        // When/Then - Requirement 2.4
        assertThatThrownBy(() -> service.saveIngredientLine(line))
            .isInstanceOf(CircularReferenceException.class)
            .hasMessageContaining("Cannot add recipe as a sub-recipe of itself");
        
        // Should fail before reaching repository
        verify(recipeRepository, never()).existsCircularReference(any(), any());
        verify(recipeIngredientLineRepository, never()).save(any());
    }
    
    @Test
    void saveIngredientLine_TransitiveCircularReference_ThrowsCircularReferenceException() {
        // Given - line that would create transitive circular reference
        // Example: A -> B -> C, trying to add A as sub-recipe of C
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setRecipeId(parentRecipeId);
        line.setSubRecipeId(subRecipeId);
        line.setQuantityUsed(new BigDecimal("1.0"));
        line.setUnitOfMeasure(UomEnum.EACH);
        
        when(recipeRepository.existsCircularReference(parentRecipeId, subRecipeId))
            .thenReturn(true); // CTE detects circular reference
        
        // When/Then - Requirement 2.4
        assertThatThrownBy(() -> service.saveIngredientLine(line))
            .isInstanceOf(CircularReferenceException.class)
            .hasMessageContaining("would create a circular reference");
        
        verify(recipeRepository).existsCircularReference(parentRecipeId, subRecipeId);
        verify(recipeIngredientLineRepository, never()).save(any());
    }
    
    @Test
    void validateNoCircularReference_NoCircle_PassesValidation() {
        // Given - valid sub-recipe addition
        when(recipeRepository.existsCircularReference(parentRecipeId, subRecipeId))
            .thenReturn(false);
        
        // When/Then - should not throw
        assertThatCode(() -> service.validateNoCircularReference(parentRecipeId, subRecipeId))
            .doesNotThrowAnyException();
        
        verify(recipeRepository).existsCircularReference(parentRecipeId, subRecipeId);
    }
    
    @Test
    void validateNoCircularReference_CircleDetected_ThrowsException() {
        // Given - circular reference detected by CTE
        when(recipeRepository.existsCircularReference(parentRecipeId, subRecipeId))
            .thenReturn(true);
        
        // When/Then - Requirement 2.4
        assertThatThrownBy(() -> 
            service.validateNoCircularReference(parentRecipeId, subRecipeId))
            .isInstanceOf(CircularReferenceException.class)
            .hasMessageContaining("would create a circular reference");
    }
    
    @Test
    void validateNoCircularReference_SelfReference_ThrowsException() {
        // Given - same recipe ID for parent and candidate
        UUID sameId = UUID.randomUUID();
        
        // When/Then - Requirement 2.4
        assertThatThrownBy(() -> 
            service.validateNoCircularReference(sameId, sameId))
            .isInstanceOf(CircularReferenceException.class)
            .hasMessageContaining("Cannot add recipe as a sub-recipe of itself");
        
        // Should not call repository for direct self-reference
        verify(recipeRepository, never()).existsCircularReference(any(), any());
    }
    
    @Test
    void getIngredientLines_ReturnsLinesForRecipe() {
        // Given
        when(recipeIngredientLineRepository.findByRecipeId(parentRecipeId))
            .thenReturn(java.util.List.of(new RecipeIngredientLine()));
        
        // When
        var result = service.getIngredientLines(parentRecipeId);
        
        // Then
        assertThat(result).isNotNull();
        verify(recipeIngredientLineRepository).findByRecipeId(parentRecipeId);
    }
    
    @Test
    void deleteIngredientLine_DeletesSuccessfully() {
        // Given
        UUID lineId = UUID.randomUUID();
        
        // When
        service.deleteIngredientLine(lineId);
        
        // Then
        verify(recipeIngredientLineRepository).deleteById(lineId);
    }
}
