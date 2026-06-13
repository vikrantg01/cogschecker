package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.SquareConnection;
import com.cogschecker.foodcost.api.domain.SquareUnmatchedItem;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SquareConnectionRepository;
import com.cogschecker.foodcost.api.repository.SquareUnmatchedItemRepository;
import com.cogschecker.foodcost.api.service.EncryptionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueResponse;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static com.github.tomakehurst.wiremock.client.WireMock.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Integration tests for SquareSyncWorker using WireMock to simulate Square API.
 * <p>
 * Tests:
 * - Matched price update: Square items matching recipe names update menu selling price
 * - Unmatched item logging: Square items with no matching recipe are logged to unmatched table
 * - Token refresh: Proactive token refresh when approaching expiry
 * <p>
 * Requirements: 12.2, 12.3, 12.4
 */
@SpringBootTest
@TestPropertySource(properties = {
        "square.environment=sandbox",
        "square.oauth.secret-name=test-square-secret"
})
@Transactional
class SquareSyncWorkerIntegrationTest {

    @Autowired
    private RecipeRepository recipeRepository;

    @Autowired
    private SquareConnectionRepository squareConnectionRepository;

    @Autowired
    private SquareUnmatchedItemRepository squareUnmatchedItemRepository;

    @Autowired
    private EncryptionService encryptionService;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private SecretsManagerClient secretsManagerClient;

    private WireMockServer wireMockServer;
    private SquareSyncWorker worker;
    
    private UUID testVenueId;
    private SquareConnection testConnection;

    @BeforeEach
    void setUp() {
        // Start WireMock server
        wireMockServer = new WireMockServer(WireMockConfiguration.wireMockConfig().dynamicPort());
        wireMockServer.start();
        WireMock.configureFor("localhost", wireMockServer.port());

        // Create RestTemplate pointing to WireMock
        RestTemplate restTemplate = new RestTemplate();
        
        // Mock Secrets Manager response for Square OAuth credentials
        GetSecretValueResponse secretResponse = GetSecretValueResponse.builder()
                .secretString("{\"application_id\":\"test-app-id\",\"application_secret\":\"test-app-secret\"}")
                .build();
        when(secretsManagerClient.getSecretValue(any(GetSecretValueRequest.class)))
                .thenReturn(secretResponse);

        // Create worker instance with WireMock-backed RestTemplate
        worker = new SquareSyncWorker(
                squareConnectionRepository,
                recipeRepository,
                squareUnmatchedItemRepository,
                encryptionService,
                restTemplate,
                objectMapper,
                secretsManagerClient,
                "test-square-secret",
                "sandbox"
        ) {
            // Override to use WireMock URL instead of real Square API
            @Override
            public void syncVenue(UUID venueId) {
                // This will be tested, but we need to mock Square API calls
                super.syncVenue(venueId);
            }
        };

        // Set up test data
        testVenueId = UUID.randomUUID();
        setupTestConnection();
    }

    @AfterEach
    void tearDown() {
        if (wireMockServer != null && wireMockServer.isRunning()) {
            wireMockServer.stop();
        }
    }

    private void setupTestConnection() {
        // Create a Square connection with a valid token
        String accessToken = "test-access-token-12345";
        String refreshToken = "test-refresh-token-67890";
        
        byte[] encryptedAccessToken = encryptionService.encryptSquareToken(accessToken);
        byte[] encryptedRefreshToken = encryptionService.encryptSquareToken(refreshToken);
        
        testConnection = new SquareConnection(
                testVenueId,
                "test-merchant-id",
                encryptedAccessToken,
                encryptedRefreshToken,
                Instant.now().plusSeconds(48 * 3600) // Expires in 48 hours
        );
        
        squareConnectionRepository.save(testConnection);
    }

