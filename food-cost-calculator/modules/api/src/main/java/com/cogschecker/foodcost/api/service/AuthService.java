package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.dto.AuthResponse;
import com.cogschecker.foodcost.api.exception.AuthenticationException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.*;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Service for handling AWS Cognito authentication operations.
 * Requirements: 6.1 (registration), 6.2 (login), 6.3 (refresh), 6.7 (password reset), 6.9 (session invalidation)
 */
@Service
public class AuthService {

    private static final Logger logger = LoggerFactory.getLogger(AuthService.class);

    private final CognitoIdentityProviderClient cognitoClient;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    @Value("${cognito.user-pool-id}")
    private String userPoolId;

    @Value("${cognito.client-id}")
    private String clientId;

    @Value("${cognito.client-secret:#{null}}")
    private String clientSecret;

    @Value("${cognito.domain}")
    private String cognitoDomain;

    @Value("${cognito.redirect-uri}")
    private String redirectUri;

    public AuthService(CognitoIdentityProviderClient cognitoClient, ObjectMapper objectMapper) {
        this.cognitoClient = cognitoClient;
        this.httpClient = HttpClient.newHttpClient();
        this.objectMapper = objectMapper;
    }

    /**
     * Register a new user with email and password.
     * Requirements: 6.1 (email/password registration)
     *
     * @param email the user's email
     * @param password the user's password (must meet password policy)
     * @param displayName the user's display name
     * @throws AuthenticationException if registration fails
     */
    public void register(String email, String password, String displayName) {
        try {
            logger.info("Registering new user with email: {}", email);

            // Build user attributes
            Map<String, String> attributes = new HashMap<>();
            attributes.put("email", email);
            attributes.put("name", displayName);

            // Create sign-up request
            SignUpRequest signUpRequest = SignUpRequest.builder()
                    .clientId(clientId)
                    .username(email)
                    .password(password)
                    .userAttributes(
                            AttributeType.builder().name("email").value(email).build(),
                            AttributeType.builder().name("name").value(displayName).build()
                    )
                    .build();

            SignUpResponse response = cognitoClient.signUp(signUpRequest);

            logger.info("User registered successfully: {} (user confirmed: {})",
                    email, response.userConfirmed());

        } catch (UsernameExistsException e) {
            logger.warn("Registration failed - user already exists: {}", email);
            throw new AuthenticationException("User with this email already exists");
        } catch (InvalidPasswordException e) {
            logger.warn("Registration failed - invalid password for: {}", email);
            throw new AuthenticationException("Password does not meet requirements: " + e.getMessage());
        } catch (CognitoIdentityProviderException e) {
            logger.error("Cognito registration failed for {}: {}", email, e.getMessage(), e);
            throw new AuthenticationException("Registration failed: " + e.awsErrorDetails().errorMessage());
        }
    }

    /**
     * Authenticate user with email and password.
     * Requirements: 6.2 (email/password login)
     *
     * @param email the user's email
     * @param password the user's password
     * @return AuthResponse containing access, refresh, and ID tokens
     * @throws AuthenticationException if login fails
     */
    public AuthResponse login(String email, String password) {
        try {
            logger.info("Authenticating user: {}", email);

            Map<String, String> authParams = new HashMap<>();
            authParams.put("USERNAME", email);
            authParams.put("PASSWORD", password);

            InitiateAuthRequest authRequest = InitiateAuthRequest.builder()
                    .authFlow(AuthFlowType.USER_PASSWORD_AUTH)
                    .clientId(clientId)
                    .authParameters(authParams)
                    .build();

            InitiateAuthResponse authResponse = cognitoClient.initiateAuth(authRequest);

            AuthenticationResultType authResult = authResponse.authenticationResult();

            logger.info("User authenticated successfully: {}", email);

            return new AuthResponse(
                    authResult.accessToken(),
                    authResult.refreshToken(),
                    authResult.idToken(),
                    authResult.expiresIn()
            );

        } catch (NotAuthorizedException e) {
            logger.warn("Login failed - invalid credentials for: {}", email);
            throw new AuthenticationException("Invalid email or password");
        } catch (UserNotFoundException e) {
            logger.warn("Login failed - user not found: {}", email);
            throw new AuthenticationException("Invalid email or password");
        } catch (UserNotConfirmedException e) {
            logger.warn("Login failed - user not confirmed: {}", email);
            throw new AuthenticationException("User account not confirmed. Please check your email.");
        } catch (CognitoIdentityProviderException e) {
            logger.error("Cognito login failed for {}: {}", email, e.getMessage(), e);
            throw new AuthenticationException("Login failed: " + e.awsErrorDetails().errorMessage());
        }
    }

