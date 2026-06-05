package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.Recipe;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Recipe entity.
 * Requirements: 2.1, 2.6, 2.8, 2.9, 2.12
 */
@Repository
public interface RecipeRepository extends JpaRepository<Recipe, UUID> {
    
    /**
     * Find all recipes for a venue.
     */
    List<Recipe> findByVenueId(UUID venueId);
    
    /**
     * Find recipe by venue and ID.
     */
    Optional<Recipe> findByVenueIdAndId(UUID venueId, UUID id);
    
    /**
     * Search recipes by venue and name (case-insensitive partial match).
     * Requirement 2.9
     */
    List<Recipe> findByVenueIdAndNameContainingIgnoreCase(UUID venueId, String nameQuery);
    
    /**
     * Find recipe by venue and exact name match (case-insensitive).
     * Used for cross-venue copy to find matching recipes.
     */
    @Query("SELECT r FROM Recipe r WHERE r.venueId = :venueId AND LOWER(r.name) = LOWER(:name)")
    Optional<Recipe> findByVenueIdAndNameIgnoreCase(@Param("venueId") UUID venueId, @Param("name") String name);
    
    /**
     * Check if recipe with the given name exists in a venue (case-insensitive).
     * Used for duplicate name detection.
     */
    @Query("SELECT CASE WHEN COUNT(r) > 0 THEN true ELSE false END FROM Recipe r " +
           "WHERE r.venueId = :venueId AND LOWER(r.name) = LOWER(:name)")
    boolean existsByVenueIdAndNameIgnoreCase(@Param("venueId") UUID venueId, @Param("name") String name);
    
    /**
     * Check if recipe with the given name exists in a venue, excluding a specific ID.
     * Used for duplicate name detection during updates.
     */
    @Query("SELECT CASE WHEN COUNT(r) > 0 THEN true ELSE false END FROM Recipe r " +
           "WHERE r.venueId = :venueId AND LOWER(r.name) = LOWER(:name) AND r.id != :excludeId")
    boolean existsByVenueIdAndNameIgnoreCaseExcludingId(
        @Param("venueId") UUID venueId, 
        @Param("name") String name, 
        @Param("excludeId") UUID excludeId
    );
    
    /**
     * Count recipes in a venue.
     * Requirement 2.12 - Free tier limit checking
     */
    long countByVenueId(UUID venueId);
    
    /**
     * Find all recipe names that use a specific recipe as a sub-recipe.
     * Requirement 2.8 - Used for delete warning
     * 
     * @param subRecipeId the recipe ID used as a sub-recipe
     * @return list of parent recipe names
     */
    @Query("SELECT DISTINCT r.name FROM Recipe r " +
           "JOIN RecipeIngredientLine ril ON ril.recipeId = r.id " +
           "WHERE ril.subRecipeId = :subRecipeId " +
           "ORDER BY r.name")
    List<String> findParentRecipeNamesBySubRecipeId(@Param("subRecipeId") UUID subRecipeId);
    
    /**
     * Check if adding candidateSubRecipeId as a sub-recipe to parentRecipeId would create a circular reference.
     * Uses a recursive CTE to traverse the sub-recipe dependency graph.
     * Requirements 2.3, 2.4 - Circular reference detection
     * 
     * This query finds all recipes that the candidate sub-recipe directly or transitively depends on.
     * If the parent recipe is in that set, adding the candidate would create a cycle.
     * 
     * @param parentRecipeId the recipe that would contain the sub-recipe
     * @param candidateSubRecipeId the sub-recipe being added
     * @return true if a circular reference would be created, false otherwise
     */
    @Query(value = """
        WITH RECURSIVE ancestors(recipe_id) AS (
          SELECT sub_recipe_id FROM recipe_ingredient_lines
          WHERE recipe_id = :candidateSubRecipeId AND sub_recipe_id IS NOT NULL
          UNION ALL
          SELECT ril.sub_recipe_id FROM recipe_ingredient_lines ril
          INNER JOIN ancestors ON ril.recipe_id = ancestors.recipe_id
          WHERE ril.sub_recipe_id IS NOT NULL
        )
        SELECT CASE WHEN COUNT(*) > 0 THEN true ELSE false END 
        FROM ancestors WHERE recipe_id = :parentRecipeId
        """, nativeQuery = true)
    boolean existsCircularReference(
        @Param("parentRecipeId") UUID parentRecipeId, 
        @Param("candidateSubRecipeId") UUID candidateSubRecipeId
    );
    
    /**
     * Delete all recipes for a venue.
     * Used for data import to atomically replace venue data.
     * Requirements: 7.5, 7.6
     */
    void deleteByVenueId(UUID venueId);
}
