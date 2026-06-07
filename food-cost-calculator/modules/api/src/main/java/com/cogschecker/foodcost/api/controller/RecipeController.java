package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.dto.*;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.service.IngredientService;
import com.cogschecker.foodcost.api.service.RecipeIngredientLineService;
import com.cogschecker.foodcost.api.service.RecipeService;
import com.cogschecker.foodcost.api.service.SystemConfigService;
import com.cogschecker.foodcost.shared.CostCalculator;
import com.cogschecker.foodcost.shared.ThresholdEvaluator;
import com.cogschecker.foodcost.shared.ThresholdStatus;
import com.cogschecker.foodcost.shared.UomConverter;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * REST controller for recipe management.
 * Requirements: 2.1-2.12, 3.5, 3.6, 3.7, 9.3, 9.4
 * 
 * Endpoints:
 * - GET /api/v1/venues/:venueId/recipes - List all recipes
 * - POST /api/v1/venues/:venueId/recipes - Create recipe
 * - GET /api/v1/venues/:venueId/recipes/:id - Get recipe with full cost breakdown
 * - PATCH /api/v1/venues/:venueId/recipes/:id - Update recipe
 * - DELETE /api/v1/venues/:venueId/recipes/:id - Delete recipe
 * - POST /api/v1/venues/:venueId/recipes/:id/duplicate - Duplicate recipe
 * - POST /api/v1/venues/:venueId/recipes/copy - Copy recipe from another venue
 * 
 * RBAC: Manager/Admin for mutations, Staff read-only
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}/recipes")
public class RecipeController {
    
    private static final Logger logger = LoggerFactory.getLogger(RecipeController.class);
    
    private final RecipeService recipeService;
    private final RecipeIngredientLineService lineService;
    private final IngredientService ingredientService;
    private final IngredientRepository ingredientRepository;
    private final RecipeRepository recipeRepository;
    private final SystemConfigService systemConfigService;
    
    public RecipeController(
            RecipeService recipeService,
            RecipeIngredientLineService lineService,
            IngredientService ingredientService,
            IngredientRepository ingredientRepository,
            RecipeRepository recipeRepository,
            SystemConfigService systemConfigService) {
        this.recipeService = recipeService;
        this.lineService = lineService;
        this.ingredientService = ingredientService;
        this.ingredientRepository = ingredientRepository;
        this.recipeRepository = recipeRepository;
        this.systemConfigService = systemConfigService;
    }
    
