package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.SquareUnmatchedItem;
import com.cogschecker.foodcost.api.dto.SquareUnmatchedItemResponse;
import com.cogschecker.foodcost.api.dto.UpdateUnmatchedItemRequest;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.exception.ValidationException;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SquareUnmatchedItemRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
 * Unit tests for SquareUnmatchedItemService.
 * Requirements: 12.4 (Square sync - unmatched item management)
 */
@ExtendWith(MockitoExtension.class)
class SquareUnmatchedItemServiceTest {
    
    @Mock
    private SquareUnmatchedItemRepository unmatchedItemRepository;
    
    @Mock
    private RecipeRepository recipeRepository;
    
    @InjectMocks
    private SquareUnmatchedItemService service;
    
    private UUID venueId;
    private UUID unmatchedItemId;
    private UUID recipeId;
    private SquareUnmatchedItem unmatchedItem;
    private Recipe recipe;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        unmatchedItemId = UUID.randomUUID();
        recipeId = UUID.randomUUID();
        
        unmatchedItem = new SquareUnmatchedItem(venueId, "Latte", new BigDecimal("4.50"));
        unmatchedItem.setId(unmatchedItemId);
        
        recipe = new Recipe();
        recipe.setId(recipeId);
        recipe.setVenueId(venueId);
        recipe.setName("Latte Recipe");
    }
    
    @Test
    void getUnmatchedItems_success() {
        // Arrange
        SquareUnmatchedItem item1 = new SquareUnmatchedItem(venueId, "Latte", new BigDecimal("4.50"));
        item1.setId(UUID.randomUUID());
        
        SquareUnmatchedItem item2 = new SquareUnmatchedItem(venueId, "Cappuccino", new BigDecimal("4.25"));
        item2.setId(UUID.randomUUID());
        
        when(unmatchedItemRepository.findByVenueId(venueId)).thenReturn(List.of(item1, item2));
        
        // Act
        List<SquareUnmatchedItemResponse> result = service.getUnmatchedItems(venueId);
        
        // Assert
        assertThat(result).hasSize(2);
        assertThat(result.get(0).squareItemName()).isEqualTo("Latte");
        assertThat(result.get(1).squareItemName()).isEqualTo("Cappuccino");
        verify(unmatchedItemRepository, times(1)).findByVenueId(venueId);
    }
    
    @Test
    void updateUnmatchedItem_mapToRecipe_success() {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("mapped", recipeId);
        
        when(unmatchedItemRepository.findById(unmatchedItemId)).thenReturn(Optional.of(unmatchedItem));
        when(recipeRepository.findById(recipeId)).thenReturn(Optional.of(recipe));
        when(unmatchedItemRepository.save(any(SquareUnmatchedItem.class))).thenAnswer(inv -> inv.getArgument(0));
        
        // Act
        SquareUnmatchedItemResponse result = service.updateUnmatchedItem(venueId, unmatchedItemId, request);
        
        // Assert
        assertThat(result.status()).isEqualTo("MAPPED");
        assertThat(result.mappedRecipeId()).isEqualTo(recipeId);
        verify(unmatchedItemRepository, times(1)).save(any(SquareUnmatchedItem.class));
    }
    
    @Test
    void updateUnmatchedItem_dismiss_success() {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("dismissed", null);
        
        when(unmatchedItemRepository.findById(unmatchedItemId)).thenReturn(Optional.of(unmatchedItem));
        when(unmatchedItemRepository.save(any(SquareUnmatchedItem.class))).thenAnswer(inv -> inv.getArgument(0));
        
        // Act
        SquareUnmatchedItemResponse result = service.updateUnmatchedItem(venueId, unmatchedItemId, request);
        
        // Assert
        assertThat(result.status()).isEqualTo("DISMISSED");
        assertThat(result.mappedRecipeId()).isNull();
        verify(unmatchedItemRepository, times(1)).save(any(SquareUnmatchedItem.class));
    }
    
    @Test
    void updateUnmatchedItem_unmatchedItemNotFound_throwsException() {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("mapped", recipeId);
        
        when(unmatchedItemRepository.findById(unmatchedItemId)).thenReturn(Optional.empty());
        
        // Act & Assert
        assertThatThrownBy(() -> service.updateUnmatchedItem(venueId, unmatchedItemId, request))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Unmatched item not found");
    }
    
    @Test
    void updateUnmatchedItem_wrongVenue_throwsException() {
        // Arrange
        UUID wrongVenueId = UUID.randomUUID();
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("mapped", recipeId);
        
        when(unmatchedItemRepository.findById(unmatchedItemId)).thenReturn(Optional.of(unmatchedItem));
        
        // Act & Assert
        assertThatThrownBy(() -> service.updateUnmatchedItem(wrongVenueId, unmatchedItemId, request))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("not found in this venue");
    }
    
    @Test
    void updateUnmatchedItem_invalidStatus_throwsException() {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("invalid", null);
        
        when(unmatchedItemRepository.findById(unmatchedItemId)).thenReturn(Optional.of(unmatchedItem));
        
        // Act & Assert
        assertThatThrownBy(() -> service.updateUnmatchedItem(venueId, unmatchedItemId, request))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("mapped");
    }
    
    @Test
    void updateUnmatchedItem_mapWithoutRecipeId_throwsException() {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("mapped", null);
        
        when(unmatchedItemRepository.findById(unmatchedItemId)).thenReturn(Optional.of(unmatchedItem));
        
        // Act & Assert
        assertThatThrownBy(() -> service.updateUnmatchedItem(venueId, unmatchedItemId, request))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("mappedRecipeId is required");
    }
    
    @Test
    void updateUnmatchedItem_recipeNotFound_throwsException() {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("mapped", recipeId);
        
        when(unmatchedItemRepository.findById(unmatchedItemId)).thenReturn(Optional.of(unmatchedItem));
        when(recipeRepository.findById(recipeId)).thenReturn(Optional.empty());
        
        // Act & Assert
        assertThatThrownBy(() -> service.updateUnmatchedItem(venueId, unmatchedItemId, request))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageContaining("Recipe not found");
    }
    
    @Test
    void updateUnmatchedItem_recipeWrongVenue_throwsException() {
        // Arrange
        UUID wrongVenueId = UUID.randomUUID();
        recipe.setVenueId(wrongVenueId);
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("mapped", recipeId);
        
        when(unmatchedItemRepository.findById(unmatchedItemId)).thenReturn(Optional.of(unmatchedItem));
        when(recipeRepository.findById(recipeId)).thenReturn(Optional.of(recipe));
        
        // Act & Assert
        assertThatThrownBy(() -> service.updateUnmatchedItem(venueId, unmatchedItemId, request))
                .isInstanceOf(ValidationException.class)
                .hasMessageContaining("does not belong to this venue");
    }
}
