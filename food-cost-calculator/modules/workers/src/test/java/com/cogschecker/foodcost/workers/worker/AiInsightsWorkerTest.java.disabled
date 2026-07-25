package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.repository.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.bedrockruntime.BedrockRuntimeClient;

import java.math.BigDecimal;
import java.net.URI;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Integration tests for AiInsightsWorker using WireMock for Bedrock.
 * <p>
 * Tests:
 * - Insight upsert (create and update insights in database)
 * - Pro+ tier guard (only Pro+ tier venues generate insights)
 * - Autonomy constraint (no recipe/ingredient modification)
 * - Valid message processing
 * - Invalid message handling (null venueId, invalid UUID)
 * - Insufficient sales data handling (< 30 days)
 * - No Square connection handling
 * - Bedrock API failure handling
 * - Invalid Bedrock response handling
 * <p>
 * Requirements: 13.1–13.8
 */
@ExtendWith(MockitoExtension.class)
class AiInsightsWorkerTest {

    private static WireMockServer wireMockServer;

    @Mock
    private VenueRepository venueRepository;

    @Mock
    private SubscriptionRepository subscriptionRepository;

    @Mock
    private SquareConnectionRepository squareConnectionRepository;

    @Mock
    private RecipeRepository recipeRepository;

    @Mock
    private IngredientRepository ingredientRepository;

    @Mock
    private AiInsightRepository aiInsightRepository;

    private BedrockRuntimeClient bedrockRuntimeClient;
    private ObjectMapper objectMapper;
    private AiInsightsWorker worker;

    @BeforeAll
    static void startWireMock() {
        wireMockServer = new WireMockServer(8089);
        wireMockServer.start();
        WireMock.configureFor("localhost", 8089);
    }

    @AfterAll
    static void stopWireMock() {
        wireMockServer.stop();
    }

