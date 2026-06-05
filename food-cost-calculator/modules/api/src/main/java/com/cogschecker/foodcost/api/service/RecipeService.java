package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.exception.*;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.ErrorCodes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for managing recipes with business rule enforcement.
 * Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12
 */
@Service
@Transactional
public class RecipeService {
    
    private static final Logger logger = LoggerFactory.getLogger(RecipeService.class);
    
    private static final int MAX_INGREDIENT_LINES = 200;
    private static final int MIN_PORTION_COUNT = 1;
    private static final int MAX_PORTION_COUNT = 9999;
    private static final int FREE_TIER_RECIPE_LIMIT = 25;
    
    private final RecipeRepository recipeRepository;
    private final RecipeIngredientLineRepository recipeIngredientLineRepository;
    
    public RecipeService(
            RecipeRepository recipeRepository,
            RecipeIngredientLineRepository recipeIngredientLineRepository) {
        this.recipeRepository = recipeRepository;
        this.recipeIngredientLineRepository = recipeIngredientLineRepository;
    }
    
    /**
     * Create a new recipe with validation.
     * Requirements: 2.1, 2.10, 2.11, 2.12
     * 
     * @param venueId the venue ID
     * @param name the recipe name (1-100 non-whitespace characters)
     * @param portionCount the portion count (1-9999 inclusive)
     * @param ingredientLines the ingredient lines (up to 200)
     * @param isFreeTier whether the venue is on the free tier
     * @return the created recipe
     * @throws ValidationException if validation fails
     * @throws DuplicateResourceException if name already exists (case-insensitive)
     * @throws TierLimitExceededException if free tier limit is exceeded
     */
    public Recipe createRecipe(
            UUID venueId,
            String name,
            Integer portionCount,
            List<RecipeIngredientLine> ingredientLines,
            boolean isFreeTier) {
        
        logger.info("Creating recipe '{}' for venue {}", name, venueId);
        
        // Validate all fields and collect errors - Requirements 2.10, 2.11
        Map<String, String> validationErrors = new LinkedHashMap<>();
        validateRecipeFields(name, portionCount, ingredientLines, validationErrors);
        
        if (!validationErrors.isEmpty()) {
            String errorMessage = "Recipe validation failed: " + 
                validationErrors.values().stream().collect(Collectors.joining(", "));
            throw new ValidationException(
                ErrorCodes.VALIDATION_CONSTRAINT_VIOLATION,
                errorMessage,
                new HashMap<>(validationErrors)
            );
        }
        
        // Check for duplicate name (case-insensitive)
        if (recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)) {
            throw new DuplicateResourceException(
                ErrorCodes.RECIPE_DUPLICATE_NAME,
                String.format("A recipe with the name '%s' already exists in this venue", name)
            );
        }
        
        // Check free tier limit - Requirement 2.12
        if (isFreeTier) {
            long currentCount = recipeRepository.countByVenueId(venueId);
            if (currentCount >= FREE_TIER_RECIPE_LIMIT) {
                throw new TierLimitExceededException(
                    String.format("Free tier limit of %d recipes per venue exceeded. " +
                        "Please upgrade to Pro or delete an existing recipe.", FREE_TIER_RECIPE_LIMIT)
                );
            }
        }
        
        // Create recipe
        Recipe recipe = new Recipe();
        recipe.setVenueId(venueId);
        recipe.setName(name.trim());
        recipe.setPortionCount(portionCount);
        recipe.setCreatedAt(Instant.now());
        recipe.setUpdatedAt(Instant.now());
        
        // Initialize cost fields to zero
        recipe.setTotalBatchCost(BigDecimal.ZERO);
        recipe.setFoodCostPerPortion(BigDecimal.ZERO);
        
        Recipe saved = recipeRepository.save(recipe);
        logger.info("Created recipe {} with ID {}", saved.getName(), saved.getId());
        
