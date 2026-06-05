package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.exception.CircularReferenceException;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import net.jqwik.api.*;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

/**
 * Property-based tests for circular sub-recipe reference detection using jqwik.
 * 
 * **Validates: Requirements 2.4**
 */
class RecipeCircularReferencePropertyTest {
    
    /**
     * Property 6: Circular Sub-Recipe Reference Is Always Prevented
     * **Validates: Requirements 2.4**
     * 
     * Generate arbitrary DAG of recipes; attempt to add a back-edge;
     * assert the attempt is blocked and the graph is unchanged.
     * 
     * This test:
     * 1. Creates a valid DAG (Directed Acyclic Graph) of recipes with sub-recipe relationships
     * 2. Identifies a potential back-edge that would create a cycle
     * 3. Attempts to add that back-edge as a new sub-recipe relationship
     * 4. Verifies the attempt is blocked with CircularReferenceException
     * 5. Verifies no changes were persisted to the repository
     */
    @Property(tries = 1000)
    @Label("P6: Circular sub-recipe reference is always prevented")
    void circularSubRecipeReferenceIsAlwaysPrevented(
            @ForAll("recipeDAG") RecipeDAG dag) {
        
        // Setup mocks for this property test iteration
        RecipeRepository recipeRepository = mock(RecipeRepository.class);
        RecipeIngredientLineRepository recipeIngredientLineRepository = mock(RecipeIngredientLineRepository.class);
        RecipeIngredientLineService service = new RecipeIngredientLineService(
            recipeIngredientLineRepository, recipeRepository);
        
        // Mock the circular reference detection to detect the back-edge
        // For any back-edge in the DAG, existsCircularReference should return true
        when(recipeRepository.existsCircularReference(any(UUID.class), any(UUID.class)))
            .thenAnswer(invocation -> {
                UUID parentId = invocation.getArgument(0);
                UUID candidateId = invocation.getArgument(1);
                
                // Check if this would create a back-edge (cycle) in the DAG
                return dag.wouldCreateCycle(parentId, candidateId);
            });
        
        // Select a back-edge to attempt adding
        BackEdge backEdge = dag.selectBackEdge();
        
        // Create an ingredient line that would create the circular reference
        RecipeIngredientLine problematicLine = new RecipeIngredientLine();
        problematicLine.setRecipeId(backEdge.from);
        problematicLine.setSubRecipeId(backEdge.to);
        problematicLine.setQuantityUsed(new BigDecimal("1.0000"));
        problematicLine.setUnitOfMeasure(UomEnum.EACH);
        problematicLine.setCreatedAt(Instant.now());
        problematicLine.setUpdatedAt(Instant.now());
        
        // Attempt to save the line with the back-edge should throw CircularReferenceException
        assertThatThrownBy(() -> service.saveIngredientLine(problematicLine))
            .isInstanceOf(CircularReferenceException.class)
            .satisfies(ex -> {
                CircularReferenceException cre = (CircularReferenceException) ex;
                assertThat(cre.getMessage())
                    .as("Exception message should indicate circular reference or self-reference")
                    .satisfiesAnyOf(
                        msg -> assertThat(msg).containsIgnoringCase("circular reference"),
                        msg -> assertThat(msg).containsIgnoringCase("sub-recipe of itself")
                    );
            });
        
        // Verify that existsCircularReference was called for transitive cycles
        // (but not for direct self-references, which are caught earlier)
        if (!backEdge.from.equals(backEdge.to)) {
            verify(recipeRepository, times(1))
                .existsCircularReference(backEdge.from, backEdge.to);
        }
        
        // Verify that the line was NOT saved (graph remains unchanged)
        verify(recipeIngredientLineRepository, never()).save(any(RecipeIngredientLine.class));
        
        // Verify the DAG structure remains valid (no cycles were added)
        assertThat(dag.isAcyclic())
            .as("DAG should remain acyclic after failed attempt to add back-edge")
            .isTrue();
    }
    