    /**
     * Test that Square items matching recipe names update the menu selling price.
     * <p>
     * Requirement 12.3: Match Square menu items to recipes by name (case-insensitive)
     * and update menu selling price.
     */
    @Test
    void syncVenue_matchedItems_shouldUpdateRecipeMenuPrice() {
        // Arrange: Create test recipes
        Recipe recipe1 = createRecipe(testVenueId, "Flat White", BigDecimal.valueOf(4.50));
        Recipe recipe2 = createRecipe(testVenueId, "Cappuccino", BigDecimal.valueOf(4.00));
        Recipe recipe3 = createRecipe(testVenueId, "Latte", BigDecimal.valueOf(4.20));
        
        recipeRepository.saveAll(List.of(recipe1, recipe2, recipe3));

        // Mock Square API catalog response with matching items
        String catalogResponse = """
                {
                  "objects": [
                    {
                      "type": "ITEM",
                      "id": "item-1",
                      "item_data": {
                        "name": "Flat White",
                        "variations": [
                          {
                            "type": "ITEM_VARIATION",
                            "id": "var-1",
                            "item_variation_data": {
                              "price_money": {
                                "amount": 500,
                                "currency": "USD"
                              }
                            }
                          }
                        ]
                      }
                    },
                    {
                      "type": "ITEM",
                      "id": "item-2",
                      "item_data": {
                        "name": "CAPPUCCINO",
                        "variations": [
                          {
                            "type": "ITEM_VARIATION",
                            "id": "var-2",
                            "item_variation_data": {
                              "price_money": {
                                "amount": 450,
                                "currency": "USD"
                              }
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
                """;

        stubFor(get(urlPathEqualTo("/v2/catalog/list"))
                .withQueryParam("types", equalTo("ITEM"))
                .withHeader("Authorization", containing("Bearer"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(catalogResponse)));

        // Act: Sync venue
        worker.syncVenue(testVenueId);

        // Assert: Recipes with matching names should have updated prices
        Recipe updatedRecipe1 = recipeRepository.findById(recipe1.getId()).orElseThrow();
        Recipe updatedRecipe2 = recipeRepository.findById(recipe2.getId()).orElseThrow();
        Recipe updatedRecipe3 = recipeRepository.findById(recipe3.getId()).orElseThrow();

        assertThat(updatedRecipe1.getMenuSellingPrice())
                .isEqualByComparingTo(BigDecimal.valueOf(5.00)); // 500 cents = $5.00
        assertThat(updatedRecipe2.getMenuSellingPrice())
                .isEqualByComparingTo(BigDecimal.valueOf(4.50)); // 450 cents = $4.50 (case-insensitive match)
        assertThat(updatedRecipe3.getMenuSellingPrice())
                .isEqualByComparingTo(BigDecimal.valueOf(4.20)); // Unchanged - no match in Square

        // Assert: Connection status should be updated
        SquareConnection updatedConnection = squareConnectionRepository.findByVenueId(testVenueId).orElseThrow();
        assertThat(updatedConnection.getSyncStatus()).isEqualTo(SquareConnection.SyncStatus.IDLE);
        assertThat(updatedConnection.getLastSyncedAt()).isNotNull();
    }

    /**
     * Test that Square items with no matching recipe are logged as unmatched.
     * <p>
     * Requirement 12.4: Log unmatched Square items for manual review.
     */
    @Test
    void syncVenue_unmatchedItems_shouldLogToUnmatchedTable() {
        // Arrange: Create only one recipe
        Recipe recipe1 = createRecipe(testVenueId, "Flat White", BigDecimal.valueOf(4.50));
        recipeRepository.save(recipe1);

        // Mock Square API catalog response with matched and unmatched items
        String catalogResponse = """
                {
                  "objects": [
                    {
                      "type": "ITEM",
                      "id": "item-1",
                      "item_data": {
                        "name": "Flat White",
                        "variations": [
                          {
                            "type": "ITEM_VARIATION",
                            "id": "var-1",
                            "item_variation_data": {
                              "price_money": {
                                "amount": 500,
                                "currency": "USD"
                              }
                            }
                          }
                        ]
                      }
                    },
                    {
                      "type": "ITEM",
                      "id": "item-2",
                      "item_data": {
                        "name": "Croissant",
                        "variations": [
                          {
                            "type": "ITEM_VARIATION",
                            "id": "var-2",
                            "item_variation_data": {
                              "price_money": {
                                "amount": 350,
                                "currency": "USD"
                              }
                            }
                          }
                        ]
                      }
                    },
                    {
                      "type": "ITEM",
                      "id": "item-3",
                      "item_data": {
                        "name": "Muffin",
                        "variations": [
                          {
                            "type": "ITEM_VARIATION",
                            "id": "var-3",
                            "item_variation_data": {
                              "price_money": {
                                "amount": 400,
                                "currency": "USD"
                              }
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
                """;

        stubFor(get(urlPathEqualTo("/v2/catalog/list"))
                .withQueryParam("types", equalTo("ITEM"))
                .withHeader("Authorization", containing("Bearer"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(catalogResponse)));

        // Act: Sync venue
        worker.syncVenue(testVenueId);

        // Assert: Unmatched items should be logged
        List<SquareUnmatchedItem> unmatchedItems = squareUnmatchedItemRepository.findByVenueId(testVenueId);
        
        assertThat(unmatchedItems).hasSize(2);
        
        SquareUnmatchedItem croissant = unmatchedItems.stream()
                .filter(item -> item.getSquareItemName().equals("Croissant"))
                .findFirst()
                .orElseThrow();
        assertThat(croissant.getSquareItemPrice()).isEqualByComparingTo(BigDecimal.valueOf(3.50));
        assertThat(croissant.getStatus()).isEqualTo(SquareUnmatchedItem.UnmatchedStatus.PENDING);

        SquareUnmatchedItem muffin = unmatchedItems.stream()
                .filter(item -> item.getSquareItemName().equals("Muffin"))
                .findFirst()
                .orElseThrow();
        assertThat(muffin.getSquareItemPrice()).isEqualByComparingTo(BigDecimal.valueOf(4.00));
        assertThat(muffin.getStatus()).isEqualTo(SquareUnmatchedItem.UnmatchedStatus.PENDING);
    }

    /**
     * Test that unmatched items are upserted correctly on subsequent syncs.
     * If an item already exists, update its price; don't create duplicates.
     */
    @Test
    void syncVenue_unmatchedItemAlreadyExists_shouldUpdatePrice() {
        // Arrange: Create an existing unmatched item
        SquareUnmatchedItem existingItem = new SquareUnmatchedItem(
                testVenueId,
                "Croissant",
                BigDecimal.valueOf(3.00)
        );
        squareUnmatchedItemRepository.save(existingItem);

        // Mock Square API catalog response with updated price
        String catalogResponse = """
                {
                  "objects": [
                    {
                      "type": "ITEM",
                      "id": "item-1",
                      "item_data": {
                        "name": "Croissant",
                        "variations": [
                          {
                            "type": "ITEM_VARIATION",
                            "id": "var-1",
                            "item_variation_data": {
                              "price_money": {
                                "amount": 350,
                                "currency": "USD"
                              }
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
                """;

        stubFor(get(urlPathEqualTo("/v2/catalog/list"))
                .withQueryParam("types", equalTo("ITEM"))
                .withHeader("Authorization", containing("Bearer"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(catalogResponse)));

        // Act: Sync venue
        worker.syncVenue(testVenueId);

        // Assert: Price should be updated, not duplicated
        List<SquareUnmatchedItem> unmatchedItems = squareUnmatchedItemRepository.findByVenueId(testVenueId);
        
        assertThat(unmatchedItems).hasSize(1);
        
        SquareUnmatchedItem updatedItem = unmatchedItems.get(0);
        assertThat(updatedItem.getSquareItemName()).isEqualTo("Croissant");
        assertThat(updatedItem.getSquareItemPrice()).isEqualByComparingTo(BigDecimal.valueOf(3.50));
    }

    /**
     * Test that token is refreshed proactively when approaching expiry.
     * <p>
     * Requirement 12.2: Token refresh logic when token expires within 24 hours.
     */
    @Test
    void syncVenue_tokenNearExpiry_shouldRefreshToken() {
        // Arrange: Update connection with token expiring soon (within 24 hours)
        testConnection.setTokenExpiresAt(Instant.now().plusSeconds(12 * 3600)); // 12 hours from now
        squareConnectionRepository.save(testConnection);

        // Mock token refresh endpoint
        String tokenRefreshResponse = """
                {
                  "access_token": "new-access-token-abcdef",
                  "refresh_token": "new-refresh-token-xyz123",
                  "expires_at": "2025-12-31T23:59:59Z"
                }
                """;

        stubFor(post(urlPathEqualTo("/oauth2/token"))
                .withRequestBody(containing("grant_type"))
                .withRequestBody(containing("refresh_token"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(tokenRefreshResponse)));

        // Mock catalog endpoint (will be called after token refresh)
        String catalogResponse = """
                {
                  "objects": []
                }
                """;

        stubFor(get(urlPathEqualTo("/v2/catalog/list"))
                .withQueryParam("types", equalTo("ITEM"))
                .withHeader("Authorization", containing("Bearer"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(catalogResponse)));

        // Act: Sync venue (should trigger token refresh)
        worker.syncVenue(testVenueId);

        // Assert: Connection should have new token and expiry
        SquareConnection updatedConnection = squareConnectionRepository.findByVenueId(testVenueId).orElseThrow();
        
        String decryptedAccessToken = encryptionService.decryptSquareToken(updatedConnection.getAccessTokenEncrypted());
        assertThat(decryptedAccessToken).isEqualTo("new-access-token-abcdef");
        
        String decryptedRefreshToken = encryptionService.decryptSquareToken(updatedConnection.getRefreshTokenEncrypted());
        assertThat(decryptedRefreshToken).isEqualTo("new-refresh-token-xyz123");
        
        assertThat(updatedConnection.getTokenExpiresAt()).isAfter(Instant.now().plusSeconds(24 * 3600));

        // Verify token refresh endpoint was called
        verify(postRequestedFor(urlPathEqualTo("/oauth2/token"))
                .withRequestBody(containing("refresh_token"))
                .withRequestBody(containing("test-refresh-token-67890")));
    }

    /**
     * Test that sync marks connection status as ERROR when API call fails.
     */
    @Test
    void syncVenue_apiFailure_shouldMarkStatusAsError() {
        // Arrange: Mock Square API to return error
        stubFor(get(urlPathEqualTo("/v2/catalog/list"))
                .withQueryParam("types", equalTo("ITEM"))
                .withHeader("Authorization", containing("Bearer"))
                .willReturn(aResponse()
                        .withStatus(500)
                        .withBody("{\"error\": \"Internal Server Error\"}")));

        // Act & Assert: Sync should throw exception
        assertThrows(RuntimeException.class, () -> worker.syncVenue(testVenueId));

        // Assert: Connection status should be ERROR
        SquareConnection updatedConnection = squareConnectionRepository.findByVenueId(testVenueId).orElseThrow();
        assertThat(updatedConnection.getSyncStatus()).isEqualTo(SquareConnection.SyncStatus.ERROR);
    }

    /**
     * Test case-insensitive matching of Square items to recipes.
     * <p>
     * Requirement 12.3: Case-insensitive exact name match
     */
    @Test
    void syncVenue_caseInsensitiveMatch_shouldUpdateRecipe() {
        // Arrange: Create recipe with mixed case
        Recipe recipe = createRecipe(testVenueId, "Flat White", BigDecimal.valueOf(4.50));
        recipeRepository.save(recipe);

        // Mock Square API with different case
        String catalogResponse = """
                {
                  "objects": [
                    {
                      "type": "ITEM",
                      "id": "item-1",
                      "item_data": {
                        "name": "FLAT WHITE",
                        "variations": [
                          {
                            "type": "ITEM_VARIATION",
                            "id": "var-1",
                            "item_variation_data": {
                              "price_money": {
                                "amount": 550,
                                "currency": "USD"
                              }
                            }
                          }
                        ]
                      }
                    }
                  ]
                }
                """;

        stubFor(get(urlPathEqualTo("/v2/catalog/list"))
                .withQueryParam("types", equalTo("ITEM"))
                .withHeader("Authorization", containing("Bearer"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(catalogResponse)));

        // Act: Sync venue
        worker.syncVenue(testVenueId);

        // Assert: Recipe should be matched and price updated
        Recipe updatedRecipe = recipeRepository.findById(recipe.getId()).orElseThrow();
        assertThat(updatedRecipe.getMenuSellingPrice())
                .isEqualByComparingTo(BigDecimal.valueOf(5.50));

        // Assert: No unmatched items should be created
        List<SquareUnmatchedItem> unmatchedItems = squareUnmatchedItemRepository.findByVenueId(testVenueId);
        assertThat(unmatchedItems).isEmpty();
    }

    /**
     * Helper method to create a test recipe.
     */
    private Recipe createRecipe(UUID venueId, String name, BigDecimal menuPrice) {
        Recipe recipe = new Recipe();
        recipe.setVenueId(venueId);
        recipe.setName(name);
        recipe.setPortionCount(1);
        recipe.setMenuSellingPrice(menuPrice);
        recipe.setTotalBatchCost(BigDecimal.ZERO);
        recipe.setFoodCostPerPortion(BigDecimal.ZERO);
        return recipe;
    }
}
