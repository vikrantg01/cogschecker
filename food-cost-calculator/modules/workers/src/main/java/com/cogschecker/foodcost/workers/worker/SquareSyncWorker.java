package com.cogschecker.foodcost.workers.worker;

import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.SquareConnection;
import com.cogschecker.foodcost.api.domain.SquareUnmatchedItem;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SquareConnectionRepository;
import com.cogschecker.foodcost.api.repository.SquareUnmatchedItemRepository;
import com.cogschecker.foodcost.api.service.EncryptionService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.awspring.cloud.sqs.annotation.SqsListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueResponse;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.*;

/**
 * Worker for syncing Square POS catalog data with recipes.
 * <p>
 * This worker operates in two modes:
 * <ol>
 *   <li>Scheduled sync: Runs every 24 hours via Spring @Scheduled annotation</li>
 *   <li>On-demand sync: Triggered by SQS messages from the API when a user requests manual sync</li>
 * </ol>
 * <p>
 * Sync process:
 * <ol>
 *   <li>Check token expiry; proactively refresh if within 24h of expiry</li>
 *   <li>Fetch catalog items from Square API</li>
 *   <li>For each Square menu item: case-insensitive exact name match against recipes</li>
 *   <li>Matched items: update recipe.menu_selling_price</li>
 *   <li>Unmatched items: upsert to square_unmatched_items table</li>
 *   <li>Update square_connections.last_synced_at and sync_status</li>
 * </ol>
 * <p>
 * Requirements: 12.2, 12.3, 12.4 - Square sync, name matching, unmatched logging
 */
@Component
public class SquareSyncWorker {
    
    private static final Logger logger = LoggerFactory.getLogger(SquareSyncWorker.class);
    
    private static final Duration TOKEN_REFRESH_THRESHOLD = Duration.ofHours(24);
    
    private final SquareConnectionRepository squareConnectionRepository;
    private final RecipeRepository recipeRepository;
    private final SquareUnmatchedItemRepository squareUnmatchedItemRepository;
    private final EncryptionService encryptionService;
    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;
    private final SecretsManagerClient secretsManagerClient;
    private final String squareOAuthSecretName;
    private final String squareEnvironment;
    private final String squareApiBaseUrl; // For testing with WireMock
    
    // Cached Square OAuth credentials
    private String applicationId;
    private String applicationSecret;
    
    public SquareSyncWorker(
            SquareConnectionRepository squareConnectionRepository,
            RecipeRepository recipeRepository,
            SquareUnmatchedItemRepository squareUnmatchedItemRepository,
            EncryptionService encryptionService,
            RestTemplate restTemplate,
            ObjectMapper objectMapper,
            SecretsManagerClient secretsManagerClient,
            @Value("${square.oauth.secret-name:}") String squareOAuthSecretName,
            @Value("${square.environment:sandbox}") String squareEnvironment) {
        this(squareConnectionRepository, recipeRepository, squareUnmatchedItemRepository,
                encryptionService, restTemplate, objectMapper, secretsManagerClient,
                squareOAuthSecretName, squareEnvironment, null);
    }
    
    // Package-private constructor for testing with custom base URL
    SquareSyncWorker(
            SquareConnectionRepository squareConnectionRepository,
            RecipeRepository recipeRepository,
            SquareUnmatchedItemRepository squareUnmatchedItemRepository,
            EncryptionService encryptionService,
            RestTemplate restTemplate,
            ObjectMapper objectMapper,
            SecretsManagerClient secretsManagerClient,
            String squareOAuthSecretName,
            String squareEnvironment,
            String squareApiBaseUrl) {
        this.squareConnectionRepository = squareConnectionRepository;
        this.recipeRepository = recipeRepository;
        this.squareUnmatchedItemRepository = squareUnmatchedItemRepository;
        this.encryptionService = encryptionService;
        this.restTemplate = restTemplate;
        this.objectMapper = objectMapper;
        this.secretsManagerClient = secretsManagerClient;
        this.squareOAuthSecretName = squareOAuthSecretName;
        this.squareEnvironment = squareEnvironment;
        this.squareApiBaseUrl = squareApiBaseUrl;
    }
    
