package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.SquareConnection;
import com.cogschecker.foodcost.api.repository.SquareConnectionRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueResponse;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Service for Square OAuth flow and token management.
 * Requirements: 12.1 (Square OAuth authorization flow)
 */
@Service
public class SquareOAuthService {
    
    private static final Logger logger = LoggerFactory.getLogger(SquareOAuthService.class);
    
    private final SquareConnectionRepository squareConnectionRepository;
    private final EncryptionService encryptionService;
    private final SecretsManagerClient secretsManagerClient;
    private final ObjectMapper objectMapper;
    private final RestTemplate restTemplate;
    private final String squareOAuthSecretName;
    private final String squareCallbackUrl;
    private final String squareEnvironment;
    
    // Cached Square OAuth credentials
    private String applicationId;
    private String applicationSecret;
    
    public SquareOAuthService(
            SquareConnectionRepository squareConnectionRepository,
            EncryptionService encryptionService,
            SecretsManagerClient secretsManagerClient,
            ObjectMapper objectMapper,
            RestTemplate restTemplate,
            @Value("${square.oauth.secret-name:}") String squareOAuthSecretName,
            @Value("${square.oauth.callback-url:http://localhost:8080/api/v1/venues/{venueId}/square/callback}") String squareCallbackUrl,
            @Value("${square.environment:sandbox}") String squareEnvironment) {
        this.squareConnectionRepository = squareConnectionRepository;
        this.encryptionService = encryptionService;
        this.secretsManagerClient = secretsManagerClient;
        this.objectMapper = objectMapper;
        this.restTemplate = restTemplate;
        this.squareOAuthSecretName = squareOAuthSecretName;
        this.squareCallbackUrl = squareCallbackUrl;
        this.squareEnvironment = squareEnvironment;
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
     * Generate the Square OAuth authorization URL.
     * 
     * @param venueId the venue ID to connect
     * @return the authorization URL to redirect the user to
     */
    public String getAuthorizationUrl(UUID venueId) {
        loadSquareCredentials();
        
        String state = venueId.toString(); // Use venueId as state for verification in callback
        
        // Build Square OAuth URL
        String baseUrl = squareEnvironment.equalsIgnoreCase("production")
                ? "https://connect.squareup.com/oauth2/authorize"
                : "https://connect.squareupsandbox.com/oauth2/authorize";
        
        String authUrl = String.format("%s?client_id=%s&scope=%s&state=%s",
                baseUrl,
                applicationId,
                "MERCHANT_PROFILE_READ+ITEMS_READ+ORDERS_READ",  // Required scopes
                state);
        
        logger.info("Generated Square OAuth authorization URL for venue {}", venueId);
        return authUrl;
    }
    
    /**
     * Exchange the OAuth authorization code for access and refresh tokens.
     * Encrypts and stores the tokens in the database.
     * 
     * @param venueId the venue ID
     * @param code the authorization code from Square
     * @return the created SquareConnection entity
     */
    @Transactional
    public SquareConnection exchangeCodeForTokens(UUID venueId, String code) {
        loadSquareCredentials();
        
        try {
            // Build Square token endpoint URL
            String tokenUrl = squareEnvironment.equalsIgnoreCase("production")
                    ? "https://connect.squareup.com/oauth2/token"
                    : "https://connect.squareupsandbox.com/oauth2/token";
            
            // Build request body
            Map<String, String> requestBody = new HashMap<>();
            requestBody.put("client_id", applicationId);
            requestBody.put("client_secret", applicationSecret);
            requestBody.put("code", code);
            requestBody.put("grant_type", "authorization_code");
            
            // Set headers
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set("Square-Version", "2024-01-18");
            
            HttpEntity<Map<String, String>> request = new HttpEntity<>(requestBody, headers);
            
            // Make the token exchange request
            ResponseEntity<String> response = restTemplate.exchange(
                    tokenUrl, 
                    HttpMethod.POST, 
                    request, 
                    String.class);
            
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new RuntimeException("Failed to obtain access token from Square");
            }
            
            // Parse the response
            JsonNode tokenResponse = objectMapper.readTree(response.getBody());
            
            String accessToken = tokenResponse.get("access_token").asText();
            String refreshToken = tokenResponse.has("refresh_token") 
                    ? tokenResponse.get("refresh_token").asText() 
                    : null;
            String merchantId = tokenResponse.has("merchant_id")
                    ? tokenResponse.get("merchant_id").asText()
                    : null;
            String expiresAt = tokenResponse.has("expires_at")
                    ? tokenResponse.get("expires_at").asText()
                    : null;
            
            if (refreshToken == null || merchantId == null) {
                throw new RuntimeException("Missing refresh token or merchant ID in Square response");
            }
            
            // Parse expiry time (ISO 8601 format)
            Instant tokenExpiresAt = expiresAt != null 
                    ? Instant.parse(expiresAt)
                    : Instant.now().plusSeconds(30 * 24 * 3600); // Default 30 days
            
            // Encrypt tokens
            byte[] encryptedAccessToken = encryptionService.encryptSquareToken(accessToken);
            byte[] encryptedRefreshToken = encryptionService.encryptSquareToken(refreshToken);
            
            // Check if connection already exists
            SquareConnection connection = squareConnectionRepository.findByVenueId(venueId)
                    .orElse(new SquareConnection(venueId, merchantId, encryptedAccessToken, 
                                                 encryptedRefreshToken, tokenExpiresAt));
            
            // Update connection
            connection.setSquareMerchantId(merchantId);
            connection.setAccessTokenEncrypted(encryptedAccessToken);
            connection.setRefreshTokenEncrypted(encryptedRefreshToken);
            connection.setTokenExpiresAt(tokenExpiresAt);
            connection.setSyncStatus(SquareConnection.SyncStatus.IDLE);
            
            SquareConnection saved = squareConnectionRepository.save(connection);
            
            logger.info("Successfully connected Square merchant {} for venue {}", merchantId, venueId);
            return saved;
            
        } catch (Exception e) {
            logger.error("Failed to exchange Square OAuth code for tokens", e);
            throw new RuntimeException("Failed to connect Square account: " + e.getMessage(), e);
        }
    }
    
    /**
     * Get the Square connection for a venue.
     * 
     * @param venueId the venue ID
     * @return the connection if exists
     */
    public SquareConnection getConnection(UUID venueId) {
        return squareConnectionRepository.findByVenueId(venueId)
                .orElseThrow(() -> new RuntimeException("Square connection not found for venue"));
    }
    
    /**
     * Check if a venue has a Square connection.
     * 
     * @param venueId the venue ID
     * @return true if connected
     */
    public boolean isConnected(UUID venueId) {
        return squareConnectionRepository.existsByVenueId(venueId);
    }
    
    /**
     * Disconnect Square for a venue by deleting the connection.
     * 
     * @param venueId the venue ID
     */
    @Transactional
    public void disconnect(UUID venueId) {
        squareConnectionRepository.deleteByVenueId(venueId);
        logger.info("Disconnected Square for venue {}", venueId);
    }
}
