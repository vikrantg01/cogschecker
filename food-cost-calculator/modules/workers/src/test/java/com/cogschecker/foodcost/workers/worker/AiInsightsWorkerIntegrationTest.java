package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.repository.*;
import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;
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
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration tests for AiInsightsWorker using WireMock for Bedrock API.
 * <p>
 * This test uses:
 * <ul>
 *   <li>Real Spring Boot context with H2 in-memory database</li>
 *   <li>Real JPA repositories for database operations</li>
 *   <li>WireMock to simulate Amazon Bedrock API responses</li>
 * </ul>
 * <p>
 * Tests verify:
 * <ul>
 *   <li>Insight upsert: Old insights are deleted and new ones are created</li>
 *   <li>Pro+ tier guard: Only Pro+ tier venues generate insights</li>
 *   <li>Autonomy constraint: Worker NEVER modifies recipes or ingredients (read-only)</li>
 *   <li>Sales data requirements: ≥ 30 days of Square sync history</li>
 *   <li>Bedrock API integration: Correct prompt construction and response parsing</li>
 * </ul>
 * <p>
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.8
 */
@SpringBootTest
@TestPropertySource(properties = {
        "aws.bedrock.model-id=anthropic.claude-3-sonnet-20240229-v1:0",
        "aws.bedrock.max-tokens=4096",
        "aws.bedrock.temperature=0.7",
        "scheduling.ai-insights.cron=0 0 2 * * *"
})
@Transactional
class AiInsightsWorkerIntegrationTest {

    @Autowired
    private VenueRepository venueRepository;

    @Autowired
    private OrganisationRepository organisationRepository;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private SquareConnectionRepository squareConnectionRepository;

    @Autowired
    private RecipeRepository recipeRepository;

    @Autowired
    private IngredientRepository ingredientRepository;

    @Autowired
    private AiInsightRepository aiInsightRepository;

    @Autowired
    private ObjectMapper objectMapper;

    private WireMockServer wireMockServer;
    private AiInsightsWorker worker;

    private UUID testOrgId;
    private UUID testVenueId;
    private Venue testVenue;
    private Subscription testSubscription;

    @BeforeEach
    void setUp() {
        // Start WireMock server on dynamic port
        wireMockServer = new WireMockServer(WireMockConfiguration.wireMockConfig().dynamicPort());
        wireMockServer.start();
        WireMock.configureFor("localhost", wireMockServer.port());

        // Create Bedrock client pointing to WireMock
        BedrockRuntimeClient bedrockRuntimeClient = BedrockRuntimeClient.builder()
                .region(Region.US_EAST_1)
                .endpointOverride(URI.create("http://localhost:" + wireMockServer.port()))
                .credentialsProvider(StaticCredentialsProvider.create(
                        AwsBasicCredentials.create("test", "test")))
                .build();

        // Create worker instance with real repositories and mocked Bedrock client
        worker = new AiInsightsWorker(
                venueRepository,
                subscriptionRepository,
                squareConnectionRepository,
                recipeRepository,
                ingredientRepository,
                aiInsightRepository,
                bedrockRuntimeClient,
                objectMapper,
                "anthropic.claude-3-sonnet-20240229-v1:0",
                4096,
                0.7
        );

        // Set up test data
        setupTestData();
    }

    @AfterEach
    void tearDown() {
        if (wireMockServer != null && wireMockServer.isRunning()) {
            wireMockServer.stop();
        }
    }