        return saved;
    }
    
    /**
     * Get a recipe by ID.
     * Requirement 2.5
     * 
     * @param venueId the venue ID
     * @param recipeId the recipe ID
     * @return the recipe
     * @throws ResourceNotFoundException if not found
     */
    @Transactional(readOnly = true)
    public Recipe getRecipe(UUID venueId, UUID recipeId) {
        return recipeRepository.findByVenueIdAndId(venueId, recipeId)
            .orElseThrow(() -> new ResourceNotFoundException(
                ErrorCodes.RECIPE_NOT_FOUND,
                String.format("Recipe with ID %s not found in venue %s", recipeId, venueId)
            ));
    }
    
    /**
     * Get all recipes for a venue.
     * 
     * @param venueId the venue ID
     * @return list of recipes
     */
    @Transactional(readOnly = true)
    public List<Recipe> getAllRecipes(UUID venueId) {
        return recipeRepository.findByVenueId(venueId);
    }
    
    /**
     * Update an existing recipe.
     * Requirements: 2.5, 2.10, 2.11
     * 
     * @param venueId the venue ID
     * @param recipeId the recipe ID
     * @param name the new name (optional)
     * @param portionCount the new portion count (optional)
     * @param menuSellingPrice the new menu selling price (optional)
     * @return the updated recipe
     * @throws ValidationException if validation fails
     * @throws DuplicateResourceException if name already exists
     */
    public Recipe updateRecipe(
            UUID venueId,
            UUID recipeId,
            String name,
            Integer portionCount,
            BigDecimal menuSellingPrice) {
        
        logger.info("Updating recipe {} for venue {}", recipeId, venueId);
        
        Recipe recipe = getRecipe(venueId, recipeId);
        
        // Collect validation errors
        Map<String, String> validationErrors = new LinkedHashMap<>();
        
        // Update and validate name if provided
        if (name != null) {
            validateName(name, validationErrors);
            if (validationErrors.isEmpty() && !name.trim().equals(recipe.getName())) {
                // Check for duplicate name (case-insensitive)
                if (recipeRepository.existsByVenueIdAndNameIgnoreCaseExcludingId(venueId, name.trim(), recipeId)) {
                    throw new DuplicateResourceException(
                        ErrorCodes.RECIPE_DUPLICATE_NAME,
                        String.format("A recipe with the name '%s' already exists in this venue", name.trim())
                    );
                }
                recipe.setName(name.trim());
            }
        }
        
        // Update and validate portion count if provided
        if (portionCount != null) {
            validatePortionCount(portionCount, validationErrors);
            if (validationErrors.isEmpty()) {
                recipe.setPortionCount(portionCount);
            }
        }
        
        // Update menu selling price if provided
        if (menuSellingPrice != null) {
            recipe.setMenuSellingPrice(menuSellingPrice);
        }
        
        // Throw validation exception if any errors collected
        if (!validationErrors.isEmpty()) {
            String errorMessage = "Recipe validation failed: " + 
                validationErrors.values().stream().collect(Collectors.joining(", "));
            throw new ValidationException(
                ErrorCodes.VALIDATION_CONSTRAINT_VIOLATION,
                errorMessage,
                new HashMap<>(validationErrors)
            );
        }
        
        recipe.setUpdatedAt(Instant.now());
        
        Recipe updated = recipeRepository.save(recipe);
        logger.info("Updated recipe {} ({})", updated.getId(), updated.getName());
        
        return updated;
    }
    
    /**
     * Duplicate a recipe with "Copy of " prefix.
     * Requirement 2.6
     * 
     * @param venueId the venue ID
     * @param sourceRecipeId the recipe to duplicate
     * @param isFreeTier whether the venue is on the free tier
     * @return the duplicated recipe
     * @throws TierLimitExceededException if free tier limit is exceeded
     */
    public Recipe duplicateRecipe(UUID venueId, UUID sourceRecipeId, boolean isFreeTier) {
        logger.info("Duplicating recipe {} for venue {}", sourceRecipeId, venueId);
        
        Recipe source = getRecipe(venueId, sourceRecipeId);
        
        // Check free tier limit - Requirement 2.12
        if (isFreeTier) {
            long currentCount = recipeRepository.countByVenueId(venueId);
            if (currentCount >= FREE_TIER_RECIPE_LIMIT) {
                throw new TierLimitExceededException(
                    String.format("Free tier limit of %d recipes per venue exceeded. " +
                        "Please upgrade to Pro or delete an existing recipe.", FREE_TIER_RECIPE_LIMIT)
                );
            }
        }
        
        // Create duplicate with "Copy of " prefix
        String newName = "Copy of " + source.getName();
        
        // If the name would exceed 100 characters, truncate the original name
        if (newName.length() > 100) {
            int maxOriginalLength = 100 - "Copy of ".length();
            newName = "Copy of " + source.getName().substring(0, maxOriginalLength);
        }
        
        // If a recipe with this name already exists, append a number
        String finalName = newName;
        int counter = 1;
        while (recipeRepository.existsByVenueIdAndNameIgnoreCase(venueId, finalName)) {
            String suffix = " (" + counter + ")";
            if ((newName + suffix).length() <= 100) {
                finalName = newName + suffix;
            } else {
                // Truncate further to make room for the suffix
                int maxLength = 100 - suffix.length() - "Copy of ".length();
                finalName = "Copy of " + source.getName().substring(0, maxLength) + suffix;
            }
            counter++;
        }
        
        // Create the duplicate recipe
        Recipe duplicate = new Recipe();
        duplicate.setVenueId(venueId);
        duplicate.setName(finalName);
        duplicate.setPortionCount(source.getPortionCount());
        duplicate.setMenuSellingPrice(source.getMenuSellingPrice());
        duplicate.setTotalBatchCost(source.getTotalBatchCost());
        duplicate.setFoodCostPerPortion(source.getFoodCostPerPortion());
        duplicate.setFoodCostPercentage(source.getFoodCostPercentage());
        duplicate.setCreatedAt(Instant.now());
        duplicate.setUpdatedAt(Instant.now());
        
        Recipe saved = recipeRepository.save(duplicate);
        logger.info("Duplicated recipe {} -> {} with ID {}", sourceRecipeId, saved.getName(), saved.getId());
        
        // Note: Ingredient lines copying would be handled by a separate method
        // as it requires the RecipeIngredientLine entities to be created
        
        return saved;
    }
    
    /**
     * Delete a recipe.
     * Requirement 2.7, 2.8
     * 
     * @param venueId the venue ID
     * @param recipeId the recipe ID
     * @param confirmed whether the user has confirmed deletion after seeing the warning
     * @throws DeleteConflictException if recipe is used as sub-recipe and not confirmed
     */
    public void deleteRecipe(UUID venueId, UUID recipeId, boolean confirmed) {
        logger.info("Deleting recipe {} for venue {} (confirmed: {})", recipeId, venueId, confirmed);
        
        Recipe recipe = getRecipe(venueId, recipeId);
        
        // Check if recipe is used as a sub-recipe - Requirement 2.8
        List<String> affectedRecipes = recipeRepository.findParentRecipeNamesBySubRecipeId(recipeId);
        
        if (!affectedRecipes.isEmpty()) {
            if (!confirmed) {
                // Throw exception with affected recipe names - requires confirmation
                throw new DeleteConflictException(
                    ErrorCodes.RECIPE_IN_USE_AS_SUBRECIPE,
                    String.format("Recipe '%s' is used as a sub-recipe in %d recipe(s). Deletion requires confirmation.",
                        recipe.getName(), affectedRecipes.size()),
                    affectedRecipes
                );
            }
            logger.warn("Deleting recipe {} which is used as sub-recipe in {} recipes (user confirmed)",
                recipeId, affectedRecipes.size());
        }
        
        recipeRepository.delete(recipe);
        logger.info("Deleted recipe {} ({})", recipeId, recipe.getName());
    }
    
    /**
     * Search recipes by name (case-insensitive partial match).
     * Requirement 2.9
     * 
     * @param venueId the venue ID
     * @param nameQuery the search query
     * @return list of matching recipes
     */
    @Transactional(readOnly = true)
    public List<Recipe> searchRecipes(UUID venueId, String nameQuery) {
        logger.debug("Searching recipes in venue {} with query '{}'", venueId, nameQuery);
        
        if (nameQuery == null || nameQuery.trim().isEmpty()) {
            return getAllRecipes(venueId);
        }
        
        return recipeRepository.findByVenueIdAndNameContainingIgnoreCase(venueId, nameQuery);
    }
    
    // Private helper methods
    
    /**
     * Validate all recipe fields and collect errors.
     * Requirements 2.10, 2.11
     */
    private void validateRecipeFields(
            String name,
            Integer portionCount,
            List<RecipeIngredientLine> ingredientLines,
            Map<String, String> errors) {
        
        validateName(name, errors);
        validatePortionCount(portionCount, errors);
        validateIngredientLines(ingredientLines, errors);
    }
    
    /**
     * Validate recipe name.
     * Requirement 2.10 - non-empty and non-whitespace
     */
    private void validateName(String name, Map<String, String> errors) {
        if (name == null || name.trim().isEmpty()) {
            errors.put("name", "Recipe name cannot be empty or whitespace");
            return;
        }
        
        if (name.trim().length() > 100) {
            errors.put("name", "Recipe name cannot exceed 100 characters");
        }
    }
    
    /**
     * Validate portion count.
     * Requirement 2.10 - between 1 and 9999 inclusive
     */
    private void validatePortionCount(Integer portionCount, Map<String, String> errors) {
        if (portionCount == null) {
            errors.put("portionCount", "Portion count is required");
            return;
        }
        
        if (portionCount < MIN_PORTION_COUNT || portionCount > MAX_PORTION_COUNT) {
            errors.put("portionCount", 
                String.format("Portion count must be between %d and %d", MIN_PORTION_COUNT, MAX_PORTION_COUNT));
        }
    }
    
    /**
     * Validate ingredient lines.
     * Requirement 2.1 - up to 200 lines
     * Requirement 2.10 - all quantities > 0
     */
    private void validateIngredientLines(List<RecipeIngredientLine> ingredientLines, Map<String, String> errors) {
        if (ingredientLines == null) {
            return; // Ingredient lines are optional during creation
        }
        
        if (ingredientLines.size() > MAX_INGREDIENT_LINES) {
            errors.put("ingredientLines", 
                String.format("Recipe cannot have more than %d ingredient lines", MAX_INGREDIENT_LINES));
        }
        
        // Validate all quantities > 0 - Requirement 2.10
        for (int i = 0; i < ingredientLines.size(); i++) {
            RecipeIngredientLine line = ingredientLines.get(i);
            if (line.getQuantityUsed() == null || line.getQuantityUsed().compareTo(BigDecimal.ZERO) <= 0) {
                errors.put("ingredientLines[" + i + "].quantityUsed", 
                    "Ingredient line quantity must be greater than 0");
            }
        }
    }
}
