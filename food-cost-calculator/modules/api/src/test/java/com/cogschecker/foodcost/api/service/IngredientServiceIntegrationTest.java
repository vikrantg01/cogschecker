package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.config.TestSqsConfig;
import com.cogschecker.foodcost.api.domain.Ingredient;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.RecipeIngredientLine;
import com.cogschecker.foodcost.api.exception.DeleteConflictException;
import com.cogschecker.foodcost.api.exception.DuplicateResourceException;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.repository.IngredientRepository;
import com.cogschecker.foodcost.api.repository.RecipeIngredientLineRepository;
import com.cogschecker.foodcost.shared.UomEnum;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

/**
 * Integration tests for IngredientService with actual database.
 * Tests Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
 */
@DataJpaTest
@Import({IngredientService.class, CostPropagationService.class, TestSqsConfig.class})
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.datasource.url=jdbc:h2:mem:testdb",
    "spring.flyway.enabled=false",
    "spring.cloud.aws.sqs.enabled=false",
    "sqs.queue.cost-propagation=https://sqs.us-east-1.amazonaws.com/test/test.fifo"
})
class IngredientServiceIntegrationTest {
    
    @Autowired
    private TestEntityManager entityManager;
    
    @Autowired
    private IngredientRepository ingredientRepository;
    
    @Autowired
    private RecipeIngredientLineRepository recipeIngredientLineRepository;
    
    @Autowired
    private IngredientService ingredientService;
    