    /**
     * Scheduled sync job that runs every 24 hours.
     * Syncs all venues that have active Square connections.
     * <p>
     * Requirements: 12.2 - Sync at least every 24 hours
     */
    @Scheduled(cron = "0 0 2 * * *")  // Run at 2 AM every day
    public void scheduledSync() {
        logger.info("Starting scheduled Square sync for all venues");
        
        List<SquareConnection> connections = squareConnectionRepository.findAll();
        
        if (connections.isEmpty()) {
            logger.info("No Square connections found, skipping scheduled sync");
            return;
        }
        
        int successCount = 0;
        int errorCount = 0;
        
        for (SquareConnection connection : connections) {
            try {
                syncVenue(connection.getVenueId());
                successCount++;
            } catch (Exception e) {
                errorCount++;
                logger.error("Scheduled sync failed for venue {}: {}", 
                        connection.getVenueId(), e.getMessage(), e);
            }
        }
        
        logger.info("Scheduled Square sync completed: {} succeeded, {} failed", 
                successCount, errorCount);
    }
    
    /**
     * Process on-demand sync requests from the SQS queue.
     * <p>
     * Message payload format:
     * <pre>
     * {
     *   "venueId": "uuid",
     *   "timestamp": 1234567890
     * }
     * </pre>
     * <p>
     * Requirements: 12.2 - On-demand sync via SQS
     * 
     * @param message the SQS message payload
     */
    @SqsListener("${sqs.queue.square-sync}")
    public void processOnDemandSync(Map<String, String> message) {
        String venueIdStr = message.get("venueId");
        String timestamp = message.get("timestamp");
        
        logger.info("Received on-demand Square sync request for venue {} (timestamp: {})",
                venueIdStr, timestamp);
        
        if (venueIdStr == null) {
            logger.error("Invalid message payload: venueId is null");
            throw new IllegalArgumentException("Invalid message payload: venueId is required");
        }
        
        UUID venueId;
        try {
            venueId = UUID.fromString(venueIdStr);
        } catch (IllegalArgumentException e) {
            logger.error("Invalid UUID format in message: venueId={}", venueIdStr);
            throw new IllegalArgumentException("Invalid UUID format in message payload", e);
        }
        
        try {
            syncVenue(venueId);
            logger.info("Successfully completed on-demand sync for venue {}", venueId);
        } catch (Exception e) {
            logger.error("On-demand sync failed for venue {}: {}", venueId, e.getMessage(), e);
            throw new RuntimeException("Square sync failed", e);
        }
    }
    
    /**
     * Sync Square catalog data for a specific venue.
     * <p>
     * Steps:
     * <ol>
     *   <li>Fetch Square connection for venue</li>
     *   <li>Check and refresh token if needed</li>
     *   <li>Fetch catalog items from Square</li>
     *   <li>Match items to recipes and update prices</li>
     *   <li>Log unmatched items</li>
     *   <li>Update sync status</li>
     * </ol>
     * <p>
     * Requirements: 12.2, 12.3, 12.4
     * 
     * @param venueId the venue ID to sync
     */
    @Transactional
    public void syncVenue(UUID venueId) {
        logger.info("Starting Square sync for venue {}", venueId);
        
        // Step 1: Get Square connection
        SquareConnection connection = squareConnectionRepository.findByVenueId(venueId)
                .orElseThrow(() -> new RuntimeException("Square connection not found for venue " + venueId));
        
        // Mark sync as in progress
        connection.setSyncStatus(SquareConnection.SyncStatus.SYNCING);
        squareConnectionRepository.save(connection);
        
        try {
            // Step 2: Check token expiry and refresh if needed
            String accessToken = checkAndRefreshToken(connection);
            
            // Step 3: Fetch catalog items from Square
            List<SquareMenuItem> menuItems = fetchSquareCatalog(accessToken);
            
            logger.info("Fetched {} items from Square catalog for venue {}", menuItems.size(), venueId);
            
            // Step 4: Match items to recipes
            int matchedCount = 0;
            int unmatchedCount = 0;
            
            for (SquareMenuItem item : menuItems) {
                Optional<Recipe> matchedRecipe = recipeRepository
                        .findByVenueIdAndNameIgnoreCase(venueId, item.name);
                
                if (matchedRecipe.isPresent()) {
                    // Update recipe menu selling price
                    Recipe recipe = matchedRecipe.get();
                    recipe.setMenuSellingPrice(item.price);
                    recipeRepository.save(recipe);
                    matchedCount++;
                    
                    logger.debug("Matched Square item '{}' to recipe '{}', updated price to {}",
                            item.name, recipe.getName(), item.price);
                } else {
                    // Log as unmatched
                    upsertUnmatchedItem(venueId, item.name, item.price);
                    unmatchedCount++;
                    
                    logger.debug("Square item '{}' has no matching recipe, logged as unmatched", item.name);
                }
            }
            
            // Step 5: Update sync status
            connection.setLastSyncedAt(Instant.now());
            connection.setSyncStatus(SquareConnection.SyncStatus.IDLE);
            squareConnectionRepository.save(connection);
            
            logger.info("Square sync completed for venue {}: {} matched, {} unmatched",
                    venueId, matchedCount, unmatchedCount);
            
        } catch (Exception e) {
            // Mark sync as error
            connection.setSyncStatus(SquareConnection.SyncStatus.ERROR);
            squareConnectionRepository.save(connection);
            
            logger.error("Square sync failed for venue {}: {}", venueId, e.getMessage(), e);
            throw new RuntimeException("Square sync failed for venue " + venueId, e);
        }
    }
    
