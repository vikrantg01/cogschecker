package com.cogschecker.foodcost.workers.repository;

import com.cogschecker.foodcost.api.domain.Recipe;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for Recipe dependency queries used in cost propagation.
 * <p>
 * This repository provides specialized queries for finding all recipes that transitively
 * depend on an ingredient, using recursive CTEs to traverse the dependency graph.
 * <p>
 * Requirements: 3.3 - Cost propagation via recursive dependency traversal
 */
@Repository
public interface RecipeDependencyRepository extends JpaRepository<Recipe, UUID> {
    
    /**
     * Find all recipe IDs that directly or transitively reference a given ingredient,
     * ordered by dependency depth (leaves first).
     * <p>
     * This query uses a recursive CTE to traverse the sub-recipe dependency graph:
     * <ol>
     *   <li>Base case: Find all recipes that directly reference the ingredient</li>
     *   <li>Recursive case: Find recipes that use any of those recipes as sub-recipes</li>
     *   <li>Order by depth ascending, so leaf recipes are recalculated before their parents</li>
     * </ol>
     * <p>
     * The depth ordering is critical for correctness: when a parent recipe uses a sub-recipe,
     * the sub-recipe's cost must be recalculated first, so the parent can use the updated value.
     * <p>
     * Requirements: 3.3 - Recursive CTE for transitive dependency resolution
     * 
     * @param ingredientId the ingredient ID that was updated
     * @return list of recipe IDs ordered by dependency depth (leaves first)
     */
    @Query(value = """
        WITH RECURSIVE dependent_recipes(recipe_id, depth) AS (
          -- Base case: recipes that directly reference the ingredient
          SELECT DISTINCT ril.recipe_id, 0 AS depth
          FROM recipe_ingredient_lines ril
          WHERE ril.ingredient_id = :ingredientId
          
          UNION ALL
          
          -- Recursive case: recipes that use any of the dependent recipes as sub-recipes
          SELECT DISTINCT ril.recipe_id, dr.depth + 1
          FROM recipe_ingredient_lines ril
          INNER JOIN dependent_recipes dr ON ril.sub_recipe_id = dr.recipe_id
        )
        SELECT DISTINCT recipe_id
        FROM dependent_recipes
        ORDER BY depth ASC
        """, nativeQuery = true)
    List<UUID> findAllDependentRecipeIds(@Param("ingredientId") UUID ingredientId);
    
    /**
     * Find all ingredient lines for a specific recipe, ordered by ID.
     * Used by cost recalculation to fetch all ingredients needed for cost computation.
     * 
     * @param recipeId the recipe ID
     * @return list of ingredient line data as Object arrays: [ingredientId, subRecipeId, quantityUsed, unitOfMeasure]
     */
    @Query(value = """
        SELECT ril.ingredient_id, ril.sub_recipe_id, ril.quantity_used, ril.unit_of_measure
        FROM recipe_ingredient_lines ril
        WHERE ril.recipe_id = :recipeId
        ORDER BY ril.id
        """, nativeQuery = true)
    List<Object[]> findIngredientLinesByRecipeId(@Param("recipeId") UUID recipeId);
}