    /**
     * Refresh access token using refresh token.
     * Requirements: 6.3 (token refresh)
     *
     * @param refreshToken the refresh token
     * @return AuthResponse containing new access and ID tokens
     * @throws AuthenticationException if refresh fails
     */
    public AuthResponse refreshToken(String refreshToken) {
        try {
            logger.debug("Refreshing access token");

            Map<String, String> authParams = new HashMap<>();
            authParams.put("REFRESH_TOKEN", refreshToken);

            InitiateAuthRequest authRequest = InitiateAuthRequest.builder()
                    .authFlow(AuthFlowType.REFRESH_TOKEN_AUTH)
                    .clientId(clientId)
                    .authParameters(authParams)
                    .build();

            InitiateAuthResponse authResponse = cognitoClient.initiateAuth(authRequest);

            AuthenticationResultType authResult = authResponse.authenticationResult();

            logger.debug("Access token refreshed successfully");

            return new AuthResponse(
                    authResult.accessToken(),
                    refreshToken, // Cognito doesn't return new refresh token
                    authResult.idToken(),
                    authResult.expiresIn()
            );

        } catch (NotAuthorizedException e) {
            logger.warn("Token refresh failed - invalid or expired refresh token");
            throw new AuthenticationException("Invalid or expired refresh token");
        } catch (CognitoIdentityProviderException e) {
            logger.error("Cognito token refresh failed: {}", e.getMessage(), e);
            throw new AuthenticationException("Token refresh failed: " + e.awsErrorDetails().errorMessage());
        }
    }

    /**
     * Invalidate all user sessions (logout).
     * Requirements: 6.9 (session invalidation on logout)
     *
     * @param accessToken the user's current access token
     * @throws AuthenticationException if logout fails
     */
    public void logout(String accessToken) {
        try {
            logger.debug("Logging out user (invalidating tokens)");

            GlobalSignOutRequest signOutRequest = GlobalSignOutRequest.builder()
                    .accessToken(accessToken)
                    .build();

            cognitoClient.globalSignOut(signOutRequest);

            logger.info("User logged out successfully");

        } catch (NotAuthorizedException e) {
            logger.warn("Logout failed - invalid or expired access token");
            throw new AuthenticationException("Invalid or expired access token");
        } catch (CognitoIdentityProviderException e) {
            logger.error("Cognito logout failed: {}", e.getMessage(), e);
            throw new AuthenticationException("Logout failed: " + e.awsErrorDetails().errorMessage());
        }
    }

    /**
     * Request password reset - sends reset code to user's email.
     * Requirements: 6.7 (password reset request), 6.8 (generic confirmation message)
     *
     * @param email the user's email
     */
    public void requestPasswordReset(String email) {
        try {
            logger.info("Password reset requested for: {}", email);

            ForgotPasswordRequest request = ForgotPasswordRequest.builder()
                    .clientId(clientId)
                    .username(email)
                    .build();

            cognitoClient.forgotPassword(request);

            logger.info("Password reset code sent to: {}", email);

        } catch (UserNotFoundException e) {
            // Per requirement 6.8: Don't reveal whether email exists
            // Log but don't throw - return success to user
            logger.info("Password reset requested for non-existent user: {}", email);
        } catch (CognitoIdentityProviderException e) {
            logger.error("Password reset request failed for {}: {}", email, e.getMessage(), e);
            // Per requirement 6.8: Don't reveal failure details
            // We still complete successfully from the user's perspective
        }
    }

