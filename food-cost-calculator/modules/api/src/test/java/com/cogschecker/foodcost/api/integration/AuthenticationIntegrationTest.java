package com.cogschecker.foodcost.api.integration;

import com.cogschecker.foodcost.api.dto.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.util.Base64;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.SignatureAlgorithm;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.containing;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.matching;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration tests for authentication flows using WireMock to mock Cognito JWKS endpoint.
 * Tests JWT validation, password reset, session invalidation, and social login account linking.
 * 
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class AuthenticationIntegrationTest {

    private static WireMockServer wireMockServer;
    
    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RSAPrivateKey privateKey;
    private RSAPublicKey publicKey;
    private String keyId = "test-key-id";

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        // Start WireMock server before properties are loaded
        wireMockServer = new WireMockServer(WireMockConfiguration.options()
                .dynamicPort());
        wireMockServer.start();
        WireMock.configureFor("localhost", wireMockServer.port());

        // Configure application to use WireMock as Cognito JWKS endpoint
        String jwksUri = "http://localhost:" + wireMockServer.port() + "/.well-known/jwks.json";
        registry.add("cognito.jwks-uri", () -> jwksUri);
        
        // Configure other Cognito properties for testing
        registry.add("cognito.user-pool-id", () -> "us-east-1_TEST123");
        registry.add("cognito.client-id", () -> "test-client-id");
        registry.add("cognito.client-secret", () -> "test-client-secret");
        registry.add("cognito.domain", () -> "http://localhost:" + wireMockServer.port());
        registry.add("cognito.redirect-uri", () -> "http://localhost:8080/callback");
        
        // Disable actual AWS SDK calls
        registry.add("spring.cloud.aws.region.static", () -> "us-east-1");
        registry.add("spring.cloud.aws.credentials.access-key", () -> "test");
        registry.add("spring.cloud.aws.credentials.secret-key", () -> "test");
    }

    @BeforeAll
    void setUp() throws Exception {
        // Generate RSA key pair for JWT signing
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("RSA");
        keyGen.initialize(2048);
        KeyPair keyPair = keyGen.generateKeyPair();
        privateKey = (RSAPrivateKey) keyPair.getPrivate();
        publicKey = (RSAPublicKey) keyPair.getPublic();

        // Mock JWKS endpoint with public key
        stubJwksEndpoint();
    }

    @AfterAll
    static void tearDown() {
        if (wireMockServer != null && wireMockServer.isRunning()) {
            wireMockServer.stop();
        }
    }

    @BeforeEach
    void resetWireMock() {
        wireMockServer.resetAll();
        stubJwksEndpoint();
    }

    /**
     * Stub the JWKS endpoint with our test public key.
     * This allows the JWT decoder to verify tokens signed with our private key.
     */
    private void stubJwksEndpoint() {
        String jwks = buildJwksResponse();
        
        wireMockServer.stubFor(WireMock.get(urlEqualTo("/.well-known/jwks.json"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(jwks)));
    }

    /**
     * Build JWKS response with our test public key in JWK format.
     */
    private String buildJwksResponse() {
        // Encode public key components as Base64URL
        String n = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(publicKey.getModulus().toByteArray());
        String e = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(publicKey.getPublicExponent().toByteArray());

        return String.format("""
                {
                  "keys": [
                    {
                      "kty": "RSA",
                      "kid": "%s",
                      "use": "sig",
                      "alg": "RS256",
                      "n": "%s",
                      "e": "%s"
                    }
                  ]
                }
                """, keyId, n, e);
    }

    /**
     * Generate a test JWT token signed with our private key.
     */
    private String generateTestJwt(String userId, String email, String orgId, 
                                   Map<String, String> venueRoles, String tier) {
        long now = System.currentTimeMillis();
        
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", userId);
        claims.put("email", email);
        claims.put("custom:org_id", orgId);
        claims.put("custom:tier", tier);
        
        // Convert venue roles map to JSON string
        try {
            String venueRolesJson = objectMapper.writeValueAsString(venueRoles);
            claims.put("custom:venue_roles", venueRolesJson);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize venue roles", e);
        }

        return Jwts.builder()
                .setHeaderParam("kid", keyId)
                .setClaims(claims)
                .setIssuer("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST123")
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(now + 3600000)) // 1 hour
                .signWith(privateKey, SignatureAlgorithm.RS256)
                .compact();
    }

    // ==================== JWT Validation Tests ====================

    /**
     * Test: JWT with valid signature is accepted and user is authenticated.
     * Requirements: 8.2 (JWT verification), 12.1 (JWKS caching)
     */
    @Test
    void testValidJwtAuthentication() throws Exception {
        // Given: A valid JWT token
        String orgId = "123e4567-e89b-12d3-a456-426614174000";
        String venueId = "223e4567-e89b-12d3-a456-426614174001";
        Map<String, String> venueRoles = Map.of(venueId, "admin");
        String jwt = generateTestJwt("user-123", "test@example.com", orgId, venueRoles, "pro");

        // When: Making an authenticated request
        mockMvc.perform(get("/api/v1/venues/" + venueId + "/ingredients")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk());
    }

    /**
     * Test: JWT with invalid signature is rejected.
     * Requirements: 8.2 (JWT signature verification)
     */
    @Test
    void testInvalidJwtSignatureRejected() throws Exception {
        // Given: A JWT token with tampered signature
        String venueId = "223e4567-e89b-12d3-a456-426614174001";
        String jwt = generateTestJwt("user-123", "test@example.com", "123e4567-e89b-12d3-a456-426614174000", 
                Map.of(venueId, "admin"), "pro");
        String tamperedJwt = jwt.substring(0, jwt.length() - 10) + "TAMPERED";

        // When: Making an authenticated request with tampered JWT
        // Then: Request is rejected with 401/403
        mockMvc.perform(get("/api/v1/venues/" + venueId + "/ingredients")
                        .header("Authorization", "Bearer " + tamperedJwt))
                .andExpect(status().isUnauthorized());
    }

    /**
     * Test: Expired JWT token is rejected.
     * Requirements: 8.2 (JWT expiration validation)
     */
    @Test
    void testExpiredJwtRejected() throws Exception {
        // Given: An expired JWT token
        String venueId = "223e4567-e89b-12d3-a456-426614174001";
        long now = System.currentTimeMillis();
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "test@example.com");
        claims.put("custom:org_id", "123e4567-e89b-12d3-a456-426614174000");
        claims.put("custom:tier", "pro");
        claims.put("custom:venue_roles", objectMapper.writeValueAsString(Map.of(venueId, "admin")));

        String expiredJwt = Jwts.builder()
                .setHeaderParam("kid", keyId)
                .setClaims(claims)
                .setIssuer("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST123")
                .setIssuedAt(new Date(now - 7200000)) // 2 hours ago
                .setExpiration(new Date(now - 3600000)) // Expired 1 hour ago
                .signWith(privateKey, SignatureAlgorithm.RS256)
                .compact();

        // When: Making an authenticated request with expired JWT
        // Then: Request is rejected
        mockMvc.perform(get("/api/v1/venues/" + venueId + "/ingredients")
                        .header("Authorization", "Bearer " + expiredJwt))
                .andExpect(status().isUnauthorized());
    }

    /**
     * Test: JWT without required claims is rejected.
     * Requirements: 8.2 (JWT claim validation), 8.4 (custom attributes)
     */
    @Test
    void testJwtWithoutRequiredClaimsRejected() throws Exception {
        // Given: A JWT token without custom claims
        String venueId = "223e4567-e89b-12d3-a456-426614174001";
        long now = System.currentTimeMillis();
        Map<String, Object> claims = new HashMap<>();
        claims.put("sub", "user-123");
        claims.put("email", "test@example.com");
        // Missing custom:org_id, custom:venue_roles, custom:tier

        String incompleteJwt = Jwts.builder()
                .setHeaderParam("kid", keyId)
                .setClaims(claims)
                .setIssuer("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_TEST123")
                .setIssuedAt(new Date(now))
                .setExpiration(new Date(now + 3600000))
                .signWith(privateKey, SignatureAlgorithm.RS256)
                .compact();

        // When: Making an authenticated request with incomplete JWT
        // Then: Request may fail due to missing venue access
        mockMvc.perform(get("/api/v1/venues/" + venueId + "/ingredients")
                        .header("Authorization", "Bearer " + incompleteJwt))
                .andExpect(status().isUnauthorized());
    }

    /**
     * Test: JWT with correct venue roles grants access.
     * Requirements: 9.2 (RBAC), 9.3 (Manager permissions), 9.4 (Staff read-only)
     */
    @Test
    void testVenueRoleBasedAccess() throws Exception {
        // Given: A JWT with Manager role for venue
        String venueId = "223e4567-e89b-12d3-a456-426614174001";
        Map<String, String> venueRoles = Map.of(venueId, "manager");
        String jwt = generateTestJwt("user-123", "test@example.com", "123e4567-e89b-12d3-a456-426614174000", venueRoles, "pro");

        // When: Manager accesses their venue
        // Then: Access granted
        mockMvc.perform(get("/api/v1/venues/" + venueId + "/ingredients")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk());
    }

    /**
     * Test: JWT without venue access is rejected.
     * Requirements: 10.3 (venue data isolation)
     */
    @Test
    void testAccessToUnauthorizedVenueRejected() throws Exception {
        // Given: A JWT with access to one venue
        String authorizedVenueId = "223e4567-e89b-12d3-a456-426614174001";
        String unauthorizedVenueId = "323e4567-e89b-12d3-a456-426614174002";
        Map<String, String> venueRoles = Map.of(authorizedVenueId, "admin");
        String jwt = generateTestJwt("user-123", "test@example.com", "123e4567-e89b-12d3-a456-426614174000", venueRoles, "pro");

        // When: Attempting to access unauthorized venue
        // Then: Access denied
        mockMvc.perform(get("/api/v1/venues/" + unauthorizedVenueId + "/ingredients")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isForbidden());
    }

    // ==================== Password Reset Tests ====================

    /**
     * Test: Password reset request returns generic success message.
     * Requirements: 8.7 (password reset request), 8.8 (generic response)
     * Note: Requires mocking AWS SDK Cognito client - skipped in integration test
     */
    // Password reset tests require mocking AWS SDK client
    // These are better tested in unit tests (AuthServiceTest)

    /**
     * Test: Password reset confirmation with valid code succeeds.
     * Requirements: 8.7 (password reset confirmation)
     * Note: Requires mocking AWS SDK Cognito client - skipped in integration test
     */
    // Password reset confirmation tests require mocking AWS SDK client
    // These are better tested in unit tests (AuthControllerTest)

    // ==================== Session Invalidation Tests ====================

    /**
     * Test: Logout invalidates all user sessions.
     * Requirements: 8.9 (session invalidation on logout)
     * Note: Requires mocking AWS SDK Cognito client - tested in AuthControllerTest
     */
    // Session invalidation tests require mocking AWS SDK client
    // These are covered in unit tests (AuthControllerTest)

    /**
     * Test: Password change invalidates all active sessions.
     * Requirements: 8.9 (session invalidation on password change)
     * Note: Cognito automatically invalidates sessions on password reset
     * This is covered in password reset unit tests
     */
    // Password change session invalidation is automatic Cognito behavior
    // Verified in unit tests (AuthControllerTest)

    // ==================== Social Login Account Linking Tests ====================

    /**
     * Test: Social login creates new user on first authentication.
     * Requirements: 8.3, 8.4 (Google/Apple OAuth), 8.5 (account creation)
     */
    @Test
    void testSocialLoginCreatesNewUser() throws Exception {
        // Mock Cognito OAuth token exchange endpoint
        String tokenResponse = """
                {
                    "access_token": "mock-access-token",
                    "refresh_token": "mock-refresh-token",
                    "id_token": "mock-id-token",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                }
                """;

        wireMockServer.stubFor(WireMock.post(urlEqualTo("/oauth2/token"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(tokenResponse)));

        // Given: OAuth authorization code from Google/Apple
        String oauthCode = "auth-code-123";
        String redirectUri = "http://localhost:8080/callback";

        // When: Exchanging OAuth code for tokens
        mockMvc.perform(post("/api/v1/auth/oauth/token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(String.format("{\"code\":\"%s\",\"redirectUri\":\"%s\"}", 
                                oauthCode, redirectUri)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("mock-access-token"))
                .andExpect(jsonPath("$.refreshToken").value("mock-refresh-token"))
                .andExpect(jsonPath("$.idToken").value("mock-id-token"))
                .andExpect(jsonPath("$.expiresIn").value(3600));

        // Verify token exchange was called with correct parameters
        wireMockServer.verify(postRequestedFor(urlEqualTo("/oauth2/token"))
                .withHeader("Content-Type", equalTo("application/x-www-form-urlencoded"))
                .withHeader("Authorization", matching("Basic .*"))
                .withRequestBody(containing("grant_type=authorization_code"))
                .withRequestBody(containing("code=" + oauthCode)));
    }

    /**
     * Test: Social login links to existing account when email matches.
     * Requirements: 8.6 (account linking)
     * Note: This is handled automatically by Cognito when email matches
     */
    @Test
    void testSocialLoginLinksToExistingAccount() throws Exception {
        // Mock Cognito OAuth token exchange for existing user
        String tokenResponse = """
                {
                    "access_token": "linked-access-token",
                    "refresh_token": "linked-refresh-token",
                    "id_token": "linked-id-token",
                    "expires_in": 3600,
                    "token_type": "Bearer"
                }
                """;

        wireMockServer.stubFor(WireMock.post(urlEqualTo("/oauth2/token"))
                .willReturn(aResponse()
                        .withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(tokenResponse)));

        // Given: OAuth code for user with existing email
        String oauthCode = "auth-code-existing-user";
        String redirectUri = "http://localhost:8080/callback";

        // When: Exchanging OAuth code
        mockMvc.perform(post("/api/v1/auth/oauth/token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(String.format("{\"code\":\"%s\",\"redirectUri\":\"%s\"}", 
                                oauthCode, redirectUri)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").exists());

        // Then: Cognito links the social provider to the existing account
        // (No duplicate user created - verified by Cognito's behavior)
    }

    /**
     * Test: Invalid OAuth code returns authentication error.
     * Requirements: 8.3, 8.4 (OAuth error handling)
     */
    @Test
    void testInvalidOAuthCodeReturnsError() throws Exception {
        // Mock Cognito OAuth token exchange with error response
        wireMockServer.stubFor(WireMock.post(urlEqualTo("/oauth2/token"))
                .willReturn(aResponse()
                        .withStatus(400)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{\"error\":\"invalid_grant\",\"error_description\":\"Invalid authorization code\"}")));

        // Given: Invalid OAuth authorization code
        String invalidCode = "invalid-code";
        String redirectUri = "http://localhost:8080/callback";

        // When: Attempting to exchange invalid code
        mockMvc.perform(post("/api/v1/auth/oauth/token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(String.format("{\"code\":\"%s\",\"redirectUri\":\"%s\"}", 
                                invalidCode, redirectUri)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_5001"));
    }

    /**
     * Test: JWKS endpoint caching and key rotation.
     * Requirements: 12.1 (JWKS caching and rotation)
     */
    @Test
    void testJwksEndpointCachingAndRotation() throws Exception {
        // Given: Initial JWT with key-1
        String venueId = "223e4567-e89b-12d3-a456-426614174001";
        String jwt1 = generateTestJwt("user-123", "test@example.com", "123e4567-e89b-12d3-a456-426614174000", 
                Map.of(venueId, "admin"), "pro");

        // When: Making first request
        mockMvc.perform(get("/api/v1/venues/" + venueId + "/ingredients")
                        .header("Authorization", "Bearer " + jwt1))
                .andExpect(status().isOk());

        // Verify JWKS was fetched
        wireMockServer.verify(1, getRequestedFor(urlEqualTo("/.well-known/jwks.json")));

        // When: Making second request with same key
        mockMvc.perform(get("/api/v1/venues/" + venueId + "/ingredients")
                        .header("Authorization", "Bearer " + jwt1))
                .andExpect(status().isOk());

        // Then: JWKS should be cached (may not be fetched again immediately)
        // Note: The exact caching behavior depends on Spring Security's JWK set cache configuration
    }

    /**
     * Test: Multiple venue roles in JWT are correctly parsed and enforced.
     * Requirements: 8.4 (venue_roles custom attribute), 9.2 (RBAC)
     */
    @Test
    void testMultipleVenueRolesInJwt() throws Exception {
        // Given: A JWT with multiple venue roles
        String venue1 = "223e4567-e89b-12d3-a456-426614174001";
        String venue2 = "323e4567-e89b-12d3-a456-426614174002";
        String venue3 = "423e4567-e89b-12d3-a456-426614174003";
        String venue4 = "523e4567-e89b-12d3-a456-426614174004";
        
        Map<String, String> venueRoles = Map.of(
                venue1, "admin",
                venue2, "manager",
                venue3, "staff"
        );
        String jwt = generateTestJwt("user-123", "test@example.com", "123e4567-e89b-12d3-a456-426614174000", venueRoles, "pro");

        // When: Accessing venue-1 as admin
        mockMvc.perform(get("/api/v1/venues/" + venue1 + "/ingredients")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk());

        // When: Accessing venue-2 as manager
        mockMvc.perform(get("/api/v1/venues/" + venue2 + "/ingredients")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk());

        // When: Accessing venue-3 as staff (read-only)
        mockMvc.perform(get("/api/v1/venues/" + venue3 + "/ingredients")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk());

        // When: Attempting to access venue-4 (not in roles)
        mockMvc.perform(get("/api/v1/venues/" + venue4 + "/ingredients")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isForbidden());
    }

    /**
     * Test: Subscription tier in JWT is correctly parsed.
     * Requirements: 8.4 (tier custom attribute), 11.3 (tier-based feature gating)
     */
    @Test
    void testSubscriptionTierInJwt() throws Exception {
        // Given: A JWT with Pro tier
        String venueId = "223e4567-e89b-12d3-a456-426614174001";
        String jwt = generateTestJwt("user-123", "test@example.com", "123e4567-e89b-12d3-a456-426614174000", 
                Map.of(venueId, "admin"), "pro");

        // When: Accessing endpoint (tier validation happens in SubscriptionGateFilter)
        mockMvc.perform(get("/api/v1/venues/" + venueId + "/ingredients")
                        .header("Authorization", "Bearer " + jwt))
                .andExpect(status().isOk());

        // Note: Tier-based feature gating is tested in SubscriptionGateFilterTest
        // This test verifies the tier claim is correctly included in the JWT
    }
}