    private UUID venueId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
    }
    
    @Test
    void createAndRetrieveIngredient_SuccessfulRoundTrip() {
        // When - create ingredient
        Ingredient created = ingredientService.createIngredient(
            venueId,
            "Olive Oil",
            new BigDecimal("25.00"),
            new BigDecimal("1.0000"),
            UomEnum.LITRE,
            new BigDecimal("100.00")
        );
        
        entityManager.flush();
        entityManager.clear();
        
        // Then - retrieve and verify
        Ingredient retrieved = ingredientService.getIngredient(venueId, created.getId());
        
        assertThat(retrieved.getName()).isEqualTo("Olive Oil");
        assertThat(retrieved.getPurchasePrice()).isEqualByComparingTo(new BigDecimal("25.00"));
        assertThat(retrieved.getPurchaseQuantity()).isEqualByComparingTo(new BigDecimal("1.0000"));
        assertThat(retrieved.getUnitOfMeasure()).isEqualTo(UomEnum.LITRE);
        assertThat(retrieved.getYieldPercentage()).isEqualByComparingTo(new BigDecimal("100.00"));
        
        // Verify computed fields
        assertThat(retrieved.getCostPerUnit()).isEqualByComparingTo(new BigDecimal("25.0000"));
        assertThat(retrieved.getEffectiveCostPerUsableUnit()).isEqualByComparingTo(new BigDecimal("25.0000"));
    }
    
    @Test
    void createIngredient_DuplicateNameCaseInsensitive_ThrowsException() {
        // Given - create first ingredient
        ingredientService.createIngredient(
            venueId,
            "Chicken Breast",
            new BigDecimal("50.00"),
            new BigDecimal("5.0000"),
            UomEnum.KILOGRAM,
            null
        );
        
        entityManager.flush();
        
        // When/Then - attempt to create with same name different case
        assertThatThrownBy(() -> ingredientService.createIngredient(
            venueId,
            "CHICKEN BREAST",
            new BigDecimal("55.00"),
            new BigDecimal("4.0000"),
            UomEnum.KILOGRAM,
            null
        ))
            .isInstanceOf(DuplicateResourceException.class)
            .hasMessageContaining("already exists");
    }
    
    @Test
    void updateIngredient_RecalculatesCosts() {
        // Given - create ingredient
        Ingredient ingredient = ingredientService.createIngredient(
            venueId,
            "Flour",
            new BigDecimal("20.00"),
            new BigDecimal("10.0000"),
            UomEnum.KILOGRAM,
            new BigDecimal("95.00")
        );
        
        entityManager.flush();
        entityManager.clear();
        
        // When - update price
        Ingredient updated = ingredientService.updateIngredient(
            venueId,
            ingredient.getId(),
            null,
            new BigDecimal("25.00"),
            null,
            null,
            null
        );
        
        // Then - cost fields recalculated
        // cost_per_unit = 25.00 / 10.0000 = 2.5000
        assertThat(updated.getCostPerUnit()).isEqualByComparingTo(new BigDecimal("2.5000"));
        
        // effective_cost = 2.5000 / 0.95 = 2.6316
        assertThat(updated.getEffectiveCostPerUsableUnit()).isEqualByComparingTo(new BigDecimal("2.6316"));
    }
    
    @Test
    void searchIngredients_CaseInsensitivePartialMatch() {
        // Given - create multiple ingredients
        ingredientService.createIngredient(
            venueId, "Chicken Breast", new BigDecimal("50.00"), new BigDecimal("5.0000"), 
            UomEnum.KILOGRAM, null
        );
        ingredientService.createIngredient(
            venueId, "Chicken Thigh", new BigDecimal("40.00"), new BigDecimal("5.0000"), 
            UomEnum.KILOGRAM, null
        );
        ingredientService.createIngredient(
            venueId, "Beef Mince", new BigDecimal("30.00"), new BigDecimal("3.0000"), 
            UomEnum.KILOGRAM, null
        );
        
        entityManager.flush();
        
        // When - search for "chicken"
        List<Ingredient> results = ingredientService.searchIngredients(venueId, "chicken");
        
        // Then - only chicken ingredients returned
        assertThat(results).hasSize(2);
        assertThat(results)
            .extracting(Ingredient::getName)
            .containsExactlyInAnyOrder("Chicken Breast", "Chicken Thigh");
    }
    
    @Test
    void deleteIngredient_WithRecipeReferences_RequiresConfirmation() {
        // Given - create ingredient
        Ingredient ingredient = ingredientService.createIngredient(
            venueId,
            "Tomato",
            new BigDecimal("10.00"),
            new BigDecimal("2.0000"),
            UomEnum.KILOGRAM,
            null
        );
        
        // Create recipe that references the ingredient
        Recipe recipe = new Recipe();
        recipe.setVenueId(venueId);
        recipe.setName("Tomato Sauce");
        recipe.setPortionCount(10);
        recipe.setCreatedAt(Instant.now());
        recipe.setUpdatedAt(Instant.now());
        entityManager.persist(recipe);
        
        // Create recipe ingredient line
        RecipeIngredientLine line = new RecipeIngredientLine();
        line.setRecipeId(recipe.getId());
        line.setIngredientId(ingredient.getId());
        line.setQuantityUsed(new BigDecimal("1.5000"));
        line.setUnitOfMeasure(UomEnum.KILOGRAM);
        line.setCreatedAt(Instant.now());
        line.setUpdatedAt(Instant.now());
        entityManager.persist(line);
        
        entityManager.flush();
        entityManager.clear();
        
        // When/Then - attempt delete without confirmation
        assertThatThrownBy(() -> ingredientService.deleteIngredient(venueId, ingredient.getId(), false))
            .isInstanceOf(DeleteConflictException.class)
            .hasMessageContaining("is used in")
            .satisfies(ex -> {
                DeleteConflictException dce = (DeleteConflictException) ex;
                @SuppressWarnings("unchecked")
                List<String> affected = (List<String>) dce.getDetails().get("affected_resources");
                assertThat(affected).contains("Tomato Sauce");
            });
        
        // Verify ingredient still exists
        assertThat(ingredientRepository.findByVenueIdAndId(venueId, ingredient.getId())).isPresent();
        
        // When - delete with confirmation
        ingredientService.deleteIngredient(venueId, ingredient.getId(), true);
        
        // Then - ingredient deleted
        assertThat(ingredientRepository.findByVenueIdAndId(venueId, ingredient.getId())).isEmpty();
    }
    
    @Test
    void deleteIngredient_NotReferenced_DeletesImmediately() {
        // Given
        Ingredient ingredient = ingredientService.createIngredient(
            venueId,
            "Salt",
            new BigDecimal("5.00"),
            new BigDecimal("1.0000"),
            UomEnum.KILOGRAM,
            null
        );
        
        entityManager.flush();
        UUID ingredientId = ingredient.getId();
        
        // When - delete without confirmation (no references)
        ingredientService.deleteIngredient(venueId, ingredientId, false);
        
        // Then - ingredient deleted
        assertThatThrownBy(() -> ingredientService.getIngredient(venueId, ingredientId))
            .isInstanceOf(ResourceNotFoundException.class);
    }
    
    @Test
    void getAllIngredients_ReturnsOnlyVenueIngredients() {
        // Given - create ingredients for two venues
        UUID venue1 = UUID.randomUUID();
        UUID venue2 = UUID.randomUUID();
        
        ingredientService.createIngredient(
            venue1, "Ingredient 1", new BigDecimal("10.00"), new BigDecimal("1.0000"), 
            UomEnum.KILOGRAM, null
        );
        ingredientService.createIngredient(
            venue1, "Ingredient 2", new BigDecimal("15.00"), new BigDecimal("1.0000"), 
            UomEnum.KILOGRAM, null
        );
        ingredientService.createIngredient(
            venue2, "Ingredient 3", new BigDecimal("20.00"), new BigDecimal("1.0000"), 
            UomEnum.KILOGRAM, null
        );
        
        entityManager.flush();
        
        // When - get all for venue1
        List<Ingredient> venue1Ingredients = ingredientService.getAllIngredients(venue1);
        
        // Then - only venue1 ingredients returned
        assertThat(venue1Ingredients).hasSize(2);
        assertThat(venue1Ingredients).allMatch(i -> i.getVenueId().equals(venue1));
    }
}
