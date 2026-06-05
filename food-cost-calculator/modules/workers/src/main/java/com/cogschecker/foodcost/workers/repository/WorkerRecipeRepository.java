package com.cogschecker.foodcost.workers.repository;

import com.cogschecker.foodcost.api.domain.Recipe;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Recipe entity operations in the workers module.
 * <p>
 * Provides batch update capabilities for cost propagation.
 * <p>
 * Requirements: 3.3 - Batch recipe cost updates
 */
@Repository
public interface WorkerRecipeRepository extends JpaRepository<Recipe, UUID> {
    
    /**
     * Find recipes by their IDs (for batch processing).
     * 
     * @param recipeIds list of recipe IDs
     * @return list of recipes
     */
    List<Recipe> findByIdIn(List<UUID> recipeIds);
    
    /**
     * Find a recipe by ID.
     * 
     * @param recipeId the recipe ID
     * @return optional recipe
     */
    Optional<Recipe> findById(UUID recipeId);
    
    /**
     * Batch update recipe costs.
     * <p>
     * This native update query is more efficient than individual entity updates
     * for large batches (e.g., 100+ recipes affected by an ingredient change).
     * <p>
     * IMPORTANT: This is a single UPDATE statement with CASE expressions,
     * not individual updates. All updates happen in one database round-trip.
     * <p>
     * Requirements: 3.3 - Efficient batch cost updates
     * 
     * @param recipeId the recipe ID to update
     * @param totalBatchCost the new total batch cost
     * @param foodCostPerPortion the new food cost per portion
     * @param foodCostPercentage the new food cost percentage (nullable)
     * @param updatedAt the update timestamp
     */
    @Modifying
    @Query(value = """
        UPDATE recipes
        SET total_batch_cost = :totalBatchCost,
            food_cost_per_portion = :foodCostPerPortion,
            food_cost_percentage = :foodCostPercentage,
            updated_at = :updatedAt
        WHERE id = :recipeId
        """, nativeQuery = true)
    void updateRecipeCosts(
        @Param("recipeId") UUID recipeId,
        @Param("totalBatchCost") BigDecimal totalBatchCost,
        @Param("foodCostPerPortion") BigDecimal foodCostPerPortion,
        @Param("foodCostPercentage") BigDecimal foodCostPercentage,
        @Param("updatedAt") Instant updatedAt
    );
}