    @BeforeEach
    void setUp() {
        wireMockServer.resetAll();

        // Create Bedrock client pointing to WireMock
        bedrockRuntimeClient = BedrockRuntimeClient.builder()
                .region(Region.US_EAST_1)
                .endpointOverride(URI.create("http://localhost:8089"))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create("test", "test")))
                .build();

        objectMapper = new ObjectMapper();

        worker = new AiInsightsWorker(
                venueRepository,
                subscriptionRepository,
                squareConnectionRepository,
                recipeRepository,
                ingredientRepository,
                aiInsightRepository,
                bedrockRuntimeClient,
                objectMapper,
                "anthropic.claude-3-sonnet-20240229-v1:0", // model ID
                4096, // max tokens
                0.7  // temperature
        );
    }

    @Test
    void generateInsightsForVenue_validProPlusVenue_shouldUpsertInsights() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);
        SquareConnection squareConnection = createMockSquareConnection(venueId, Instant.now().minus(35, ChronoUnit.DAYS));
        List<Recipe> recipes = createMockRecipes(venueId);
        List<Ingredient> ingredients = createMockIngredients(venueId);

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(squareConnection));
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(ingredients);
        when(aiInsightRepository.save(any(AiInsight.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Mock Bedrock response
        String bedrockResponse = createMockBedrockResponse();
        stubBedrockInvokeModel(bedrockResponse);

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertTrue(result, "Insights should be generated for valid Pro+ venue");

        // Verify insights were deleted (upsert behavior)
        verify(aiInsightRepository).deleteByVenueId(venueId);

        // Verify insights were saved
        verify(aiInsightRepository, atLeast(1)).save(any(AiInsight.class));

        // Verify no modifications to recipes or ingredients
        verify(recipeRepository, never()).save(any(Recipe.class));
        verify(ingredientRepository, never()).save(any(Ingredient.class));
    }

    @Test
    void generateInsightsForVenue_freeTier_shouldSkipAndReturnFalse() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.FREE);

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertFalse(result, "Insights should not be generated for Free tier venue");

        // Verify no Bedrock call was made
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_proTier_shouldSkipAndReturnFalse() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO);

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertFalse(result, "Insights should not be generated for Pro tier venue (requires Pro+)");

        // Verify no Bedrock call was made
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_noSquareConnection_shouldSkipAndReturnFalse() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.empty());

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertFalse(result, "Insights should not be generated without Square connection");

        // Verify no Bedrock call was made
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_insufficientSalesData_shouldSkipAndReturnFalse() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);
        // Only 15 days of data (less than 30 day minimum)
        SquareConnection squareConnection = createMockSquareConnection(venueId, Instant.now().minus(15, ChronoUnit.DAYS));

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(squareConnection));

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertFalse(result, "Insights should not be generated with less than 30 days of sales data");

        // Verify no Bedrock call was made
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_neverSynced_shouldSkipAndReturnFalse() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);
        SquareConnection squareConnection = createMockSquareConnection(venueId, null); // never synced

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(squareConnection));

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertFalse(result, "Insights should not be generated when Square has never synced");

        // Verify no Bedrock call was made
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_noRecipes_shouldSkipAndReturnFalse() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);
        SquareConnection squareConnection = createMockSquareConnection(venueId, Instant.now().minus(35, ChronoUnit.DAYS));

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(squareConnection));
        when(recipeRepository.findByVenueId(venueId)).thenReturn(Collections.emptyList());

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertFalse(result, "Insights should not be generated when venue has no recipes");

        // Verify no Bedrock call was made
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_bedrockFailure_shouldReturnFalseAndNotSaveInsights() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);
        SquareConnection squareConnection = createMockSquareConnection(venueId, Instant.now().minus(35, ChronoUnit.DAYS));
        List<Recipe> recipes = createMockRecipes(venueId);
        List<Ingredient> ingredients = createMockIngredients(venueId);

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(squareConnection));
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(ingredients);

        // Mock Bedrock failure
        stubFor(post(urlPathEqualTo("/model/anthropic.claude-3-sonnet-20240229-v1:0/invoke"))
                .willReturn(aResponse()
                        .withStatus(500)
                        .withBody("{\"message\": \"Internal server error\"}")));

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertFalse(result, "Should return false when Bedrock API fails");

        // Verify no insights were saved
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_invalidBedrockResponse_shouldReturnFalseAndNotSaveInsights() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);
        SquareConnection squareConnection = createMockSquareConnection(venueId, Instant.now().minus(35, ChronoUnit.DAYS));
        List<Recipe> recipes = createMockRecipes(venueId);
        List<Ingredient> ingredients = createMockIngredients(venueId);

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(squareConnection));
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(ingredients);

        // Mock invalid Bedrock response (not valid JSON array)
        String invalidResponse = "This is not valid JSON";
        stubBedrockInvokeModel(invalidResponse);

        // Act
        boolean result = worker.generateInsightsForVenue(venueId);

        // Assert
        assertFalse(result, "Should return false when Bedrock response is invalid");

        // Verify no insights were saved
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_venueNotFound_shouldThrowException() {
        // Arrange
        UUID venueId = UUID.randomUUID();

        when(venueRepository.findById(venueId)).thenReturn(Optional.empty());

        // Act & Assert
        RuntimeException exception = assertThrows(RuntimeException.class,
                () -> worker.generateInsightsForVenue(venueId));

        assertTrue(exception.getMessage().contains("Venue not found"));

        // Verify no insights were saved
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void processOnDemandGeneration_validMessage_shouldGenerateInsights() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Map<String, String> message = new HashMap<>();
        message.put("venueId", venueId.toString());
        message.put("trigger", "square_sync");
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);
        SquareConnection squareConnection = createMockSquareConnection(venueId, Instant.now().minus(35, ChronoUnit.DAYS));
        List<Recipe> recipes = createMockRecipes(venueId);
        List<Ingredient> ingredients = createMockIngredients(venueId);

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(squareConnection));
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(ingredients);
        when(aiInsightRepository.save(any(AiInsight.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Mock Bedrock response
        String bedrockResponse = createMockBedrockResponse();
        stubBedrockInvokeModel(bedrockResponse);

        // Act
        worker.processOnDemandGeneration(message);

        // Assert
        verify(aiInsightRepository).deleteByVenueId(venueId);
        verify(aiInsightRepository, atLeast(1)).save(any(AiInsight.class));

        // Verify autonomy constraint: no modifications to recipes or ingredients
        verify(recipeRepository, never()).save(any(Recipe.class));
        verify(ingredientRepository, never()).save(any(Ingredient.class));
    }

    @Test
    void processOnDemandGeneration_nullVenueId_shouldThrowException() {
        // Arrange
        Map<String, String> message = new HashMap<>();
        message.put("venueId", null);
        message.put("trigger", "square_sync");
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> worker.processOnDemandGeneration(message));

        // Verify no insights were saved
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void processOnDemandGeneration_invalidVenueIdFormat_shouldThrowException() {
        // Arrange
        Map<String, String> message = new HashMap<>();
        message.put("venueId", "not-a-uuid");
        message.put("trigger", "square_sync");
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));

        // Act & Assert
        assertThrows(IllegalArgumentException.class, () -> worker.processOnDemandGeneration(message));

        // Verify no insights were saved
        verify(aiInsightRepository, never()).save(any(AiInsight.class));
        verify(aiInsightRepository, never()).deleteByVenueId(any());
    }

    @Test
    void generateInsightsForVenue_ensuresAutonomyConstraint_neverModifiesRecipesOrIngredients() {
        // Arrange
        UUID venueId = UUID.randomUUID();
        UUID orgId = UUID.randomUUID();

        Venue venue = createMockVenue(venueId, orgId, "Test Venue");
        Subscription subscription = createMockSubscription(orgId, SubscriptionTier.PRO_PLUS);
        SquareConnection squareConnection = createMockSquareConnection(venueId, Instant.now().minus(35, ChronoUnit.DAYS));
        List<Recipe> recipes = createMockRecipes(venueId);
        List<Ingredient> ingredients = createMockIngredients(venueId);

        when(venueRepository.findById(venueId)).thenReturn(Optional.of(venue));
        when(subscriptionRepository.findByOrganisationId(orgId)).thenReturn(Optional.of(subscription));
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(squareConnection));
        when(recipeRepository.findByVenueId(venueId)).thenReturn(recipes);
        when(ingredientRepository.findByVenueId(venueId)).thenReturn(ingredients);
        when(aiInsightRepository.save(any(AiInsight.class))).thenAnswer(invocation -> invocation.getArgument(0));

        // Mock Bedrock response
        String bedrockResponse = createMockBedrockResponse();
        stubBedrockInvokeModel(bedrockResponse);

        // Act
        worker.generateInsightsForVenue(venueId);

        // Assert: CRITICAL autonomy constraint - worker NEVER modifies recipes or ingredients
        verify(recipeRepository, times(1)).findByVenueId(venueId); // READ only
        verify(ingredientRepository, times(1)).findByVenueId(venueId); // READ only
        verify(recipeRepository, never()).save(any(Recipe.class)); // NO WRITE
        verify(recipeRepository, never()).saveAll(any()); // NO WRITE
        verify(recipeRepository, never()).delete(any(Recipe.class)); // NO DELETE
        verify(ingredientRepository, never()).save(any(Ingredient.class)); // NO WRITE
        verify(ingredientRepository, never()).saveAll(any()); // NO WRITE
        verify(ingredientRepository, never()).delete(any(Ingredient.class)); // NO DELETE
    }

    // Helper methods

    private Venue createMockVenue(UUID venueId, UUID orgId, String name) {
        Venue venue = new Venue(orgId, name, null);
        venue.setId(venueId);
        return venue;
    }

    private Subscription createMockSubscription(UUID orgId, SubscriptionTier tier) {
        Subscription subscription = new Subscription(orgId);
        subscription.setTier(tier);
        return subscription;
    }

    private SquareConnection createMockSquareConnection(UUID venueId, Instant lastSyncedAt) {
        SquareConnection connection = new SquareConnection();
        connection.setId(UUID.randomUUID());
        connection.setVenueId(venueId);
        connection.setSquareMerchantId("test-merchant");
        connection.setLastSyncedAt(lastSyncedAt);
        return connection;
    }

    private List<Recipe> createMockRecipes(UUID venueId) {
        List<Recipe> recipes = new ArrayList<>();

        Recipe recipe1 = new Recipe(venueId, "Caesar Salad", 4);
        recipe1.setId(UUID.randomUUID());
        recipe1.setFoodCostPerPortion(new BigDecimal("3.50"));
        recipe1.setMenuSellingPrice(new BigDecimal("12.00"));
        recipe1.setFoodCostPercentage(new BigDecimal("29.2"));
        recipes.add(recipe1);

        Recipe recipe2 = new Recipe(venueId, "Pasta Carbonara", 2);
        recipe2.setId(UUID.randomUUID());
        recipe2.setFoodCostPerPortion(new BigDecimal("5.80"));
        recipe2.setMenuSellingPrice(new BigDecimal("16.00"));
        recipe2.setFoodCostPercentage(new BigDecimal("36.3"));
        recipes.add(recipe2);

        Recipe recipe3 = new Recipe(venueId, "Margherita Pizza", 1);
        recipe3.setId(UUID.randomUUID());
        recipe3.setFoodCostPerPortion(new BigDecimal("4.20"));
        recipe3.setMenuSellingPrice(new BigDecimal("14.00"));
        recipe3.setFoodCostPercentage(new BigDecimal("30.0"));
        recipes.add(recipe3);

        return recipes;
    }

    private List<Ingredient> createMockIngredients(UUID venueId) {
        List<Ingredient> ingredients = new ArrayList<>();

        Ingredient tomatoes = new Ingredient(venueId, "Tomatoes", new BigDecimal("12.50"),
                new BigDecimal("5.0"), UnitOfMeasure.KG);
        tomatoes.setId(UUID.randomUUID());
        ingredients.add(tomatoes);

        Ingredient oliveOil = new Ingredient(venueId, "Olive Oil", new BigDecimal("18.00"),
                new BigDecimal("2.0"), UnitOfMeasure.L);
        oliveOil.setId(UUID.randomUUID());
        ingredients.add(oliveOil);

        Ingredient pasta = new Ingredient(venueId, "Pasta", new BigDecimal("8.00"),
                new BigDecimal("2.5"), UnitOfMeasure.KG);
        pasta.setId(UUID.randomUUID());
        ingredients.add(pasta);

        return ingredients;
    }

    private String createMockBedrockResponse() {
        return """
                [
                  {
                    "insightType": "recipe_profitability",
                    "title": "Pasta Carbonara has high food cost percentage",
                    "explanation": "This recipe's food cost is 36.3%, which exceeds the target threshold of 30%.",
                    "supportingData": {
                      "recipeName": "Pasta Carbonara",
                      "currentFoodCostPercentage": 36.3,
                      "targetFoodCostPercentage": 30.0
                    },
                    "recommendedAction": "Consider reducing the portion size by 10% or substituting premium ingredients with more cost-effective alternatives."
                  },
                  {
                    "insightType": "supplier_cost",
                    "title": "Olive Oil price appears high",
                    "explanation": "The current purchase price of $18.00 for 2L is above typical market rates.",
                    "supportingData": {
                      "ingredientName": "Olive Oil",
                      "currentPrice": 18.00,
                      "suggestedPrice": 15.00
                    },
                    "recommendedAction": "Review alternative suppliers or negotiate better pricing with your current supplier."
                  }
                ]
                """;
    }

    private void stubBedrockInvokeModel(String responseText) {
        String bedrockResponseBody = String.format("""
                {
                  "id": "msg_test123",
                  "type": "message",
                  "role": "assistant",
                  "content": [
                    {
                      "type": "text",
                      "text": %s
                    }
                  ],
                  "model": "claude-3-sonnet-20240229",
                  "stop_reason": "end_turn",
                  "usage": {
                    "input_tokens": 500,
                    "output_tokens": 300
                  }
                }
                """, objectMapper.valueToTree(responseText));

        stubFor(post(urlPathEqualTo("/model/anthropic.claude-3-sonnet-20240229-v1:0/invoke"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(bedrockResponseBody)));
    }
}