    private void setupTestData() {
        // Create organisation
        Organisation org = new Organisation("Test Organisation");
        testOrgId = organisationRepository.save(org).getId();

        // Create Pro+ subscription
        testSubscription = new Subscription(testOrgId, SubscriptionTier.PRO_PLUS);
        subscriptionRepository.save(testSubscription);

        // Create venue
        testVenue = new Venue(testOrgId, "Test Cafe", "123 Test Street");
        testVenueId = venueRepository.save(testVenue).getId();

        // Create Square connection with > 30 days of sync history
        SquareConnection squareConnection = new SquareConnection(
                testVenueId,
                "test-merchant-id",
                new byte[]{1, 2, 3}, // encrypted access token
                new byte[]{4, 5, 6}, // encrypted refresh token
                Instant.now().plusSeconds(48 * 3600) // expires in 48 hours
        );
        squareConnection.setLastSyncedAt(Instant.now().minus(35, ChronoUnit.DAYS)); // 35 days ago
        squareConnection.setSyncStatus(SquareConnection.SyncStatus.IDLE);
        squareConnectionRepository.save(squareConnection);

        // Create test ingredients
        createTestIngredients();

        // Create test recipes
        createTestRecipes();
    }

    private void createTestIngredients() {
        Ingredient tomatoes = new Ingredient(testVenueId, "Tomatoes", new BigDecimal("12.50"),
                new BigDecimal("5.0"), UomEnum.KILOGRAM, new BigDecimal("100.00"));
        tomatoes.setCostPerUnit(new BigDecimal("2.5000"));
        tomatoes.setEffectiveCostPerUsableUnit(new BigDecimal("2.5000"));
        ingredientRepository.save(tomatoes);

        Ingredient oliveOil = new Ingredient(testVenueId, "Olive Oil", new BigDecimal("18.00"),
                new BigDecimal("2.0"), UomEnum.LITRE, new BigDecimal("100.00"));
        oliveOil.setCostPerUnit(new BigDecimal("9.0000"));
        oliveOil.setEffectiveCostPerUsableUnit(new BigDecimal("9.0000"));
        ingredientRepository.save(oliveOil);

        Ingredient pasta = new Ingredient(testVenueId, "Pasta", new BigDecimal("8.00"),
                new BigDecimal("2.5"), UomEnum.KILOGRAM, new BigDecimal("100.00"));
        pasta.setCostPerUnit(new BigDecimal("3.2000"));
        pasta.setEffectiveCostPerUsableUnit(new BigDecimal("3.2000"));
        ingredientRepository.save(pasta);

        Ingredient cheese = new Ingredient(testVenueId, "Parmesan Cheese", new BigDecimal("25.00"),
                new BigDecimal("1.0"), UomEnum.KILOGRAM, new BigDecimal("100.00"));
        cheese.setCostPerUnit(new BigDecimal("25.0000"));
        cheese.setEffectiveCostPerUsableUnit(new BigDecimal("25.0000"));
        ingredientRepository.save(cheese);
    }

