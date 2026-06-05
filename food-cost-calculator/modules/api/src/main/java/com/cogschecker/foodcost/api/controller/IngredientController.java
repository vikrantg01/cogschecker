package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.dto.CreateIngredientRequest;
import com.cogschecker.foodcost.api.dto.IngredientResponse;
import com.cogschecker.foodcost.api.dto.UpdateIngredientRequest;
import com.cogschecker.foodcost.api.service.IngredientService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * REST controller for ingredient management.
 * Requirements: 1.1, 1.6, 1.7, 1.8, 1.9, 9.3, 9.4
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}/ingredients")
public class IngredientController {
    
    private static final Logger logger = LoggerFactory.getLogger(IngredientController.class);
    
    private final IngredientService ingredientService;
    
    public IngredientController(IngredientService ingredientService) {
        this.ingredientService = ingredientService;
    }
    
    /**
     * Get all ingredients for a venue with optional search.
     * Requirements: 1.9 (search), 9.4 (Staff can GET)
     * 
     * GET /api/v1/venues/:venueId/ingredients
     * GET /api/v1/venues/:venueId/ingredients?q=flour
     * 
     * @param venueId the venue ID
     * @param q optional search query (case-insensitive partial match)
     * @return list of ingredients
     */
    @GetMapping
    @PreAuthorize("hasVenueRole('STAFF', #venueId) or hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<List<IngredientResponse>> getIngredients(
            @PathVariable UUID venueId,
            @RequestParam(required = false) String q) {
        
        logger.info("GET /venues/{}/ingredients (query: {})", venueId, q);
        
        List<Ingredient> ingredients;
        if (q != null && !q.trim().isEmpty()) {
            ingredients = ingredientService.searchIngredients(venueId, q);
        } else {
            ingredients = ingredientService.getAllIngredients(venueId);
        }
        
        List<IngredientResponse> response = ingredients.stream()
                .map(IngredientResponse::fromEntity)
                .collect(Collectors.toList());
        
        return ResponseEntity.ok(response);
    }
    
    /**
     * Get a single ingredient by ID.
     * Requirements: 1.6, 9.4 (Staff can GET)
     * 
     * GET /api/v1/venues/:venueId/ingredients/:id
     * 
     * @param venueId the venue ID
     * @param id the ingredient ID
     * @return ingredient details
     */
    @GetMapping("/{id}")
    @PreAuthorize("hasVenueRole('STAFF', #venueId) or hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<IngredientResponse> getIngredient(
            @PathVariable UUID venueId,
            @PathVariable UUID id) {
        
        logger.info("GET /venues/{}/ingredients/{}", venueId, id);
        
        Ingredient ingredient = ingredientService.getIngredient(venueId, id);
        return ResponseEntity.ok(IngredientResponse.fromEntity(ingredient));
    }
    
    /**
     * Create a new ingredient.
     * Requirements: 1.1, 1.2, 1.4, 1.10, 9.3 (MANAGER only for mutations)
     * 
     * POST /api/v1/venues/:venueId/ingredients
     * 
     * @param venueId the venue ID
     * @param request the ingredient creation request with validated fields
     * @return the created ingredient with HTTP 201
     */
    @PostMapping
    @PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<IngredientResponse> createIngredient(
            @PathVariable UUID venueId,
            @Valid @RequestBody CreateIngredientRequest request) {
        
        logger.info("POST /venues/{}/ingredients - creating ingredient '{}'", venueId, request.getName());
        
        Ingredient ingredient = ingredientService.createIngredient(
            venueId,
            request.getName(),
            request.getPurchasePrice(),
            request.getPurchaseQuantity(),
            request.getUnitOfMeasure(),
            request.getYieldPercentage()
        );
        
        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(IngredientResponse.fromEntity(ingredient));
    }
    
    /**
     * Update an existing ingredient.
     * Requirements: 1.3, 1.6, 1.10, 9.3 (MANAGER only for mutations)
     * 
     * PATCH /api/v1/venues/:venueId/ingredients/:id
     * 
     * @param venueId the venue ID
     * @param id the ingredient ID
     * @param request the ingredient update request with validated fields
     * @return the updated ingredient
     */
    @PatchMapping("/{id}")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<IngredientResponse> updateIngredient(
            @PathVariable UUID venueId,
            @PathVariable UUID id,
            @Valid @RequestBody UpdateIngredientRequest request) {
        
        logger.info("PATCH /venues/{}/ingredients/{}", venueId, id);
        
        Ingredient ingredient = ingredientService.updateIngredient(
            venueId,
            id,
            request.getName(),
            request.getPurchasePrice(),
            request.getPurchaseQuantity(),
            request.getUnitOfMeasure(),
            request.getYieldPercentage()
        );
        
        return ResponseEntity.ok(IngredientResponse.fromEntity(ingredient));
    }
    
    /**
     * Delete an ingredient.
     * Requirements: 1.7, 1.8 (warning and confirmation), 9.3 (MANAGER only for mutations)
     * 
     * DELETE /api/v1/venues/:venueId/ingredients/:id
     * DELETE /api/v1/venues/:venueId/ingredients/:id?confirmed=true
     * 
     * @param venueId the venue ID
     * @param id the ingredient ID
     * @param confirmed whether user has confirmed deletion after seeing warning
     * @return HTTP 204 No Content on success
     */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<Void> deleteIngredient(
            @PathVariable UUID venueId,
            @PathVariable UUID id,
            @RequestParam(defaultValue = "false") boolean confirmed) {
        
        logger.info("DELETE /venues/{}/ingredients/{} (confirmed: {})", venueId, id, confirmed);
        
        ingredientService.deleteIngredient(venueId, id, confirmed);
        
        return ResponseEntity.noContent().build();
    }
}