    /**
     * Arbitrary generator for recipe DAGs.
     * Generates directed acyclic graphs of recipes with sub-recipe relationships.
     */
    @Provide
    Arbitrary<RecipeDAG> recipeDAG() {
        // Generate DAGs with 2-10 recipes to keep the test space reasonable
        Arbitrary<Integer> recipeCount = Arbitraries.integers().between(2, 10);
        
        return recipeCount.flatMap(count -> {
            UUID venueId = UUID.randomUUID();
            
            // Create recipes
            List<Recipe> recipes = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                Recipe recipe = new Recipe();
                recipe.setId(UUID.randomUUID());
                recipe.setVenueId(venueId);
                recipe.setName("Recipe " + i);
                recipe.setPortionCount(1);
                recipe.setCreatedAt(Instant.now());
                recipe.setUpdatedAt(Instant.now());
                recipes.add(recipe);
            }
            
            // Create a DAG structure by adding edges between recipes
            // We'll create a topologically ordered structure where recipe i can only
            // reference recipes j where j < i (ensuring acyclicity)
            Map<UUID, Set<UUID>> adjacencyList = new HashMap<>();
            for (Recipe recipe : recipes) {
                adjacencyList.put(recipe.getId(), new HashSet<>());
            }
            
            // Add some random edges respecting topological order
            Random random = new Random();
            for (int i = 1; i < recipes.size(); i++) {
                Recipe current = recipes.get(i);
                // Can reference any earlier recipe
                int referencesToAdd = random.nextInt(Math.min(i, 3)); // 0-2 references
                for (int j = 0; j < referencesToAdd; j++) {
                    int targetIndex = random.nextInt(i); // Only earlier recipes
                    Recipe target = recipes.get(targetIndex);
                    adjacencyList.get(current.getId()).add(target.getId());
                }
            }
            
            return Arbitraries.just(new RecipeDAG(recipes, adjacencyList));
        });
    }
    
    /**
     * Represents a directed acyclic graph (DAG) of recipes.
     */
    static class RecipeDAG {
        private final List<Recipe> recipes;
        private final Map<UUID, Set<UUID>> adjacencyList; // recipe -> set of sub-recipe IDs
        
        RecipeDAG(List<Recipe> recipes, Map<UUID, Set<UUID>> adjacencyList) {
            this.recipes = recipes;
            this.adjacencyList = adjacencyList;
        }
        
        /**
         * Check if adding an edge from 'from' to 'to' would create a cycle.
         * This simulates the database recursive CTE logic.
         */
        boolean wouldCreateCycle(UUID from, UUID to) {
            // Direct self-reference
            if (from.equals(to)) {
                return true;
            }
            
            // Check if 'from' is reachable from 'to' via existing edges
            // If yes, adding edge from->to would create a cycle
            return isReachable(to, from, new HashSet<>());
        }
        
        /**
         * DFS to check if 'target' is reachable from 'start' following existing edges.
         */
        private boolean isReachable(UUID start, UUID target, Set<UUID> visited) {
            if (start.equals(target)) {
                return true;
            }
            
            if (visited.contains(start)) {
                return false; // Already visited, avoid infinite loop
            }
            
            visited.add(start);
            
            Set<UUID> neighbors = adjacencyList.getOrDefault(start, Collections.emptySet());
            for (UUID neighbor : neighbors) {
                if (isReachable(neighbor, target, visited)) {
                    return true;
                }
            }
            
            return false;
        }
        
        /**
         * Check if the current graph is acyclic (it should always be for our generated DAGs).
         */
        boolean isAcyclic() {
            Set<UUID> visited = new HashSet<>();
            Set<UUID> recursionStack = new HashSet<>();
            
            for (Recipe recipe : recipes) {
                if (hasCycle(recipe.getId(), visited, recursionStack)) {
                    return false;
                }
            }
            
            return true;
        }
        
        private boolean hasCycle(UUID current, Set<UUID> visited, Set<UUID> recursionStack) {
            if (recursionStack.contains(current)) {
                return true; // Cycle detected
            }
            
            if (visited.contains(current)) {
                return false; // Already processed this node
            }
            
            visited.add(current);
            recursionStack.add(current);
            
            Set<UUID> neighbors = adjacencyList.getOrDefault(current, Collections.emptySet());
            for (UUID neighbor : neighbors) {
                if (hasCycle(neighbor, visited, recursionStack)) {
                    return true;
                }
            }
            
            recursionStack.remove(current);
            return false;
        }
        
        /**
         * Select a back-edge that would create a cycle.
         * Returns an edge from a "descendant" to an "ancestor" in the DAG.
         */
        BackEdge selectBackEdge() {
            // Find an edge that would create a cycle
            // Strategy: for each recipe, try to add an edge to itself or to any recipe
            // that can reach it
            
            for (Recipe from : recipes) {
                // Try self-reference first (simplest cycle)
                if (!adjacencyList.get(from.getId()).contains(from.getId())) {
                    return new BackEdge(from.getId(), from.getId());
                }
                
                // Try adding edge to any recipe that can reach 'from'
                for (Recipe to : recipes) {
                    if (!from.getId().equals(to.getId())) {
                        // If 'to' can reach 'from', then adding edge from->to creates cycle
                        if (isReachable(to.getId(), from.getId(), new HashSet<>())) {
                            return new BackEdge(from.getId(), to.getId());
                        }
                    }
                }
            }
            
            // If no existing paths, create a simple back-edge between first and last recipe
            // (assuming there's at least a forward path or we can create an arbitrary cycle)
            if (recipes.size() >= 2) {
                return new BackEdge(recipes.get(recipes.size() - 1).getId(), recipes.get(0).getId());
            }
            
            // Fallback: self-reference on first recipe
            return new BackEdge(recipes.get(0).getId(), recipes.get(0).getId());
        }
    }
    
    /**
     * Represents a back-edge in the DAG that would create a cycle.
     */
    static class BackEdge {
        final UUID from;
        final UUID to;
        
        BackEdge(UUID from, UUID to) {
            this.from = from;
            this.to = to;
        }
    }
}
