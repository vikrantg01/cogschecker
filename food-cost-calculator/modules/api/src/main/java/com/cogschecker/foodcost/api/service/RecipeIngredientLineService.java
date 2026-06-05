package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.exception.CircularReferenceException;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Service for managing recipe ingredient lines with circular reference detection.
 * Requirements: 2.2, 2.3, 2.4
 */
@Service
@Transactional
public class RecipeIngredientLineService {
    
    private static final Logger logger = LoggerFactory.getLogger(RecipeIngredientLineService.class);
    
    private final RecipeIngredientLineRepository recipeIngredientLineRepository;
    private final RecipeRepository recipeRepository;
    
    public RecipeIngredientLineService(
            RecipeIngredientLineRepository recipeIngredientLineRepository,
            RecipeRepository recipeRepository) {
        this.recipeIngredientLineRepository = recipeIngredientLineRepository;
        this.recipeRepository = recipeRepository;
    }
    
    /**
     * Create or update a recipe ingredient line.
     * If the line contains a sub-recipe, validates that adding it won't create a circular reference.
     * Requirements: 2.3, 2.4
     * 
     * @param line the ingredient line to save
     * @return the saved ingredient line
     * @throws CircularReferenceException if adding this line would create a circular reference
     */
    public RecipeIngredientLine saveIngredientLine(RecipeIngredientLine line) {
        // Check for circular reference if this line references a sub-recipe
        if (line.getSubRecipeId() != null) {
            validateNoCircularReference(line.getRecipeId(), line.getSubRecipeId());
        }
        
        // Set timestamps
        if (line.getId() == null) {
            line.setCreatedAt(Instant.now());
        }
        line.setUpdatedAt(Instant.now());
        
        return recipeIngredientLineRepository.save(line);
    }
    
    /**
     * Validate that adding candidateSubRecipeId as a sub-recipe to parentRecipeId 
     * would not create a circular reference.
     * Requirements: 2.3, 2.4
     * 
     * @param parentRecipeId the recipe that will contain the sub-recipe
     * @param candidateSubRecipeId the sub-recipe being added
     * @throws CircularReferenceException if a circular reference would be created
     */
    public void validateNoCircularReference(UUID parentRecipeId, UUID candidateSubRecipeId) {
        logger.debug("Checking circular reference: parent={}, candidate={}", parentRecipeId, candidateSubRecipeId);
        
        // Direct self-reference check
        if (parentRecipeId.equals(candidateSubRecipeId)) {
            throw new CircularReferenceException(
                String.format("Cannot add recipe as a sub-recipe of itself (recipe ID: %s)", parentRecipeId)
            );
        }
        
        // Use recursive CTE to check for transitive circular references
        boolean wouldCreateCycle = recipeRepository.existsCircularReference(parentRecipeId, candidateSubRecipeId);
        
        if (wouldCreateCycle) {
            throw new CircularReferenceException(
                String.format("Adding sub-recipe %s to recipe %s would create a circular reference", 
                    candidateSubRecipeId, parentRecipeId)
            );
        }
        
        logger.debug("No circular reference detected");
    }
    
    /**
     * Get all ingredient lines for a recipe.
     * 
     * @param recipeId the recipe ID
     * @return list of ingredient lines
     */
    @Transactional(readOnly = true)
    public List<RecipeIngredientLine> getIngredientLines(UUID recipeId) {
        return recipeIngredientLineRepository.findByRecipeId(recipeId);
    }
    
    /**
     * Delete an ingredient line.
     * 
     * @param lineId the line ID to delete
     */
    public void deleteIngredientLine(UUID lineId) {
        recipeIngredientLineRepository.deleteById(lineId);
        logger.info("Deleted ingredient line {}", lineId);
    }
}