    private void createTestRecipes() {
        Recipe caesarSalad = new Recipe();
        caesarSalad.setVenueId(testVenueId);
        caesarSalad.setName("Caesar Salad");
        caesarSalad.setPortionCount(4);
        caesarSalad.setFoodCostPerPortion(new BigDecimal("3.50"));
        caesarSalad.setMenuSellingPrice(new BigDecimal("12.00"));
        caesarSalad.setFoodCostPercentage(new BigDecimal("29.2"));
        caesarSalad.setTotalBatchCost(new BigDecimal("14.00"));
        recipeRepository.save(caesarSalad);

        Recipe pastaCarbonara = new Recipe();
        pastaCarbonara.setVenueId(testVenueId);
        pastaCarbonara.setName("Pasta Carbonara");
        pastaCarbonara.setPortionCount(2);
        pastaCarbonara.setFoodCostPerPortion(new BigDecimal("5.80"));
        pastaCarbonara.setMenuSellingPrice(new BigDecimal("16.00"));
        pastaCarbonara.setFoodCostPercentage(new BigDecimal("36.3"));
        pastaCarbonara.setTotalBatchCost(new BigDecimal("11.60"));
        recipeRepository.save(pastaCarbonara);

        Recipe margheritaPizza = new Recipe();
        margheritaPizza.setVenueId(testVenueId);
        margheritaPizza.setName("Margherita Pizza");
        margheritaPizza.setPortionCount(1);
        margheritaPizza.setFoodCostPerPortion(new BigDecimal("4.20"));
        margheritaPizza.setMenuSellingPrice(new BigDecimal("14.00"));
        margheritaPizza.setFoodCostPercentage(new BigDecimal("30.0"));
        margheritaPizza.setTotalBatchCost(new BigDecimal("4.20"));
        recipeRepository.save(margheritaPizza);

        Recipe lasagna = new Recipe();
        lasagna.setVenueId(testVenueId);
        lasagna.setName("Lasagna");
        lasagna.setPortionCount(6);
        lasagna.setFoodCostPerPortion(new BigDecimal("6.50"));
        lasagna.setMenuSellingPrice(new BigDecimal("18.00"));
        lasagna.setFoodCostPercentage(new BigDecimal("36.1"));
        lasagna.setTotalBatchCost(new BigDecimal("39.00"));
        recipeRepository.save(lasagna);

        Recipe garlicBread = new Recipe();
        garlicBread.setVenueId(testVenueId);
        garlicBread.setName("Garlic Bread");
        garlicBread.setPortionCount(4);
        garlicBread.setFoodCostPerPortion(new BigDecimal("1.20"));
        garlicBread.setMenuSellingPrice(new BigDecimal("5.00"));
        garlicBread.setFoodCostPercentage(new BigDecimal("24.0"));
        garlicBread.setTotalBatchCost(new BigDecimal("4.80"));
        recipeRepository.save(garlicBread);
    }

    /**
     * Test that insights are correctly upserted: old insights are deleted, new ones are created.
     * <p>
     * Requirements: 13.1, 13.4 - Upsert insights to database
     */
    @Test
    void generateInsights_validProPlusVenue_shouldUpsertInsights() {
        // Arrange: Create existing insights (should be deleted)
        AiInsight oldInsight = new AiInsight(
                testVenueId,
                AiInsight.InsightType.RECIPE_PROFITABILITY,
                "Old Insight",
                "This should be deleted",
                Map.of("test", "data"),
                "Do nothing"
        );
        aiInsightRepository.save(oldInsight);

        assertThat(aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId)).hasSize(1);

        // Mock Bedrock response
        stubBedrockInvokeModel(createMockBedrockResponse());

        // Act: Generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Should succeed
        assertThat(result).isTrue();

        // Assert: Old insight should be deleted, new insights should be saved
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isNotEmpty();
        assertThat(insights).noneMatch(insight -> insight.getTitle().equals("Old Insight"));

        // Assert: New insights should be present
        assertThat(insights).anyMatch(insight ->
                insight.getInsightType() == AiInsight.InsightType.RECIPE_PROFITABILITY);
        assertThat(insights).anyMatch(insight ->
                insight.getInsightType() == AiInsight.InsightType.SUPPLIER_COST);