    /**
     * Get all recipes for a venue.
     * Requirements: 2.9 (search support)
     * RBAC: All roles (read-only)
     * 
     * @param venueId the venue ID
     * @param q optional search query
     * @return list of recipes
     */
    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'STAFF')")
    public ResponseEntity<List<RecipeResponse>> getRecipes(
            @PathVariable UUID venueId,
            @RequestParam(required = false) String q) {
        
        logger.info("GET /venues/{}/recipes (query: {})", venueId, q);
        
        List<Recipe> recipes;
        if (q != null && !q.trim().isEmpty()) {
            recipes = recipeService.searchRecipes(venueId, q);
        } else {
            recipes = recipeService.getAllRecipes(venueId);
        }
        
        List<RecipeResponse> response = recipes.stream()
            .map(this::toRecipeResponse)
            .collect(Collectors.toList());
        
        return ResponseEntity.ok(response);
    }
    
    /**
     * Create a new recipe.
     * Requirements: 2.1, 2.2, 2.10, 2.11, 2.12
     * RBAC: Admin or Manager only
     * 
     * @param venueId the venue ID
     * @param request the create recipe request
     * @return the created recipe
     */
    @PostMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<RecipeResponse> createRecipe(
            @PathVariable UUID venueId,
            @RequestBody CreateRecipeRequest request) {
        
        logger.info("POST /venues/{}/recipes - Creating recipe '{}'", venueId, request.getName());
        
        // TODO: Get tier from JWT claims (for now, assume not free tier)
        boolean isFreeTier = false;
        
        // Create recipe entity
        Recipe recipe = recipeService.createRecipe(
            venueId,
            request.getName(),
            request.getPortionCount(),
            Collections.emptyList(), // Lines added separately
            isFreeTier
        );
        
        // Set menu selling price if provided
        if (request.getMenuSellingPrice() != null) {
            recipe.setMenuSellingPrice(request.getMenuSellingPrice());
            recipeRepository.save(recipe);
        }
        
        // Add ingredient lines if provided
        if (request.getIngredientLines() != null && !request.getIngredientLines().isEmpty()) {
            for (IngredientLineRequest lineReq : request.getIngredientLines()) {
                RecipeIngredientLine line = new RecipeIngredientLine();
                line.setRecipeId(recipe.getId());
                line.setIngredientId(lineReq.getIngredientId());
                line.setSubRecipeId(lineReq.getSubRecipeId());
                line.setQuantityUsed(lineReq.getQuantityUsed());
                line.setUnitOfMeasure(lineReq.getUnitOfMeasure());
                line.setCreatedAt(Instant.now());
                line.setUpdatedAt(Instant.now());
                
                lineService.saveIngredientLine(line);
            }
            
            // Recalculate costs after adding lines
            recalculateRecipeCosts(recipe);
        }
        
        return ResponseEntity.status(HttpStatus.CREATED).body(toRecipeResponse(recipe));
    }
    
    /**
     * Get a single recipe with full cost breakdown.
     * Requirements: 3.5, 3.6, 3.7
     * Returns full cost breakdown on GET /:id:
     * - Each line: name, qty, uom, unit cost, line cost
     * - Totals
     * - Missing-price lines: substitute null cost fields, include missingPrice: true flag per line
     * 
     * RBAC: All roles (read-only)
     * 
     * @param venueId the venue ID
     * @param id the recipe ID
     * @return the recipe with cost breakdown
     */
    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER', 'STAFF')")
    public ResponseEntity<RecipeDetailResponse> getRecipe(
            @PathVariable UUID venueId,
            @PathVariable UUID id) {
        
        logger.info("GET /venues/{}/recipes/{}", venueId, id);
        
        Recipe recipe = recipeService.getRecipe(venueId, id);
        List<RecipeIngredientLine> lines = lineService.getIngredientLines(id);
        
        // Build cost breakdown
        RecipeDetailResponse response = buildRecipeDetailResponse(recipe, lines);
        
        return ResponseEntity.ok(response);
    }
    
    /**
     * Update a recipe.
     * Requirements: 2.5, 2.10, 2.11
     * RBAC: Admin or Manager only
     * 
     * @param venueId the venue ID
     * @param id the recipe ID
     * @param request the update request
     * @return the updated recipe
     */
    @PatchMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<RecipeResponse> updateRecipe(
            @PathVariable UUID venueId,
            @PathVariable UUID id,
            @RequestBody UpdateRecipeRequest request) {
        
        logger.info("PATCH /venues/{}/recipes/{}", venueId, id);
        
        Recipe recipe = recipeService.updateRecipe(
            venueId,
            id,
            request.getName(),
            request.getPortionCount(),
            request.getMenuSellingPrice()
        );
        
        // Update ingredient lines if provided
        if (request.getIngredientLines() != null) {
            // Delete existing lines and recreate
            List<RecipeIngredientLine> existingLines = lineService.getIngredientLines(id);
            for (RecipeIngredientLine line : existingLines) {
                lineService.deleteIngredientLine(line.getId());
            }
            
            // Add new lines
            for (IngredientLineRequest lineReq : request.getIngredientLines()) {
                RecipeIngredientLine line = new RecipeIngredientLine();
                line.setRecipeId(id);
                line.setIngredientId(lineReq.getIngredientId());
                line.setSubRecipeId(lineReq.getSubRecipeId());
                line.setQuantityUsed(lineReq.getQuantityUsed());
                line.setUnitOfMeasure(lineReq.getUnitOfMeasure());
                line.setCreatedAt(Instant.now());
                line.setUpdatedAt(Instant.now());
                
                lineService.saveIngredientLine(line);
            }
            
            // Recalculate costs
            recalculateRecipeCosts(recipe);
        }
        
        return ResponseEntity.ok(toRecipeResponse(recipe));
    }
    
    /**
     * Delete a recipe.
     * Requirements: 2.7, 2.8
     * RBAC: Admin or Manager only
     * 
     * @param venueId the venue ID
     * @param id the recipe ID
     * @param confirmed whether deletion is confirmed (for sub-recipe warning)
     * @return no content
     */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<Void> deleteRecipe(
            @PathVariable UUID venueId,
            @PathVariable UUID id,
            @RequestParam(defaultValue = "false") boolean confirmed) {
        
        logger.info("DELETE /venues/{}/recipes/{} (confirmed: {})", venueId, id, confirmed);
        
        recipeService.deleteRecipe(venueId, id, confirmed);
        
        return ResponseEntity.noContent().build();
    }
    
    /**
     * Duplicate a recipe.
     * Requirement: 2.6
     * RBAC: Admin or Manager only
     * 
     * @param venueId the venue ID
     * @param id the recipe ID to duplicate
     * @return the duplicated recipe
     */
    @PostMapping("/{id}/duplicate")
    @PreAuthorize("hasAnyRole('ADMIN', 'MANAGER')")
    public ResponseEntity<RecipeResponse> duplicateRecipe(
            @PathVariable UUID venueId,
            @PathVariable UUID id) {
        
        logger.info("POST /venues/{}/recipes/{}/duplicate", venueId, id);
        
        // TODO: Get tier from JWT claims
        boolean isFreeTier = false;
        
        Recipe duplicated = recipeService.duplicateRecipe(venueId, id, isFreeTier);
        
        // Copy ingredient lines
        List<RecipeIngredientLine> sourceLines = lineService.getIngredientLines(id);
        for (RecipeIngredientLine sourceLine : sourceLines) {
            RecipeIngredientLine newLine = new RecipeIngredientLine();
            newLine.setRecipeId(duplicated.getId());
            newLine.setIngredientId(sourceLine.getIngredientId());
            newLine.setSubRecipeId(sourceLine.getSubRecipeId());
            newLine.setQuantityUsed(sourceLine.getQuantityUsed());
            newLine.setUnitOfMeasure(sourceLine.getUnitOfMeasure());
            newLine.setLineCost(sourceLine.getLineCost());
            newLine.setCreatedAt(Instant.now());
            newLine.setUpdatedAt(Instant.now());
            
            lineService.saveIngredientLine(newLine);
        }
        
        return ResponseEntity.status(HttpStatus.CREATED).body(toRecipeResponse(duplicated));
    }
    
    /**
     * Copy a recipe from another venue within the same organisation.
     * Requirements: 10.6, 10.7
     * 
     * Flow:
     * 1. Admin submits copy request with sourceVenueId and recipeId
     * 2. System checks all ingredients against destination venue
     * 3. If missing ingredients found, return 409 with list of missing ingredient names
     * 4. Admin re-submits with ingredientMappings (map to existing or createNew flag)
     * 5. System creates recipe with mapped/new ingredients
     * 
     * RBAC: Admin only
     * 
     * @param venueId the destination venue ID
     * @param request the copy request (source venue ID, recipe ID, optional ingredient mappings)
     * @return the copied recipe or 409 with missing ingredients list
     */
    @PostMapping("/copy")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<?> copyRecipe(
            @PathVariable UUID venueId,
            @RequestBody CopyRecipeRequest request) {
        
        logger.info("POST /venues/{}/recipes/copy - Copying recipe {} from venue {}", 
            venueId, request.getRecipeId(), request.getSourceVenueId());
        
        // Get source recipe
        Recipe sourceRecipe = recipeService.getRecipe(request.getSourceVenueId(), request.getRecipeId());
        List<RecipeIngredientLine> sourceLines = lineService.getIngredientLines(request.getRecipeId());
        
        // Check for missing ingredients in destination venue
        List<MissingIngredientInfo> missingIngredients = new ArrayList<>();
        Map<UUID, UUID> ingredientIdMap = new HashMap<>();
        Map<UUID, UUID> subRecipeIdMap = new HashMap<>();
        
        // Build ingredient mappings if provided
        Map<UUID, IngredientMapping> providedMappings = new HashMap<>();
        if (request.getIngredientMappings() != null) {
            for (IngredientMapping mapping : request.getIngredientMappings()) {
                providedMappings.put(mapping.getSourceIngredientId(), mapping);
            }
        }
        
        // Check each ingredient line
        for (RecipeIngredientLine sourceLine : sourceLines) {
            if (sourceLine.getIngredientId() != null) {
                UUID sourceIngredientId = sourceLine.getIngredientId();
                
                // Check if we already have a mapping for this ingredient
                if (ingredientIdMap.containsKey(sourceIngredientId)) {
                    continue; // Already processed
                }
                
                Ingredient sourceIngredient = ingredientService.getIngredient(
                    request.getSourceVenueId(), 
                    sourceIngredientId
                );
                
                // Check if mapping was provided
                if (providedMappings.containsKey(sourceIngredientId)) {
                    IngredientMapping mapping = providedMappings.get(sourceIngredientId);
                    
                    if (Boolean.TRUE.equals(mapping.getCreateNew())) {
                        // Create new ingredient in destination venue
                        Ingredient newIngredient = new Ingredient();
                        newIngredient.setVenueId(venueId);
                        newIngredient.setName(sourceIngredient.getName());
                        newIngredient.setPurchasePrice(sourceIngredient.getPurchasePrice());
                        newIngredient.setPurchaseQuantity(sourceIngredient.getPurchaseQuantity());
                        newIngredient.setUnitOfMeasure(sourceIngredient.getUnitOfMeasure());
                        newIngredient.setYieldPercentage(sourceIngredient.getYieldPercentage());
                        newIngredient.setCreatedAt(Instant.now());
                        newIngredient.setUpdatedAt(Instant.now());
                        
                        Ingredient created = ingredientService.createIngredient(
                            venueId,
                            newIngredient.getName(),
                            newIngredient.getPurchasePrice(),
                            newIngredient.getPurchaseQuantity(),
                            newIngredient.getUnitOfMeasure(),
                            newIngredient.getYieldPercentage()
                        );
                        
                        ingredientIdMap.put(sourceIngredientId, created.getId());
                        logger.info("Created new ingredient '{}' in destination venue", created.getName());
                    } else if (mapping.getDestinationIngredientId() != null) {
                        // Map to existing ingredient
                        ingredientIdMap.put(sourceIngredientId, mapping.getDestinationIngredientId());
                        logger.info("Mapped ingredient {} to existing {}", 
                            sourceIngredientId, mapping.getDestinationIngredientId());
                    } else {
                        // Invalid mapping - neither createNew nor destinationIngredientId provided
                        logger.warn("Invalid mapping for ingredient {}: no action specified", sourceIngredientId);
                        missingIngredients.add(new MissingIngredientInfo(
                            sourceIngredientId,
                            sourceIngredient.getName(),
                            sourceIngredient.getUnitOfMeasure().getSymbol()
                        ));
                    }
                } else {
                    // No mapping provided - check if ingredient exists in destination by name
                    Optional<Ingredient> destIngredient = ingredientRepository
                        .findByVenueIdAndNameIgnoreCase(venueId, sourceIngredient.getName());
                    
                    if (destIngredient.isPresent()) {
                        ingredientIdMap.put(sourceIngredientId, destIngredient.get().getId());
                        logger.info("Auto-mapped ingredient '{}' by name", sourceIngredient.getName());
                    } else {
                        // Missing ingredient - add to list
                        missingIngredients.add(new MissingIngredientInfo(
                            sourceIngredientId,
                            sourceIngredient.getName(),
                            sourceIngredient.getUnitOfMeasure().getSymbol()
                        ));
                    }
                }
            } else if (sourceLine.getSubRecipeId() != null) {
                UUID sourceSubRecipeId = sourceLine.getSubRecipeId();
                
                // Check if we already have a mapping for this sub-recipe
                if (subRecipeIdMap.containsKey(sourceSubRecipeId)) {
                    continue;
                }
                
                // For sub-recipes, try to find by name in destination venue
                Recipe sourceSubRecipe = recipeRepository.findById(sourceSubRecipeId)
                    .orElseThrow(() -> new IllegalArgumentException("Sub-recipe not found: " + sourceSubRecipeId));
                
                Optional<Recipe> destSubRecipe = recipeRepository
                    .findByVenueIdAndNameIgnoreCase(venueId, sourceSubRecipe.getName());
                
                if (destSubRecipe.isPresent()) {
                    subRecipeIdMap.put(sourceSubRecipeId, destSubRecipe.get().getId());
                    logger.info("Mapped sub-recipe '{}' by name", sourceSubRecipe.getName());
                } else {
                    logger.warn("Sub-recipe '{}' not found in destination venue - will skip", 
                        sourceSubRecipe.getName());
                    // Note: Sub-recipes are not included in missing ingredients response
                    // They are simply skipped if not found
                }
            }
        }
        
        // Requirement 10.7: If missing ingredients exist, return 409 with list
        if (!missingIngredients.isEmpty()) {
            logger.info("Found {} missing ingredients in destination venue", missingIngredients.size());
            MissingIngredientsResponse response = new MissingIngredientsResponse(
                "The destination venue is missing some ingredients from the source recipe. " +
                "Please provide ingredient mappings or create new ingredients.",
                missingIngredients
            );
            return ResponseEntity.status(HttpStatus.CONFLICT).body(response);
        }
        
        // All ingredients are mapped - proceed with copy
        logger.info("All ingredients mapped, proceeding with recipe copy");
        
        // TODO: Get tier from JWT claims
        boolean isFreeTier = false;
        
        // Create new recipe in destination venue
        Recipe copied = recipeService.createRecipe(
            venueId,
            sourceRecipe.getName(),
            sourceRecipe.getPortionCount(),
            Collections.emptyList(),
            isFreeTier
        );
        
        copied.setMenuSellingPrice(sourceRecipe.getMenuSellingPrice());
        
        // Copy ingredient lines with mapped IDs
        for (RecipeIngredientLine sourceLine : sourceLines) {
            RecipeIngredientLine newLine = new RecipeIngredientLine();
            newLine.setRecipeId(copied.getId());
            newLine.setQuantityUsed(sourceLine.getQuantityUsed());
            newLine.setUnitOfMeasure(sourceLine.getUnitOfMeasure());
            newLine.setCreatedAt(Instant.now());
            newLine.setUpdatedAt(Instant.now());
            
            if (sourceLine.getIngredientId() != null) {
                UUID mappedIngredientId = ingredientIdMap.get(sourceLine.getIngredientId());
                if (mappedIngredientId != null) {
                    newLine.setIngredientId(mappedIngredientId);
                    lineService.saveIngredientLine(newLine);
                }
            } else if (sourceLine.getSubRecipeId() != null) {
                UUID mappedSubRecipeId = subRecipeIdMap.get(sourceLine.getSubRecipeId());
                if (mappedSubRecipeId != null) {
                    newLine.setSubRecipeId(mappedSubRecipeId);
                    lineService.saveIngredientLine(newLine);
                }
            }
        }
        
        // Recalculate costs
        recalculateRecipeCosts(copied);
        
        logger.info("Successfully copied recipe '{}' to destination venue", copied.getName());
        return ResponseEntity.status(HttpStatus.CREATED).body(toRecipeResponse(copied));
    }
    
    // Private helper methods
    
    /**
     * Convert Recipe entity to RecipeResponse DTO.
     */
    private RecipeResponse toRecipeResponse(Recipe recipe) {
        RecipeResponse response = new RecipeResponse();
        response.setId(recipe.getId());
        response.setVenueId(recipe.getVenueId());
        response.setName(recipe.getName());
        response.setPortionCount(recipe.getPortionCount());
        response.setMenuSellingPrice(recipe.getMenuSellingPrice());
        response.setTotalBatchCost(recipe.getTotalBatchCost());
        response.setFoodCostPerPortion(recipe.getFoodCostPerPortion());
        response.setFoodCostPercentage(recipe.getFoodCostPercentage());
        response.setCreatedAt(recipe.getCreatedAt());
        response.setUpdatedAt(recipe.getUpdatedAt());
        
        // Requirement 4.7, 4.8: Evaluate threshold status
        SystemConfig config = systemConfigService.getConfig(recipe.getVenueId());
        ThresholdStatus thresholdStatus = ThresholdEvaluator.evaluate(
            recipe.getFoodCostPercentage(),
            config.getTargetFoodCostPercentage()
        );
        response.setThresholdStatus(thresholdStatus);
        
        return response;
    }
    
    /**
     * Build detailed recipe response with full cost breakdown.
     * Requirements: 3.5, 3.6, 3.7
     */
    private RecipeDetailResponse buildRecipeDetailResponse(Recipe recipe, List<RecipeIngredientLine> lines) {
        RecipeDetailResponse response = new RecipeDetailResponse();
        response.setId(recipe.getId());
        response.setVenueId(recipe.getVenueId());
        response.setName(recipe.getName());
        response.setPortionCount(recipe.getPortionCount());
        response.setMenuSellingPrice(recipe.getMenuSellingPrice());
        response.setTotalBatchCost(recipe.getTotalBatchCost());
        response.setFoodCostPerPortion(recipe.getFoodCostPerPortion());
        response.setFoodCostPercentage(recipe.getFoodCostPercentage());
        response.setCreatedAt(recipe.getCreatedAt());
        response.setUpdatedAt(recipe.getUpdatedAt());
        
        // Build ingredient lines list
        List<RecipeIngredientLineResponse> ingredientLineResponses = new ArrayList<>();
        for (RecipeIngredientLine line : lines) {
            RecipeIngredientLineResponse lineResponse = new RecipeIngredientLineResponse();
            lineResponse.setId(line.getId() != null ? line.getId().toString() : null);
            lineResponse.setRecipeId(line.getRecipeId() != null ? line.getRecipeId().toString() : null);
            lineResponse.setIngredientId(line.getIngredientId() != null ? line.getIngredientId().toString() : null);
            lineResponse.setSubRecipeId(line.getSubRecipeId() != null ? line.getSubRecipeId().toString() : null);
            lineResponse.setQuantityUsed(line.getQuantityUsed());
            lineResponse.setUnitOfMeasure(line.getUnitOfMeasure());
            lineResponse.setLineCost(line.getLineCost());
            ingredientLineResponses.add(lineResponse);
        }
        response.setIngredientLines(ingredientLineResponses);
        
        // Build cost breakdown for each line
        List<CostBreakdownLineResponse> breakdownLines = new ArrayList<>();
        boolean hasIncompleteData = false;
        
        for (RecipeIngredientLine line : lines) {
            CostBreakdownLineResponse breakdownLine = new CostBreakdownLineResponse();
            
            if (line.getIngredientId() != null) {
                // Regular ingredient line
                Ingredient ingredient = ingredientRepository.findById(line.getIngredientId())
                    .orElse(null);
                
                if (ingredient != null) {
                    breakdownLine.setName(ingredient.getName());
                    breakdownLine.setQuantity(line.getQuantityUsed());
                    breakdownLine.setUnitOfMeasure(line.getUnitOfMeasure().getSymbol());
                    
                    // Check if ingredient has price
                    if (ingredient.getPurchasePrice() != null && 
                        ingredient.getPurchasePrice().compareTo(BigDecimal.ZERO) > 0) {
                        
                        BigDecimal unitCost = ingredient.getEffectiveCostPerUsableUnit();
                        breakdownLine.setUnitCost(unitCost);
                        
                        // Calculate line cost with UOM conversion
                        try {
                            BigDecimal quantityInPurchaseUnit = UomConverter.convert(
                                line.getQuantityUsed(),
                                line.getUnitOfMeasure(),
                                ingredient.getUnitOfMeasure()
                            );
                            BigDecimal lineCost = CostCalculator.lineCost(
                                quantityInPurchaseUnit,
                                ingredient.getEffectiveCostPerUsableUnit()
                            );
                            breakdownLine.setLineCost(lineCost);
                            breakdownLine.setMissingPrice(false);
                        } catch (Exception e) {
                            logger.warn("Error calculating line cost: {}", e.getMessage());
                            breakdownLine.setUnitCost(null);
                            breakdownLine.setLineCost(null);
                            breakdownLine.setMissingPrice(true);
                            hasIncompleteData = true;
                        }
                    } else {
                        // Requirement 3.6: Missing price - null cost fields, missingPrice flag
                        breakdownLine.setUnitCost(null);
                        breakdownLine.setLineCost(null);
                        breakdownLine.setMissingPrice(true);
                        hasIncompleteData = true;
                    }
                }
            } else if (line.getSubRecipeId() != null) {
                // Sub-recipe line
                Recipe subRecipe = recipeRepository.findById(line.getSubRecipeId())
                    .orElse(null);
                
                if (subRecipe != null) {
                    breakdownLine.setName(subRecipe.getName() + " (sub-recipe)");
                    breakdownLine.setQuantity(line.getQuantityUsed());
                    breakdownLine.setUnitOfMeasure("portions");
                    
                    if (subRecipe.getFoodCostPerPortion() != null) {
                        breakdownLine.setUnitCost(subRecipe.getFoodCostPerPortion());
                        BigDecimal lineCost = line.getQuantityUsed()
                            .multiply(subRecipe.getFoodCostPerPortion());
                        breakdownLine.setLineCost(lineCost);
                        breakdownLine.setMissingPrice(false);
                    } else {
                        breakdownLine.setUnitCost(null);
                        breakdownLine.setLineCost(null);
                        breakdownLine.setMissingPrice(true);
                        hasIncompleteData = true;
                    }
                }
            }
            
            breakdownLines.add(breakdownLine);
        }
        
        response.setCostBreakdown(breakdownLines);
        response.setHasIncompleteData(hasIncompleteData);
        
        // Requirement 4.7, 4.8: Evaluate threshold status
        SystemConfig config = systemConfigService.getConfig(recipe.getVenueId());
        ThresholdStatus thresholdStatus = ThresholdEvaluator.evaluate(
            recipe.getFoodCostPercentage(),
            config.getTargetFoodCostPercentage()
        );
        response.setThresholdStatus(thresholdStatus);
        
        return response;
    }
    
    /**
     * Recalculate recipe costs based on ingredient lines.
     * Requirements: 3.1, 3.2, 3.3, 3.4
     */
    private void recalculateRecipeCosts(Recipe recipe) {
        List<RecipeIngredientLine> lines = lineService.getIngredientLines(recipe.getId());
        
        BigDecimal totalBatchCost = BigDecimal.ZERO;
        boolean hasIncompleteData = false;
        
        for (RecipeIngredientLine line : lines) {
            if (line.getIngredientId() != null) {
                Ingredient ingredient = ingredientRepository.findById(line.getIngredientId())
                    .orElse(null);
                
                if (ingredient != null && 
                    ingredient.getPurchasePrice() != null && 
                    ingredient.getPurchasePrice().compareTo(BigDecimal.ZERO) > 0) {
                    
                    try {
                        // Convert quantity to purchase unit and calculate line cost
                        BigDecimal quantityInPurchaseUnit = UomConverter.convert(
                            line.getQuantityUsed(),
                            line.getUnitOfMeasure(),
                            ingredient.getUnitOfMeasure()
                        );
                        
                        BigDecimal lineCost = CostCalculator.lineCost(
                            quantityInPurchaseUnit,
                            ingredient.getEffectiveCostPerUsableUnit()
                        );
                        
                        line.setLineCost(lineCost);
                        totalBatchCost = totalBatchCost.add(lineCost);
                    } catch (Exception e) {
                        logger.warn("Error calculating line cost for ingredient {}: {}", 
                            ingredient.getId(), e.getMessage());
                        hasIncompleteData = true;
                    }
                } else {
                    hasIncompleteData = true;
                }
            } else if (line.getSubRecipeId() != null) {
                Recipe subRecipe = recipeRepository.findById(line.getSubRecipeId())
                    .orElse(null);
                
                if (subRecipe != null && subRecipe.getFoodCostPerPortion() != null) {
                    BigDecimal lineCost = line.getQuantityUsed()
                        .multiply(subRecipe.getFoodCostPerPortion());
                    line.setLineCost(lineCost);
                    totalBatchCost = totalBatchCost.add(lineCost);
                } else {
                    hasIncompleteData = true;
                }
            }
        }
        
        recipe.setTotalBatchCost(totalBatchCost);
        
        // Calculate food cost per portion - Requirement 3.2
        if (recipe.getPortionCount() != null && recipe.getPortionCount() > 0) {
            BigDecimal foodCostPerPortion = CostCalculator.foodCostPerPortion(
                totalBatchCost,
                recipe.getPortionCount()
            );
            recipe.setFoodCostPerPortion(foodCostPerPortion);
            
            // Calculate food cost percentage if menu price is set - Requirement 4.2
            if (recipe.getMenuSellingPrice() != null && 
                recipe.getMenuSellingPrice().compareTo(BigDecimal.ZERO) > 0) {
                BigDecimal foodCostPercentage = CostCalculator.foodCostPercentage(
                    foodCostPerPortion,
                    recipe.getMenuSellingPrice()
                );
                recipe.setFoodCostPercentage(foodCostPercentage);
            } else {
                recipe.setFoodCostPercentage(null);
            }
        }
        
        recipe.setUpdatedAt(Instant.now());
        recipeRepository.save(recipe);
    }
}
