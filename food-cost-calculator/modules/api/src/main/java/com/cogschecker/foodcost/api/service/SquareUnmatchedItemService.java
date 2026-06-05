package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.SquareUnmatchedItem;
import com.cogschecker.foodcost.api.dto.SquareUnmatchedItemResponse;
import com.cogschecker.foodcost.api.dto.UpdateUnmatchedItemRequest;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.exception.ValidationException;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SquareUnmatchedItemRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for managing Square unmatched items.
 * Requirements: 12.4 (Square sync - unmatched item management)
 */
@Service
public class SquareUnmatchedItemService {
    
    private static final Logger logger = LoggerFactory.getLogger(SquareUnmatchedItemService.class);
    
    private final SquareUnmatchedItemRepository unmatchedItemRepository;
    private final RecipeRepository recipeRepository;
    
    public SquareUnmatchedItemService(
            SquareUnmatchedItemRepository unmatchedItemRepository,
            RecipeRepository recipeRepository) {
        this.unmatchedItemRepository = unmatchedItemRepository;
        this.recipeRepository = recipeRepository;
    }
    
    /**
     * Get all unmatched items for a venue.
     * Requirements: 12.4
     * 
     * @param venueId the venue ID
     * @return list of unmatched items
     */
    @Transactional(readOnly = true)
    public List<SquareUnmatchedItemResponse> getUnmatchedItems(UUID venueId) {
        logger.info("Fetching unmatched items for venue {}", venueId);
        
        List<SquareUnmatchedItem> items = unmatchedItemRepository.findByVenueId(venueId);
        
        return items.stream()
                .map(this::toResponse)
                .collect(Collectors.toList());
    }
    
    /**
     * Update an unmatched item (map to recipe or dismiss).
     * Requirements: 12.4
     * 
     * @param venueId the venue ID
     * @param unmatchedItemId the unmatched item ID
     * @param request the update request
     * @return updated unmatched item response
     */
    @Transactional
    public SquareUnmatchedItemResponse updateUnmatchedItem(
            UUID venueId, 
            UUID unmatchedItemId, 
            UpdateUnmatchedItemRequest request) {
        
        logger.info("Updating unmatched item {} for venue {}", unmatchedItemId, venueId);
        
        // Find the unmatched item
        SquareUnmatchedItem item = unmatchedItemRepository.findById(unmatchedItemId)
                .orElseThrow(() -> new ResourceNotFoundException("UNMATCHED_ITEM_NOT_FOUND", "Unmatched item not found"));
        
        // Verify it belongs to the venue
        if (!item.getVenueId().equals(venueId)) {
            throw new ResourceNotFoundException("UNMATCHED_ITEM_NOT_FOUND", "Unmatched item not found in this venue");
        }
        
        // Validate status
        String status = request.status().toUpperCase();
        if (!status.equals("MAPPED") && !status.equals("DISMISSED")) {
            throw new ValidationException("INVALID_STATUS", "Status must be 'mapped' or 'dismissed'");
        }
        
        // If mapping, validate recipe exists and belongs to the venue
        if (status.equals("MAPPED")) {
            if (request.mappedRecipeId() == null) {
                throw new ValidationException("MAPPED_RECIPE_REQUIRED", "mappedRecipeId is required when status is 'mapped'");
            }
            
            Recipe recipe = recipeRepository.findById(request.mappedRecipeId())
                    .orElseThrow(() -> new ResourceNotFoundException("RECIPE_NOT_FOUND", "Recipe not found"));
            
            if (!recipe.getVenueId().equals(venueId)) {
                throw new ValidationException("RECIPE_WRONG_VENUE", "Recipe does not belong to this venue");
            }
            
            item.setStatus(SquareUnmatchedItem.UnmatchedStatus.MAPPED);
            item.setMappedRecipeId(request.mappedRecipeId());
            
            logger.info("Mapped unmatched item {} to recipe {}", unmatchedItemId, request.mappedRecipeId());
        } else {
            item.setStatus(SquareUnmatchedItem.UnmatchedStatus.DISMISSED);
            item.setMappedRecipeId(null);
            
            logger.info("Dismissed unmatched item {}", unmatchedItemId);
        }
        
        SquareUnmatchedItem saved = unmatchedItemRepository.save(item);
        return toResponse(saved);
    }
    
    /**
     * Convert entity to response DTO.
     */
    private SquareUnmatchedItemResponse toResponse(SquareUnmatchedItem item) {
        return new SquareUnmatchedItemResponse(
                item.getId(),
                item.getVenueId(),
                item.getSquareItemName(),
                item.getSquareItemPrice(),
                item.getStatus().name(),
                item.getMappedRecipeId()
        );
    }
}