        // Assert: All insights should have required fields
        for (AiInsight insight : insights) {
            assertThat(insight.getVenueId()).isEqualTo(testVenueId);
            assertThat(insight.getTitle()).isNotBlank();
            assertThat(insight.getExplanation()).isNotBlank();
            assertThat(insight.getRecommendedAction()).isNotBlank();
            assertThat(insight.getStatus()).isEqualTo(AiInsight.Status.ACTIVE);
            assertThat(insight.getGeneratedAt()).isNotNull();
        }
    }

    /**
     * Test that only Pro+ tier venues generate insights.
     * <p>
     * Requirements: 13.1 - Pro+ tier requirement
     */
    @Test
    void generateInsights_freeTierVenue_shouldNotGenerateInsights() {
        // Arrange: Change subscription to Free tier
        testSubscription.setTier(SubscriptionTier.FREE);
        subscriptionRepository.save(testSubscription);

        // Act: Attempt to generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Should return false (skipped)
        assertThat(result).isFalse();

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();

        // Verify no Bedrock API call was made
        verify(exactly(0), postRequestedFor(urlPathMatching("/model/.*")));
    }

    /**
     * Test that Pro tier (not Pro+) does not generate insights.
     * <p>
     * Requirements: 13.1 - Pro+ tier requirement (Pro is not sufficient)
     */
    @Test
    void generateInsights_proTierVenue_shouldNotGenerateInsights() {
        // Arrange: Change subscription to Pro tier
        testSubscription.setTier(SubscriptionTier.PRO);
        subscriptionRepository.save(testSubscription);

        // Act: Attempt to generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Should return false (skipped)
        assertThat(result).isFalse();

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();

        // Verify no Bedrock API call was made
        verify(exactly(0), postRequestedFor(urlPathMatching("/model/.*")));
    }

    /**
     * CRITICAL TEST: Verify autonomy constraint - worker NEVER modifies recipes or ingredients.
     * <p>
     * The AI worker is read-only. It generates recommendations but does NOT apply them.
     * <p>
     * Requirements: 13.8 - Autonomy constraint (no recipe/ingredient modification)
     */
    @Test
    void generateInsights_autonomyConstraint_shouldNeverModifyRecipesOrIngredients() {
        // Arrange: Capture initial state of all recipes and ingredients
        List<Recipe> recipesBefore = recipeRepository.findByVenueId(testVenueId);
        List<Ingredient> ingredientsBefore = ingredientRepository.findByVenueId(testVenueId);

        Map<UUID, RecipeSnapshot> recipeSnapshotsBefore = new HashMap<>();
        for (Recipe recipe : recipesBefore) {
            recipeSnapshotsBefore.put(recipe.getId(), new RecipeSnapshot(recipe));
        }

        Map<UUID, IngredientSnapshot> ingredientSnapshotsBefore = new HashMap<>();
        for (Ingredient ingredient : ingredientsBefore) {
            ingredientSnapshotsBefore.put(ingredient.getId(), new IngredientSnapshot(ingredient));
        }

        // Mock Bedrock response
        stubBedrockInvokeModel(createMockBedrockResponse());

        // Act: Generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Insights should be generated
        assertThat(result).isTrue();

        // Assert: Verify recipes are UNCHANGED
        List<Recipe> recipesAfter = recipeRepository.findByVenueId(testVenueId);
        assertThat(recipesAfter).hasSameSizeAs(recipesBefore);

        for (Recipe recipeAfter : recipesAfter) {
            RecipeSnapshot snapshotBefore = recipeSnapshotsBefore.get(recipeAfter.getId());
            assertThat(snapshotBefore).isNotNull();

            assertThat(recipeAfter.getName()).isEqualTo(snapshotBefore.name);
            assertThat(recipeAfter.getPortionCount()).isEqualTo(snapshotBefore.portionCount);
            assertThat(recipeAfter.getMenuSellingPrice()).isEqualByComparingTo(snapshotBefore.menuSellingPrice);
            assertThat(recipeAfter.getFoodCostPerPortion()).isEqualByComparingTo(snapshotBefore.foodCostPerPortion);
            assertThat(recipeAfter.getFoodCostPercentage()).isEqualByComparingTo(snapshotBefore.foodCostPercentage);
            assertThat(recipeAfter.getTotalBatchCost()).isEqualByComparingTo(snapshotBefore.totalBatchCost);
        }

        // Assert: Verify ingredients are UNCHANGED
        List<Ingredient> ingredientsAfter = ingredientRepository.findByVenueId(testVenueId);
        assertThat(ingredientsAfter).hasSameSizeAs(ingredientsBefore);

        for (Ingredient ingredientAfter : ingredientsAfter) {
            IngredientSnapshot snapshotBefore = ingredientSnapshotsBefore.get(ingredientAfter.getId());
            assertThat(snapshotBefore).isNotNull();

            assertThat(ingredientAfter.getName()).isEqualTo(snapshotBefore.name);
            assertThat(ingredientAfter.getPurchasePrice()).isEqualByComparingTo(snapshotBefore.purchasePrice);
            assertThat(ingredientAfter.getPurchaseQuantity()).isEqualByComparingTo(snapshotBefore.purchaseQuantity);
            assertThat(ingredientAfter.getUnitOfMeasure()).isEqualTo(snapshotBefore.unitOfMeasure);
            assertThat(ingredientAfter.getYieldPercentage()).isEqualByComparingTo(snapshotBefore.yieldPercentage);
            assertThat(ingredientAfter.getCostPerUnit()).isEqualByComparingTo(snapshotBefore.costPerUnit);
            assertThat(ingredientAfter.getEffectiveCostPerUsableUnit()).isEqualByComparingTo(snapshotBefore.effectiveCostPerUsableUnit);
        }

        // Assert: Insights were created (recommendations only, not applied)
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isNotEmpty();
        assertThat(insights).allMatch(insight -> insight.getStatus() == AiInsight.Status.ACTIVE);
    }

    /**
     * Test that venues without sufficient sales data do not generate insights.
     * <p>
     * Requirements: 13.1 - Require ≥ 30 days of sales data
     */
    @Test
    void generateInsights_insufficientSalesData_shouldNotGenerateInsights() {
        // Arrange: Update Square connection to have only 15 days of sync history
        SquareConnection connection = squareConnectionRepository.findByVenueId(testVenueId).orElseThrow();
        connection.setLastSyncedAt(Instant.now().minus(15, ChronoUnit.DAYS));
        squareConnectionRepository.save(connection);

        // Act: Attempt to generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Should return false (skipped)
        assertThat(result).isFalse();

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();

        // Verify no Bedrock API call was made
        verify(exactly(0), postRequestedFor(urlPathMatching("/model/.*")));
    }

    /**
     * Test that venues without Square connection do not generate insights.
     * <p>
     * Requirements: 13.1 - Require Square connection with sales data
     */
    @Test
    void generateInsights_noSquareConnection_shouldNotGenerateInsights() {
        // Arrange: Delete Square connection
        squareConnectionRepository.deleteByVenueId(testVenueId);

        // Act: Attempt to generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Should return false (skipped)
        assertThat(result).isFalse();

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();

        // Verify no Bedrock API call was made
        verify(exactly(0), postRequestedFor(urlPathMatching("/model/.*")));
    }

    /**
     * Test that venues with no recipes do not generate insights.
     * <p>
     * Requirements: 13.1 - Require at least one recipe
     */
    @Test
    void generateInsights_noRecipes_shouldNotGenerateInsights() {
        // Arrange: Delete all recipes
        recipeRepository.deleteAll(recipeRepository.findByVenueId(testVenueId));

        // Act: Attempt to generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Should return false (skipped)
        assertThat(result).isFalse();

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();

        // Verify no Bedrock API call was made
        verify(exactly(0), postRequestedFor(urlPathMatching("/model/.*")));
    }

    /**
     * Test that Bedrock API failure does not throw exception and returns false.
     * <p>
     * Requirements: 13.4 - Mark insights as stale on Bedrock failure
     */
    @Test
    void generateInsights_bedrockApiFailure_shouldReturnFalseAndNotSaveInsights() {
        // Arrange: Mock Bedrock API to return error
        stubFor(post(urlPathMatching("/model/.*"))
                .willReturn(aResponse()
                        .withStatus(500)
                        .withBody("{\"message\": \"Internal server error\"}")));

        // Act: Attempt to generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Should return false (not throw exception)
        assertThat(result).isFalse();

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();
    }

    /**
     * Test that invalid Bedrock response does not throw exception and returns false.
     * <p>
     * Requirements: 13.1 - Validate JSON response against schema
     */
    @Test
    void generateInsights_invalidBedrockResponse_shouldReturnFalseAndNotSaveInsights() {
        // Arrange: Mock Bedrock with invalid JSON response
        stubBedrockInvokeModel("This is not valid JSON");

        // Act: Attempt to generate insights
        boolean result = worker.generateInsightsForVenue(testVenueId);

        // Assert: Should return false (not throw exception)
        assertThat(result).isFalse();

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();
    }

    /**
     * Test on-demand generation via SQS message with valid payload.
     * <p>
     * Requirements: 13.4 - On-demand generation after Square sync or invoice confirm
     */
    @Test
    void processOnDemandGeneration_validMessage_shouldGenerateInsights() {
        // Arrange: Create SQS message
        Map<String, String> message = new HashMap<>();
        message.put("venueId", testVenueId.toString());
        message.put("trigger", "square_sync");
        message.put("timestamp", String.valueOf(System.currentTimeMillis()));

        // Mock Bedrock response
        stubBedrockInvokeModel(createMockBedrockResponse());

        // Act: Process message
        worker.processOnDemandGeneration(message);

        // Assert: Insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isNotEmpty();

        // Verify Bedrock was called
        verify(exactly(1), postRequestedFor(urlPathMatching("/model/.*")));
    }

    /**
     * Test on-demand generation with null venueId throws exception.
     * <p>
     * Requirements: 13.4 - Validate SQS message payload
     */
    @Test
    void processOnDemandGeneration_nullVenueId_shouldThrowException() {
        // Arrange: Create invalid message
        Map<String, String> message = new HashMap<>();
        message.put("venueId", null);
        message.put("trigger", "square_sync");

        // Act & Assert: Should throw exception
        try {
            worker.processOnDemandGeneration(message);
            Assertions.fail("Expected IllegalArgumentException to be thrown");
        } catch (IllegalArgumentException e) {
            assertThat(e.getMessage()).contains("venueId");
        }

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();
    }

    /**
     * Test on-demand generation with invalid UUID format throws exception.
     * <p>
     * Requirements: 13.4 - Validate SQS message payload
     */
    @Test
    void processOnDemandGeneration_invalidUuidFormat_shouldThrowException() {
        // Arrange: Create invalid message
        Map<String, String> message = new HashMap<>();
        message.put("venueId", "not-a-uuid");
        message.put("trigger", "square_sync");

        // Act & Assert: Should throw exception
        try {
            worker.processOnDemandGeneration(message);
            Assertions.fail("Expected IllegalArgumentException to be thrown");
        } catch (IllegalArgumentException e) {
            assertThat(e.getMessage()).contains("UUID");
        }

        // Assert: No insights should be created
        List<AiInsight> insights = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(insights).isEmpty();
    }

    /**
     * Test that insight upsert behavior replaces all existing insights.
     * <p>
     * Requirements: 13.4 - Refresh insights (upsert = delete old + insert new)
     */
    @Test
    void generateInsights_multipleRuns_shouldReplaceAllInsights() {
        // Arrange: First generation
        stubBedrockInvokeModel(createMockBedrockResponse());
        worker.generateInsightsForVenue(testVenueId);

        List<AiInsight> firstGeneration = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(firstGeneration).isNotEmpty();
        int firstGenerationCount = firstGeneration.size();
        Set<UUID> firstGenerationIds = new HashSet<>();
        for (AiInsight insight : firstGeneration) {
            firstGenerationIds.add(insight.getId());
        }

        // Act: Second generation (different response)
        String differentResponse = """
                [
                  {
                    "insightType": "recipe_profitability",
                    "title": "New Insight from Second Generation",
                    "explanation": "This is a new insight.",
                    "supportingData": {"test": "data"},
                    "recommendedAction": "Take action"
                  }
                ]
                """;
        stubBedrockInvokeModel(differentResponse);
        worker.generateInsightsForVenue(testVenueId);

        // Assert: All old insights should be deleted
        List<AiInsight> secondGeneration = aiInsightRepository.findByVenueIdOrderByGeneratedAtDesc(testVenueId);
        assertThat(secondGeneration).isNotEmpty();

        // None of the old IDs should exist
        for (AiInsight insight : secondGeneration) {
            assertThat(firstGenerationIds).doesNotContain(insight.getId());
        }

        // New insight should be present
        assertThat(secondGeneration).anyMatch(insight ->
                insight.getTitle().equals("New Insight from Second Generation"));
    }

    // Helper methods

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
                    "insightType": "recipe_profitability",
                    "title": "Lasagna exceeds target food cost",
                    "explanation": "Lasagna has a food cost percentage of 36.1%, slightly above the 30% target.",
                    "supportingData": {
                      "recipeName": "Lasagna",
                      "currentFoodCostPercentage": 36.1,
                      "targetFoodCostPercentage": 30.0
                    },
                    "recommendedAction": "Review cheese usage and explore more affordable alternatives."
                  },
                  {
                    "insightType": "supplier_cost",
                    "title": "Parmesan Cheese price appears high",
                    "explanation": "The current purchase price of $25.00 per kg is above typical market rates.",
                    "supportingData": {
                      "ingredientName": "Parmesan Cheese",
                      "currentPrice": 25.00,
                      "suggestedPrice": 20.00
                    },
                    "recommendedAction": "Review alternative suppliers or negotiate better pricing with your current supplier."
                  },
                  {
                    "insightType": "supplier_cost",
                    "title": "Olive Oil cost has increased",
                    "explanation": "Olive oil is priced at $9.00 per liter, which may be higher than necessary.",
                    "supportingData": {
                      "ingredientName": "Olive Oil",
                      "currentPrice": 9.00,
                      "suggestedPrice": 7.50
                    },
                    "recommendedAction": "Consider switching to a more cost-effective olive oil supplier."
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

        stubFor(post(urlPathMatching("/model/.*"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(bedrockResponseBody)));
    }

    /**
     * Snapshot class to capture recipe state for autonomy constraint verification.
     */
    private static class RecipeSnapshot {
        final String name;
        final Integer portionCount;
        final BigDecimal menuSellingPrice;
        final BigDecimal foodCostPerPortion;
        final BigDecimal foodCostPercentage;
        final BigDecimal totalBatchCost;

        RecipeSnapshot(Recipe recipe) {
            this.name = recipe.getName();
            this.portionCount = recipe.getPortionCount();
            this.menuSellingPrice = recipe.getMenuSellingPrice();
            this.foodCostPerPortion = recipe.getFoodCostPerPortion();
            this.foodCostPercentage = recipe.getFoodCostPercentage();
            this.totalBatchCost = recipe.getTotalBatchCost();
        }
    }

    /**
     * Snapshot class to capture ingredient state for autonomy constraint verification.
     */
    private static class IngredientSnapshot {
        final String name;
        final BigDecimal purchasePrice;
        final BigDecimal purchaseQuantity;
        final UomEnum unitOfMeasure;
        final BigDecimal yieldPercentage;
        final BigDecimal costPerUnit;
        final BigDecimal effectiveCostPerUsableUnit;

        IngredientSnapshot(Ingredient ingredient) {
            this.name = ingredient.getName();
            this.purchasePrice = ingredient.getPurchasePrice();
            this.purchaseQuantity = ingredient.getPurchaseQuantity();
            this.unitOfMeasure = ingredient.getUnitOfMeasure();
            this.yieldPercentage = ingredient.getYieldPercentage();
            this.costPerUnit = ingredient.getCostPerUnit();
            this.effectiveCostPerUsableUnit = ingredient.getEffectiveCostPerUsableUnit();
        }
    }
}
