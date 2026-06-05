package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.SquareConnection;
import com.cogschecker.foodcost.api.repository.SquareConnectionRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueRequest;
import software.amazon.awssdk.services.secretsmanager.model.GetSecretValueResponse;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * Unit tests for SquareOAuthService.
 * Requirements: 12.1 (Square OAuth flow)
 */
@ExtendWith(MockitoExtension.class)
class SquareOAuthServiceTest {
    
    @Mock
    private SquareConnectionRepository squareConnectionRepository;
    
    @Mock
    private EncryptionService encryptionService;
    
    @Mock
    private SecretsManagerClient secretsManagerClient;
    
    @Mock
    private RestTemplate restTemplate;
    
    private ObjectMapper objectMapper;
    private SquareOAuthService squareOAuthService;
    
    private static final String TEST_SECRET_NAME = "test-square-oauth";
    private static final String TEST_CALLBACK_URL = "http://localhost:8080/api/v1/venues/{venueId}/square/callback";
    private static final String TEST_ENVIRONMENT = "sandbox";
    
    @BeforeEach
    void setUp() {
        objectMapper = new ObjectMapper();
        squareOAuthService = new SquareOAuthService(
                squareConnectionRepository,
                encryptionService,
                secretsManagerClient,
                objectMapper,
                restTemplate,
                TEST_SECRET_NAME,
                TEST_CALLBACK_URL,
                TEST_ENVIRONMENT
        );
    }
    
    @Test
    void getAuthorizationUrl_shouldGenerateSandboxUrl() {
        // Given
        UUID venueId = UUID.randomUUID();
        String secretJson = "{\"application_id\":\"test-app-id\",\"application_secret\":\"test-secret\"}";
        
        GetSecretValueResponse secretResponse = GetSecretValueResponse.builder()
                .secretString(secretJson)
                .build();
        
        when(secretsManagerClient.getSecretValue(any(GetSecretValueRequest.class)))
                .thenReturn(secretResponse);
        
        // When
        String authUrl = squareOAuthService.getAuthorizationUrl(venueId);
        
        // Then
        assertNotNull(authUrl);
        assertTrue(authUrl.contains("connect.squareupsandbox.com"));
        assertTrue(authUrl.contains("client_id=test-app-id"));
        assertTrue(authUrl.contains("state=" + venueId.toString()));
        assertTrue(authUrl.contains("MERCHANT_PROFILE_READ"));
    }
    
    @Test
    void exchangeCodeForTokens_shouldCreateNewConnection() {
        // Given
        UUID venueId = UUID.randomUUID();
        String code = "test-code";
        String secretJson = "{\"application_id\":\"test-app-id\",\"application_secret\":\"test-secret\"}";
        String tokenResponseJson = "{\"access_token\":\"access-123\",\"refresh_token\":\"refresh-456\",\"merchant_id\":\"merchant-789\",\"expires_at\":\"2024-12-31T23:59:59Z\"}";
        
        GetSecretValueResponse secretResponse = GetSecretValueResponse.builder()
                .secretString(secretJson)
                .build();
        
        when(secretsManagerClient.getSecretValue(any(GetSecretValueRequest.class)))
                .thenReturn(secretResponse);
        
        ResponseEntity<String> tokenResponse = new ResponseEntity<>(tokenResponseJson, HttpStatus.OK);
        when(restTemplate.exchange(anyString(), any(), any(), eq(String.class)))
                .thenReturn(tokenResponse);
        
        byte[] encryptedAccess = "encrypted-access".getBytes();
        byte[] encryptedRefresh = "encrypted-refresh".getBytes();
        when(encryptionService.encryptSquareToken("access-123")).thenReturn(encryptedAccess);
        when(encryptionService.encryptSquareToken("refresh-456")).thenReturn(encryptedRefresh);
        
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.empty());
        
        SquareConnection savedConnection = new SquareConnection(
                venueId, "merchant-789", encryptedAccess, encryptedRefresh, 
                Instant.parse("2024-12-31T23:59:59Z"));
        when(squareConnectionRepository.save(any(SquareConnection.class)))
                .thenReturn(savedConnection);
        
        // When
        SquareConnection result = squareOAuthService.exchangeCodeForTokens(venueId, code);
        
        // Then
        assertNotNull(result);
        assertEquals(venueId, result.getVenueId());
        assertEquals("merchant-789", result.getSquareMerchantId());
        verify(squareConnectionRepository).save(any(SquareConnection.class));
    }
    
    @Test
    void isConnected_shouldReturnTrueWhenConnectionExists() {
        // Given
        UUID venueId = UUID.randomUUID();
        when(squareConnectionRepository.existsByVenueId(venueId)).thenReturn(true);
        
        // When
        boolean result = squareOAuthService.isConnected(venueId);
        
        // Then
        assertTrue(result);
    }
    
    @Test
    void isConnected_shouldReturnFalseWhenNoConnection() {
        // Given
        UUID venueId = UUID.randomUUID();
        when(squareConnectionRepository.existsByVenueId(venueId)).thenReturn(false);
        
        // When
        boolean result = squareOAuthService.isConnected(venueId);
        
        // Then
        assertFalse(result);
    }
    
    @Test
    void disconnect_shouldDeleteConnection() {
        // Given
        UUID venueId = UUID.randomUUID();
        
        // When
        squareOAuthService.disconnect(venueId);
        
        // Then
        verify(squareConnectionRepository).deleteByVenueId(venueId);
    }
}