    /**
     * Confirm password reset with verification code and new password.
     * Requirements: 6.7 (password reset confirmation), 6.9 (session invalidation)
     *
     * @param email the user's email
     * @param confirmationCode the verification code sent to email
     * @param newPassword the new password
     * @throws AuthenticationException if confirmation fails
     */
    public void confirmPasswordReset(String email, String confirmationCode, String newPassword) {
        try {
            logger.info("Confirming password reset for: {}", email);

            ConfirmForgotPasswordRequest request = ConfirmForgotPasswordRequest.builder()
                    .clientId(clientId)
                    .username(email)
                    .confirmationCode(confirmationCode)
                    .password(newPassword)
                    .build();

            cognitoClient.confirmForgotPassword(request);

            logger.info("Password reset confirmed successfully for: {}", email);

            // Requirement 6.9: Password change invalidates all active sessions
            // Note: Cognito automatically invalidates sessions when password is reset

        } catch (CodeMismatchException e) {
            logger.warn("Password reset confirmation failed - invalid code for: {}", email);
            throw new AuthenticationException("Invalid confirmation code");
        } catch (ExpiredCodeException e) {
            logger.warn("Password reset confirmation failed - expired code for: {}", email);
            throw new AuthenticationException("Confirmation code has expired. Please request a new one.");
        } catch (InvalidPasswordException e) {
            logger.warn("Password reset confirmation failed - invalid password for: {}", email);
            throw new AuthenticationException("Password does not meet requirements: " + e.getMessage());
        } catch (CognitoIdentityProviderException e) {
            logger.error("Password reset confirmation failed for {}: {}", email, e.getMessage(), e);
            throw new AuthenticationException("Password reset failed: " + e.awsErrorDetails().errorMessage());
        }
    }

    /**
     * Exchange OAuth authorization code for JWT tokens via Cognito token endpoint.
     * Requirements: 8.3 (Google OAuth), 8.4 (Apple OAuth), 8.5 (account creation), 8.6 (account linking)
     * 
     * This method calls Cognito's OAuth token endpoint to exchange the authorization code
     * for JWT access, refresh, and ID tokens. Cognito automatically:
     * - Creates a new user if this is their first social login (Requirement 8.5)
     * - Links the social provider to existing account if email matches (Requirement 8.6)
     *
     * @param code the authorization code from Cognito hosted UI callback
     * @param callbackUri the redirect URI used in the OAuth flow (must match the one sent during initiation)
     * @return AuthResponse containing JWT tokens
     * @throws AuthenticationException if token exchange fails
     */
    public AuthResponse exchangeOAuthCode(String code, String callbackUri) {
        try {
            logger.info("Exchanging OAuth authorization code for tokens");

            if (clientSecret == null || clientSecret.isEmpty()) {
                throw new AuthenticationException("Client secret not configured for OAuth token exchange");
            }

            // Build Basic Auth header: Base64(clientId:clientSecret)
            String credentials = clientId + ":" + clientSecret;
            String basicAuth = "Basic " + Base64.getEncoder().encodeToString(credentials.getBytes(StandardCharsets.UTF_8));

            // Build form data for token exchange
            String formData = "grant_type=authorization_code" +
                    "&client_id=" + URLEncoder.encode(clientId, StandardCharsets.UTF_8) +
                    "&code=" + URLEncoder.encode(code, StandardCharsets.UTF_8) +
                    "&redirect_uri=" + URLEncoder.encode(callbackUri, StandardCharsets.UTF_8);

            // Call Cognito token endpoint
            String tokenEndpoint = cognitoDomain + "/oauth2/token";
            
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(tokenEndpoint))
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .header("Authorization", basicAuth)
                    .POST(HttpRequest.BodyPublishers.ofString(formData))
                    .build();

            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                logger.error("Cognito token exchange failed with status {}: {}", 
                        response.statusCode(), response.body());
                throw new AuthenticationException("OAuth authentication failed: Unable to exchange authorization code");
            }

            // Parse token response
            JsonNode jsonResponse = objectMapper.readTree(response.body());
            
            String accessToken = jsonResponse.get("access_token").asText();
            String refreshToken = jsonResponse.has("refresh_token") ? jsonResponse.get("refresh_token").asText() : null;
            String idToken = jsonResponse.get("id_token").asText();
            int expiresIn = jsonResponse.get("expires_in").asInt();

            logger.info("OAuth token exchange successful");

            return new AuthResponse(accessToken, refreshToken, idToken, expiresIn);

        } catch (IOException e) {
            logger.error("Failed to parse Cognito token response: {}", e.getMessage(), e);
            throw new AuthenticationException("OAuth authentication failed: Invalid response from authentication service");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            logger.error("Token exchange interrupted: {}", e.getMessage(), e);
            throw new AuthenticationException("OAuth authentication interrupted");
        } catch (Exception e) {
            logger.error("Unexpected error during OAuth token exchange: {}", e.getMessage(), e);
            throw new AuthenticationException("OAuth authentication failed: " + e.getMessage());
        }
    }
}
