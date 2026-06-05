package com.cogschecker.foodcost.workers.repository;

import com.cogschecker.foodcost.api.domain.Ingredient;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Ingredient entity operations in the workers module.
 * <p>
 * Used for fetching ingredient cost data during recipe recalculation.
 * <p>
 * Requirements: 3.3 - Access ingredient data for cost calculation
 */
@Repository
public interface WorkerIngredientRepository extends JpaRepository<Ingredient, UUID> {
    
    /**
     * Find an ingredient by ID.
     * 
     * @param ingredientId the ingredient ID
     * @return optional ingredient
     */
    Optional<Ingredient> findById(UUID ingredientId);
}
