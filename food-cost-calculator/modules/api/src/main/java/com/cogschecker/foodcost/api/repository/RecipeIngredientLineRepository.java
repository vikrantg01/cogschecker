package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for RecipeIngredientLine entity.
 * Used to check ingredient references for deletion validation (Requirement 1.8).
 */
@Repository
public interface RecipeIngredientLineRepository extends JpaRepository<RecipeIngredientLine, UUID> {
    
    /**
     * Find all recipe names that reference a specific ingredient.
     * Used for Requirement 1.8 - displaying affected recipes before deletion.
     * 
     * @param ingredientId the ingredient ID to search for
     * @return list of recipe names that use this ingredient
     */
    @Query("SELECT DISTINCT r.name FROM Recipe r " +
           "JOIN RecipeIngredientLine ril ON ril.recipeId = r.id " +
           "WHERE ril.ingredientId = :ingredientId " +
           "ORDER BY r.name")
    List<String> findRecipeNamesByIngredientId(@Param("ingredientId") UUID ingredientId);
    
    /**
     * Check if an ingredient is referenced by any recipe.
     * 
     * @param ingredientId the ingredient ID to check
     * @return true if the ingredient is referenced, false otherwise
     */
    @Query("SELECT CASE WHEN COUNT(ril) > 0 THEN true ELSE false END " +
           "FROM RecipeIngredientLine ril WHERE ril.ingredientId = :ingredientId")
    boolean existsByIngredientId(@Param("ingredientId") UUID ingredientId);
    
    /**
     * Find all ingredient lines for a specific recipe.
     * 
     * @param recipeId the recipe ID
     * @return list of ingredient lines
     */
    List<RecipeIngredientLine> findByRecipeId(UUID recipeId);
    
    /**
     * Delete all ingredient lines for a specific recipe.
     * Used for data import to atomically replace venue data.
     * Requirements: 7.5, 7.6
     */
    void deleteByRecipeId(UUID recipeId);
}
