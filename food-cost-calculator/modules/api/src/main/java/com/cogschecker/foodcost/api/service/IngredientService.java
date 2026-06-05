package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.exception.DeleteConflictException;
import com.cogschecker.foodcost.api.exception.DuplicateResourceException;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.shared.CostCalculator;
import com.cogschecker.foodcost.shared.ErrorCodes;
import com.cogschecker.foodcost.shared.UomEnum;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Service for managing ingredients with business rule enforcement.
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
 */
@Service
@Transactional
public class IngredientService {
    
    private static final Logger logger = LoggerFactory.getLogger(IngredientService.class);
    
    private final IngredientRepository ingredientRepository;
    private final RecipeIngredientLineRepository recipeIngredientLineRepository;
    private final CostPropagationService costPropagationService;
    
    public IngredientService(
            IngredientRepository ingredientRepository,
            RecipeIngredientLineRepository recipeIngredientLineRepository,
            CostPropagationService costPropagationService) {
        this.ingredientRepository = ingredientRepository;
        this.recipeIngredientLineRepository = recipeIngredientLineRepository;
        this.costPropagationService = costPropagationService;
    }
    
    /**
     * Create a new ingredient.
     * Requirements: 1.1, 1.2, 1.5, 1.10
     * 
     * @param venueId the venue ID
     * @param name the ingredient name (1-100 characters)
     * @param purchasePrice the purchase price (> 0)
     * @param purchaseQuantity the purchase quantity (> 0)
     * @param unitOfMeasure the unit of measure
     * @param yieldPercentage the yield percentage (1-100, default 100)
     * @return the created ingredient with computed cost fields
     */
    public Ingredient createIngredient(
            UUID venueId,
            String name,
            BigDecimal purchasePrice,
            BigDecimal purchaseQuantity,
            UomEnum unitOfMeasure,
            BigDecimal yieldPercentage) {
        
        logger.info("Creating ingredient '{}' for venue {}", name, venueId);
        
        // Validate inputs
        validateIngredientInputs(name, purchasePrice, purchaseQuantity, yieldPercentage);
        
        // Check for duplicate name (case-insensitive) - Requirement 1.10
        if (ingredientRepository.existsByVenueIdAndNameIgnoreCase(venueId, name)) {
            throw new DuplicateResourceException(
                ErrorCodes.INGREDIENT_DUPLICATE_NAME,
                String.format("An ingredient with the name '%s' already exists in this venue", name)
            );
        }
        
        // Create ingredient
        Ingredient ingredient = new Ingredient(
            venueId,
            name,
            purchasePrice,
            purchaseQuantity,
            unitOfMeasure,
            yieldPercentage != null ? yieldPercentage : new BigDecimal("100.00")
        );
        
        // Calculate and persist computed cost fields - Requirements 1.2, 1.5
        calculateAndSetCostFields(ingredient);
        
        Ingredient saved = ingredientRepository.save(ingredient);
        logger.info("Created ingredient {} with ID {}", saved.getName(), saved.getId());
        
        return saved;
    }
    
    /**
     * Get an ingredient by ID.
     * Requirement 1.6
     * 
     * @param venueId the venue ID
     * @param ingredientId the ingredient ID
     * @return the ingredient
     * @throws ResourceNotFoundException if not found
     */
    @Transactional(readOnly = true)
    public Ingredient getIngredient(UUID venueId, UUID ingredientId) {
        return ingredientRepository.findByVenueIdAndId(venueId, ingredientId)
            .orElseThrow(() -> new ResourceNotFoundException(
                ErrorCodes.INGREDIENT_NOT_FOUND,
                String.format("Ingredient with ID %s not found in venue %s", ingredientId, venueId)
            ));
    }
    
    /**
     * Get all ingredients for a venue.
     * 
     * @param venueId the venue ID
     * @return list of ingredients
     */
    @Transactional(readOnly = true)
    public List<Ingredient> getAllIngredients(UUID venueId) {
        return ingredientRepository.findByVenueId(venueId);
    }
    
    /**
     * Update an existing ingredient.
     * Requirements: 1.2, 1.3, 1.5, 1.6, 1.10
     * 
     * @param venueId the venue ID
     * @param ingredientId the ingredient ID
     * @param name the new name (optional)
     * @param purchasePrice the new purchase price (optional)
     * @param purchaseQuantity the new purchase quantity (optional)
     * @param unitOfMeasure the new unit of measure (optional)
     * @param yieldPercentage the new yield percentage (optional)
     * @return the updated ingredient with recalculated cost fields
     */
    public Ingredient updateIngredient(
            UUID venueId,
            UUID ingredientId,
            String name,
            BigDecimal purchasePrice,
            BigDecimal purchaseQuantity,
            UomEnum unitOfMeasure,
            BigDecimal yieldPercentage) {
        
        logger.info("Updating ingredient {} for venue {}", ingredientId, venueId);
        
        Ingredient ingredient = getIngredient(venueId, ingredientId);
        
        // Track whether cost-affecting fields are being updated - Requirement 3.3
        boolean needsCostPropagation = false;
        
        // Update fields if provided
        if (name != null && !name.equals(ingredient.getName())) {
            // Check for duplicate name (case-insensitive) - Requirement 1.10
            if (ingredientRepository.existsByVenueIdAndNameIgnoreCaseExcludingId(venueId, name, ingredientId)) {
                throw new DuplicateResourceException(
                    ErrorCodes.INGREDIENT_DUPLICATE_NAME,
                    String.format("An ingredient with the name '%s' already exists in this venue", name)
                );
            }
            ingredient.setName(name);
        }
        
        if (purchasePrice != null) {
            validatePositive(purchasePrice, "Purchase price");
            ingredient.setPurchasePrice(purchasePrice);
            needsCostPropagation = true; // Requirement 3.3
        }
        
        if (purchaseQuantity != null) {
            validatePositive(purchaseQuantity, "Purchase quantity");
            ingredient.setPurchaseQuantity(purchaseQuantity);
            needsCostPropagation = true; // Requirement 3.3
        }
        
        if (unitOfMeasure != null) {
            ingredient.setUnitOfMeasure(unitOfMeasure);
        }
        
        if (yieldPercentage != null) {
            validateYieldPercentage(yieldPercentage);
            ingredient.setYieldPercentage(yieldPercentage);
            needsCostPropagation = true; // Requirement 3.3
        }
        
        // Recalculate cost fields - Requirements 1.2, 1.3, 1.5
        calculateAndSetCostFields(ingredient);
        
        Ingredient updated = ingredientRepository.save(ingredient);
        logger.info("Updated ingredient {} - new costPerUnit: {}, effectiveCostPerUsableUnit: {}", 
            updated.getId(), updated.getCostPerUnit(), updated.getEffectiveCostPerUsableUnit());
        
        // Trigger async cost propagation if price, quantity, or yield changed - Requirements 1.3, 3.3
        if (needsCostPropagation) {
            costPropagationService.enqueue(venueId, ingredientId);
            logger.info("Triggered cost propagation for ingredient {}", ingredientId);
        }
        
        return updated;
    }
    