    /**
     * Check token expiry and refresh proactively if within 24 hours of expiry.
     * <p>
     * Requirements: 12.2 - Token refresh logic
     * 
     * @param connection the Square connection
     * @return the current valid access token
     */
    private String checkAndRefreshToken(SquareConnection connection) {
        Instant now = Instant.now();
        Instant expiresAt = connection.getTokenExpiresAt();
        
        Duration timeUntilExpiry = Duration.between(now, expiresAt);
        
        if (timeUntilExpiry.compareTo(TOKEN_REFRESH_THRESHOLD) <= 0) {
            logger.info("Access token for venue {} expires in {} hours, refreshing proactively",
                    connection.getVenueId(), timeUntilExpiry.toHours());
            
            refreshAccessToken(connection);
        }
        
        // Decrypt and return access token
        return encryptionService.decryptSquareToken(connection.getAccessTokenEncrypted());
    }
    
    /**
     * Refresh the Square access token using the refresh token.
     * <p>
     * Requirements: 12.2 - Token refresh logic
     * 
     * @param connection the Square connection to refresh
     */
    private void refreshAccessToken(SquareConnection connection) {
        loadSquareCredentials();
        
        try {
            String tokenUrl;
            if (squareApiBaseUrl != null) {
                // Use test/override URL (e.g., WireMock)
                tokenUrl = squareApiBaseUrl + "/oauth2/token";
            } else {
                // Use real Square API URL
                tokenUrl = squareEnvironment.equalsIgnoreCase("production")
                        ? "https://connect.squareup.com/oauth2/token"
                        : "https://connect.squareupsandbox.com/oauth2/token";
            }
            
            String refreshToken = encryptionService.decryptSquareToken(connection.getRefreshTokenEncrypted());
            
            Map<String, String> requestBody = new HashMap<>();
            requestBody.put("client_id", applicationId);
            requestBody.put("client_secret", applicationSecret);
            requestBody.put("grant_type", "refresh_token");
            requestBody.put("refresh_token", refreshToken);
            
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("Square-Version", "2024-01-18");
            
            HttpEntity<Map<String, String>> request = new HttpEntity<>(requestBody, headers);
            
            ResponseEntity<String> response = restTemplate.exchange(
                    tokenUrl, HttpMethod.POST, request, String.class);
            
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new RuntimeException("Failed to refresh Square access token");
            }
            
            JsonNode tokenResponse = objectMapper.readTree(response.getBody());
            
            String newAccessToken = tokenResponse.get("access_token").asText();
            String newRefreshToken = tokenResponse.has("refresh_token")
                    ? tokenResponse.get("refresh_token").asText()
                    : refreshToken;  // Use old refresh token if not provided
            String expiresAt = tokenResponse.has("expires_at")
                    ? tokenResponse.get("expires_at").asText()
                    : null;
            
            Instant newTokenExpiresAt = expiresAt != null
                    ? Instant.parse(expiresAt)
                    : Instant.now().plusSeconds(30 * 24 * 3600);
            
            // Encrypt and update tokens
            connection.setAccessTokenEncrypted(encryptionService.encryptSquareToken(newAccessToken));
            connection.setRefreshTokenEncrypted(encryptionService.encryptSquareToken(newRefreshToken));
            connection.setTokenExpiresAt(newTokenExpiresAt);
            
            squareConnectionRepository.save(connection);
            
            logger.info("Successfully refreshed access token for venue {}", connection.getVenueId());
            
        } catch (Exception e) {
            logger.error("Failed to refresh Square access token for venue {}: {}",
                    connection.getVenueId(), e.getMessage(), e);
            throw new RuntimeException("Failed to refresh Square access token", e);
        }
    }
    
    /**
     * Fetch catalog items from Square API.
     * <p>
     * Requirements: 12.2 - Catalog fetch
     * 
     * @param accessToken the Square access token
     * @return list of menu items with names and prices
     */
    private List<SquareMenuItem> fetchSquareCatalog(String accessToken) {
        try {
            String catalogUrl;
            if (squareApiBaseUrl != null) {
                // Use test/override URL (e.g., WireMock)
                catalogUrl = squareApiBaseUrl + "/v2/catalog/list";
            } else {
                // Use real Square API URL
                catalogUrl = squareEnvironment.equalsIgnoreCase("production")
                        ? "https://connect.squareup.com/v2/catalog/list"
                        : "https://connect.squareupsandbox.com/v2/catalog/list";
            }
            
            catalogUrl += "?types=ITEM";  // Only fetch menu items
            
            HttpHeaders headers = new HttpHeaders();
            headers.set("Authorization", "Bearer " + accessToken);
            headers.set("Square-Version", "2024-01-18");
            headers.setContentType(MediaType.APPLICATION_JSON);
            
            HttpEntity<Void> request = new HttpEntity<>(headers);
            
            ResponseEntity<String> response = restTemplate.exchange(
                    catalogUrl, HttpMethod.GET, request, String.class);
            
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new RuntimeException("Failed to fetch Square catalog");
            }
            
            // Parse catalog response
            JsonNode catalogResponse = objectMapper.readTree(response.getBody());
            JsonNode objects = catalogResponse.get("objects");
            
            List<SquareMenuItem> menuItems = new ArrayList<>();
            
            if (objects != null && objects.isArray()) {
                for (JsonNode object : objects) {
                    JsonNode itemData = object.get("item_data");
                    if (itemData != null) {
                        String itemName = itemData.get("name").asText();
                        
                        // Get price from first variation if available
                        BigDecimal price = null;
                        JsonNode variations = itemData.get("variations");
                        if (variations != null && variations.isArray() && variations.size() > 0) {
                            JsonNode firstVariation = variations.get(0);
                            JsonNode variationData = firstVariation.get("item_variation_data");
                            if (variationData != null && variationData.has("price_money")) {
                                JsonNode priceMoney = variationData.get("price_money");
                                long amountCents = priceMoney.get("amount").asLong();
                                // Convert cents to dollars
                                price = BigDecimal.valueOf(amountCents).divide(BigDecimal.valueOf(100));
                            }
                        }
                        
                        menuItems.add(new SquareMenuItem(itemName, price));
                    }
                }
            }
            
            return menuItems;
            
        } catch (Exception e) {
            logger.error("Failed to fetch Square catalog: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to fetch Square catalog", e);
        }
    }
    
    /**
     * Upsert an unmatched Square item.
     * If an item with the same name already exists for this venue, update its price.
     * Otherwise, create a new unmatched item record.
     * <p>
     * Requirements: 12.4 - Unmatched item logging
     * 
     * @param venueId the venue ID
     * @param squareItemName the Square item name
     * @param squareItemPrice the Square item price
     */
    private void upsertUnmatchedItem(UUID venueId, String squareItemName, BigDecimal squareItemPrice) {
        Optional<SquareUnmatchedItem> existing = squareUnmatchedItemRepository
                .findByVenueIdAndSquareItemNameIgnoreCase(venueId, squareItemName);
        
        if (existing.isPresent()) {
            SquareUnmatchedItem item = existing.get();
            item.setSquareItemPrice(squareItemPrice);
            // Keep existing status (pending/mapped/dismissed)
            squareUnmatchedItemRepository.save(item);
        } else {
            SquareUnmatchedItem newItem = new SquareUnmatchedItem(venueId, squareItemName, squareItemPrice);
            squareUnmatchedItemRepository.save(newItem);
        }
    }
    
    /**
     * Load Square OAuth credentials from AWS Secrets Manager.
     * Credentials are cached after first load.
     */
    private void loadSquareCredentials() {
        if (applicationId != null && applicationSecret != null) {
            return; // Already loaded
        }
        
        if (squareOAuthSecretName == null || squareOAuthSecretName.isEmpty()) {
            throw new IllegalStateException("Square OAuth secret name is not configured");
        }
        
        try {
            GetSecretValueRequest request = GetSecretValueRequest.builder()
                    .secretId(squareOAuthSecretName)
                    .build();
            
            GetSecretValueResponse response = secretsManagerClient.getSecretValue(request);
            String secretString = response.secretString();
            
            JsonNode credentials = objectMapper.readTree(secretString);
            this.applicationId = credentials.get("application_id").asText();
            this.applicationSecret = credentials.get("application_secret").asText();
            
            logger.info("Successfully loaded Square OAuth credentials from Secrets Manager");
        } catch (Exception e) {
            logger.error("Failed to load Square OAuth credentials from Secrets Manager", e);
            throw new RuntimeException("Failed to load Square OAuth credentials", e);
        }
    }
    
    /**
     * Simple DTO for Square menu items.
     */
    private static class SquareMenuItem {
        final String name;
        final BigDecimal price;
        
        SquareMenuItem(String name, BigDecimal price) {
            this.name = name;
            this.price = price;
        }
    }
}
