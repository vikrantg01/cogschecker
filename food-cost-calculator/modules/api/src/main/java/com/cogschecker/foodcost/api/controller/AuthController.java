package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.dto.*;
import com.cogschecker.foodcost.api.service.AuthService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.view.RedirectView;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * REST controller for authentication operations via AWS Cognito.
 * Requirements: 6.1 (registration), 6.2 (login), 6.3 (refresh), 6.7 (password reset), 8.3 (Google OAuth), 8.4 (Apple OAuth)
 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private static final Logger logger = LoggerFactory.getLogger(AuthController.class);

    private final AuthService authService;

    @Value("${cognito.domain}")
    private String cognitoDomain;

    @Value("${cognito.client-id}")
    private String clientId;

    @Value("${cognito.redirect-uri}")
    private String redirectUri;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * Register a new user with email and password.
     * Requirements: 6.1 (email/password registration with validation)
     *
     * POST /api/v1/auth/register
     * {
     *   "email": "user@example.com",
     *   "password": "SecurePass123",
     *   "displayName": "John Doe"
     * }
     *
     * @param request the registration request with validated fields
     * @return HTTP 201 with success message
     */
    @PostMapping("/register")
    public ResponseEntity<MessageResponse> register(@Valid @RequestBody RegisterRequest request) {
        logger.info("POST /auth/register - registering user: {}", request.getEmail());

        authService.register(request.getEmail(), request.getPassword(), request.getDisplayName());

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(new MessageResponse("User registered successfully. Please check your email to confirm your account."));
    }

    /**
     * Authenticate user with email and password.
     * Requirements: 6.2 (email/password login)
     *
     * POST /api/v1/auth/login
     * {
     *   "email": "user@example.com",
     *   "password": "SecurePass123"
     * }
     *
     * @param request the login request
     * @return HTTP 200 with JWT tokens (access, refresh, ID)
     */
    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        logger.info("POST /auth/login - authenticating user: {}", request.getEmail());

        AuthResponse response = authService.login(request.getEmail(), request.getPassword());

        return ResponseEntity.ok(response);
    }

    /**
     * Refresh access token using refresh token.
     * Requirements: 6.3 (token refresh)
     *
     * POST /api/v1/auth/refresh
     * {
     *   "refreshToken": "eyJjdHk..."
     * }
     *
     * @param request the refresh token request
     * @return HTTP 200 with new access and ID tokens
     */
    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refreshToken(@Valid @RequestBody RefreshTokenRequest request) {
        logger.info("POST /auth/refresh - refreshing access token");

        AuthResponse response = authService.refreshToken(request.getRefreshToken());

        return ResponseEntity.ok(response);
    }

    /**
     * Logout user - invalidate all active sessions.
     * Requirements: 6.9 (session invalidation)
     *
     * POST /api/v1/auth/logout
     * Authorization: Bearer <access-token>
     *
     * @param authorizationHeader the Authorization header containing the access token
     * @return HTTP 200 with success message
     */
    @PostMapping("/logout")
    public ResponseEntity<MessageResponse> logout(
            @RequestHeader(value = "Authorization", required = false) String authorizationHeader) {
        logger.info("POST /auth/logout - logging out user");

        // Extract token from "Bearer <token>" format
        String accessToken = null;
        if (authorizationHeader != null && authorizationHeader.startsWith("Bearer ")) {
            accessToken = authorizationHeader.substring(7);
        }

        if (accessToken == null || accessToken.isEmpty()) {
            return ResponseEntity
                    .status(HttpStatus.BAD_REQUEST)
                    .body(new MessageResponse("Access token is required"));
        }

        authService.logout(accessToken);

        return ResponseEntity.ok(new MessageResponse("Logged out successfully"));
    }

    /**
     * Request password reset - sends reset code to user's email.
     * Requirements: 6.7 (password reset request), 6.8 (generic confirmation message)
     *
     * POST /api/v1/auth/password-reset/request
     * {
     *   "email": "user@example.com"
     * }
     *
     * Note: Always returns success to prevent email enumeration (Requirement 6.8)
     *
     * @param request the password reset request
     * @return HTTP 200 with generic confirmation message
     */
    @PostMapping("/password-reset/request")
    public ResponseEntity<MessageResponse> requestPasswordReset(
            @Valid @RequestBody PasswordResetRequestDto request) {
        logger.info("POST /auth/password-reset/request - processing reset request for: {}", request.getEmail());

        authService.requestPasswordReset(request.getEmail());

        // Requirement 6.8: Always return generic message, don't reveal if email exists
        return ResponseEntity.ok(new MessageResponse(
                "If an account exists with that email, a password reset link has been sent. " +
                "Please check your email within 2 minutes."
        ));
    }

    /**
     * Confirm password reset with verification code and new password.
     * Requirements: 6.7 (password reset confirmation), 6.9 (session invalidation)
     *
     * POST /api/v1/auth/password-reset/confirm
     * {
     *   "email": "user@example.com",
     *   "confirmationCode": "123456",
     *   "newPassword": "NewSecurePass123"
     * }
     *
     * @param request the password reset confirmation request
     * @return HTTP 200 with success message
     */
    @PostMapping("/password-reset/confirm")
    public ResponseEntity<MessageResponse> confirmPasswordReset(
            @Valid @RequestBody PasswordResetConfirmRequest request) {
        logger.info("POST /auth/password-reset/confirm - confirming reset for: {}", request.getEmail());

        authService.confirmPasswordReset(
                request.getEmail(),
                request.getConfirmationCode(),
                request.getNewPassword()
        );

        return ResponseEntity.ok(new MessageResponse(
                "Password reset successfully. All active sessions have been invalidated. Please log in with your new password."
        ));
    }

    /**
     * Initiates Google OAuth flow by redirecting to Cognito hosted UI.
     * Requirements: 8.3 (Google social login)
     * 
     * GET /api/v1/auth/oauth/google
     * 
     * @return RedirectView to Cognito hosted UI with Google identity provider
     */
    @GetMapping("/oauth/google")
    public RedirectView initiateGoogleOAuth() {
        logger.info("GET /auth/oauth/google - initiating Google OAuth flow");
        String authUrl = buildCognitoAuthUrl("Google");
        return new RedirectView(authUrl);
    }

    /**
     * Handles Google OAuth callback from Cognito.
     * Receives authorization code after successful authentication and redirects to frontend.
     * Requirements: 8.3 (Google social login), 8.5 (account creation), 8.6 (account linking)
     * 
     * GET /api/v1/auth/oauth/google/callback?code=xxx
     * 
     * @param code Authorization code from Cognito
     * @param error Error code if authentication failed
     * @param errorDescription Human-readable error description
     * @return RedirectView to frontend OAuth callback page
     */
    @GetMapping("/oauth/google/callback")
    public RedirectView handleGoogleCallback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String error,
            @RequestParam(name = "error_description", required = false) String errorDescription) {
        
        logger.info("GET /auth/oauth/google/callback - handling Google OAuth callback");
        
        // Build frontend callback URL - using google-specific route
        String frontendCallbackUrl = "http://localhost:5173/oauth/google/callback";
        
        if (error != null) {
            logger.warn("Google OAuth callback error: {} - {}", error, errorDescription);
            // Redirect to frontend with error parameters
            String url = String.format("%s?error=%s&error_description=%s",
                frontendCallbackUrl,
                URLEncoder.encode(error, StandardCharsets.UTF_8),
                URLEncoder.encode(errorDescription != null ? errorDescription : "", StandardCharsets.UTF_8));
            return new RedirectView(url);
        }

        if (code == null || code.isBlank()) {
            logger.warn("Google OAuth callback missing authorization code");
            String url = String.format("%s?error=%s&error_description=%s",
                frontendCallbackUrl,
                "missing_code",
                URLEncoder.encode("Authorization code not provided", StandardCharsets.UTF_8));
            return new RedirectView(url);
        }

        logger.info("Google OAuth callback successful, redirecting to frontend with authorization code");
        // Redirect to frontend with authorization code and provider parameter
        String url = String.format("%s?code=%s&provider=%s", 
            frontendCallbackUrl, 
            URLEncoder.encode(code, StandardCharsets.UTF_8),
            "google");
        return new RedirectView(url);
    }

    /**
     * Initiates Apple OAuth flow by redirecting to Cognito hosted UI.
     * Requirements: 8.4 (Apple social login)
     * 
     * GET /api/v1/auth/oauth/apple
     * 
     * @return RedirectView to Cognito hosted UI with Apple identity provider
     */
    @GetMapping("/oauth/apple")
    public RedirectView initiateAppleOAuth() {
        logger.info("GET /auth/oauth/apple - initiating Apple OAuth flow");
        String authUrl = buildCognitoAuthUrl("SignInWithApple");
        return new RedirectView(authUrl);
    }

    /**
     * Handles Apple OAuth callback from Cognito.
     * Receives authorization code after successful authentication and redirects to frontend.
     * Requirements: 8.4 (Apple social login), 8.5 (account creation), 8.6 (account linking)
     * 
     * GET /api/v1/auth/oauth/apple/callback?code=xxx
     * 
     * @param code Authorization code from Cognito
     * @param error Error code if authentication failed
     * @param errorDescription Human-readable error description
     * @return RedirectView to frontend OAuth callback page
     */
    @GetMapping("/oauth/apple/callback")
    public RedirectView handleAppleCallback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String error,
            @RequestParam(name = "error_description", required = false) String errorDescription) {
        
        logger.info("GET /auth/oauth/apple/callback - handling Apple OAuth callback");
        
        // Build frontend callback URL - using apple-specific route
        String frontendCallbackUrl = "http://localhost:5173/oauth/apple/callback";
        
        if (error != null) {
            logger.warn("Apple OAuth callback error: {} - {}", error, errorDescription);
            // Redirect to frontend with error parameters
            String url = String.format("%s?error=%s&error_description=%s",
                frontendCallbackUrl,
                URLEncoder.encode(error, StandardCharsets.UTF_8),
                URLEncoder.encode(errorDescription != null ? errorDescription : "", StandardCharsets.UTF_8));
            return new RedirectView(url);
        }

        if (code == null || code.isBlank()) {
            logger.warn("Apple OAuth callback missing authorization code");
            String url = String.format("%s?error=%s&error_description=%s",
                frontendCallbackUrl,
                "missing_code",
                URLEncoder.encode("Authorization code not provided", StandardCharsets.UTF_8));
            return new RedirectView(url);
        }

        logger.info("Apple OAuth callback successful, redirecting to frontend with authorization code");
        // Redirect to frontend with authorization code and provider parameter
        String url = String.format("%s?code=%s&provider=%s", 
            frontendCallbackUrl, 
            URLEncoder.encode(code, StandardCharsets.UTF_8),
            "apple");
        return new RedirectView(url);
    }

    /**
     * Builds the Cognito hosted UI authorization URL with the specified identity provider.
     * 
     * @param identityProvider Identity provider name ("Google" or "SignInWithApple")
     * @return Complete authorization URL
     */
    private String buildCognitoAuthUrl(String identityProvider) {
        String callbackUri = redirectUri + "/" + identityProvider.toLowerCase().replace("signinwith", "") + "/callback";
        String encodedRedirectUri = URLEncoder.encode(callbackUri, StandardCharsets.UTF_8);
        
        return String.format(
            "%s/oauth2/authorize?client_id=%s&response_type=code&scope=email+openid+profile&redirect_uri=%s&identity_provider=%s",
            cognitoDomain,
            clientId,
            encodedRedirectUri,
            identityProvider
        );
    }

    /**
     * Exchange OAuth authorization code for JWT tokens.
     * Requirements: 8.3 (Google OAuth), 8.4 (Apple OAuth), 8.5 (account creation), 8.6 (account linking)
     * 
     * POST /api/v1/auth/oauth/token
     * {
     *   "code": "authorization_code_from_cognito",
     *   "redirectUri": "http://localhost:8080/api/v1/auth/oauth/google/callback"
     * }
     * 
     * This endpoint exchanges the authorization code received from Cognito for JWT tokens.
     * Cognito handles account creation and linking automatically based on email.
     * 
     * @param request the token exchange request
     * @return HTTP 200 with JWT tokens (access, refresh, ID)
     */
    @PostMapping("/oauth/token")
    public ResponseEntity<AuthResponse> exchangeOAuthToken(@Valid @RequestBody OAuthTokenRequest request) {
        logger.info("POST /auth/oauth/token - exchanging authorization code for tokens");

        AuthResponse response = authService.exchangeOAuthCode(request.code(), request.redirectUri());

        return ResponseEntity.ok(response);
    }

    /**
     * OAuth token exchange request DTO.
     */
    private record OAuthTokenRequest(String code, String redirectUri) {}

    /**
     * OAuth callback response DTO containing the authorization code.
     */
    private record OAuthCallbackResponse(String code) {}

    /**
     * Error response DTO for OAuth failures.
     */
    private record OAuthErrorResponse(String error, String errorDescription) {}
}