    /**
     * Delete an ingredient.
     * Requirement 1.7, 1.8
     * 
     * @param venueId the venue ID
     * @param ingredientId the ingredient ID
     * @param confirmed whether the user has confirmed deletion after seeing the warning
     * @throws DeleteConflictException if ingredient is referenced by recipes and not confirmed
     */
    public void deleteIngredient(UUID venueId, UUID ingredientId, boolean confirmed) {
        logger.info("Deleting ingredient {} for venue {} (confirmed: {})", ingredientId, venueId, confirmed);
        
        Ingredient ingredient = getIngredient(venueId, ingredientId);
        
        // Check if ingredient is referenced by recipes - Requirement 1.8
        List<String> affectedRecipes = recipeIngredientLineRepository.findRecipeNamesByIngredientId(ingredientId);
        
        if (!affectedRecipes.isEmpty()) {
            if (!confirmed) {
                // Throw exception with affected recipe names - requires confirmation
                throw new DeleteConflictException(
                    ErrorCodes.INGREDIENT_IN_USE,
                    String.format("Ingredient '%s' is used in %d recipe(s). Deletion requires confirmation.", 
                        ingredient.getName(), affectedRecipes.size()),
                    affectedRecipes
                );
            }
            logger.warn("Deleting ingredient {} which is used in {} recipes (user confirmed)", 
                ingredientId, affectedRecipes.size());
        }
        
        ingredientRepository.delete(ingredient);
        logger.info("Deleted ingredient {} ({})", ingredientId, ingredient.getName());
    }
    
    /**
     * Search ingredients by name (case-insensitive partial match).
     * Requirement 1.9
     * 
     * @param venueId the venue ID
     * @param nameQuery the search query
     * @return list of matching ingredients
     */
    @Transactional(readOnly = true)
    public List<Ingredient> searchIngredients(UUID venueId, String nameQuery) {
        logger.debug("Searching ingredients in venue {} with query '{}'", venueId, nameQuery);
        
        if (nameQuery == null || nameQuery.trim().isEmpty()) {
            return getAllIngredients(venueId);
        }
        
        return ingredientRepository.findByVenueIdAndNameContainingIgnoreCase(venueId, nameQuery);
    }
    
    // Private helper methods
    
    /**
     * Calculate and set cost fields on an ingredient.
     * Requirements 1.2, 1.5
     */
    private void calculateAndSetCostFields(Ingredient ingredient) {
        // Calculate cost per unit - Requirement 1.2
        BigDecimal costPerUnit = CostCalculator.costPerUnit(
            ingredient.getPurchasePrice(),
            ingredient.getPurchaseQuantity()
        );
        ingredient.setCostPerUnit(costPerUnit);
        
        // Calculate effective cost per usable unit (accounting for yield) - Requirement 1.5
        BigDecimal effectiveCost = CostCalculator.effectiveCostPerUsableUnit(
            costPerUnit,
            ingredient.getYieldPercentage()
        );
        ingredient.setEffectiveCostPerUsableUnit(effectiveCost);
    }
    
    /**
     * Validate all ingredient inputs.
     */
    private void validateIngredientInputs(
            String name,
            BigDecimal purchasePrice,
            BigDecimal purchaseQuantity,
            BigDecimal yieldPercentage) {
        
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("Ingredient name cannot be empty");
        }
        
        if (name.length() > 100) {
            throw new IllegalArgumentException("Ingredient name cannot exceed 100 characters");
        }
        
        validatePositive(purchasePrice, "Purchase price");
        validatePositive(purchaseQuantity, "Purchase quantity");
        
        if (yieldPercentage != null) {
            validateYieldPercentage(yieldPercentage);
        }
    }
    
    /**
     * Validate that a value is positive (> 0).
     */
    private void validatePositive(BigDecimal value, String fieldName) {
        if (value == null || value.compareTo(BigDecimal.ZERO) <= 0) {
            throw new IllegalArgumentException(fieldName + " must be greater than 0");
        }
    }
    
    /**
     * Validate yield percentage is between 1 and 100 inclusive.
     */
    private void validateYieldPercentage(BigDecimal yieldPercentage) {
        if (yieldPercentage == null || 
            yieldPercentage.compareTo(BigDecimal.ONE) < 0 || 
            yieldPercentage.compareTo(new BigDecimal("100")) > 0) {
            throw new IllegalArgumentException("Yield percentage must be between 1 and 100 inclusive");
        }
    }
}
