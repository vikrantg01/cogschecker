package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.dto.AuthResponse;
import com.cogschecker.foodcost.api.dto.LoginRequest;
import com.cogschecker.foodcost.api.dto.MessageResponse;
import com.cogschecker.foodcost.api.dto.RegisterRequest;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Test authentication controller for local development without AWS Cognito.
 * This controller bypasses Cognito and provides mock responses for testing.
 * 
 * IMPORTANT: This is only active when spring.profiles.active=local
 * DO NOT use in production!
 */
@RestController
@RequestMapping("/api/v1/auth")
@Profile("local")
public class TestAuthController {

    private static final Logger logger = LoggerFactory.getLogger(TestAuthController.class);

    /**
     * Mock registration endpoint for local testing.
     * Returns success without actually creating a user in Cognito.
     * Accepts raw Map to bypass validation issues.
     */
    @PostMapping("/register")
    public ResponseEntity<MessageResponse> mockRegister(@RequestBody Map<String, String> request) {
        String email = request.get("email");
        String displayName = request.get("displayName");
        
        logger.info("MOCK: Registering user: {} (displayName: {})", email, displayName);
        
        // Simulate successful registration
        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(new MessageResponse(
                    "✅ Registration successful! Welcome " + displayName + "! " +
                    "(Running in test mode - no actual user was created)"
                ));
    }

    /**
     * Mock login endpoint for local testing.
     * Returns mock JWT tokens without validating credentials.
     */
    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> mockLogin(@Valid @RequestBody LoginRequest request) {
        logger.info("MOCK: Logging in user: {}", request.getEmail());
        
        // Generate a mock JWT token that the frontend can decode
        // Format: header.payload.signature (all base64-encoded)
        // We'll create a simple JWT with the necessary claims
        String header = java.util.Base64.getEncoder().encodeToString("{\"alg\":\"none\",\"typ\":\"JWT\"}".getBytes());
        String payload = java.util.Base64.getEncoder().encodeToString(
            ("{\"sub\":\"00000000-0000-0000-0000-000000000002\"," +
             "\"email\":\"" + request.getEmail() + "\"," +
             "\"custom:org_id\":\"00000000-0000-0000-0000-000000000002\"," +
             "\"custom:tier\":\"PRO\"," +
             "\"custom:venue_roles\":\"{}\"}").getBytes()
        );
        String signature = "mock-signature";
        String mockAccessToken = header + "." + payload + "." + signature;
        
        String mockRefreshToken = "mock-refresh-token-" + System.currentTimeMillis();
        
        // Create mock user object with organisation_id
        Map<String, String> user = Map.of(
            "id", "00000000-0000-0000-0000-000000000002",
            "email", request.getEmail(),
            "displayName", "Test User",
            "organisationId", "00000000-0000-0000-0000-000000000002"
        );
        
        // Return response matching frontend expectations
        Map<String, Object> response = Map.of(
            "accessToken", mockAccessToken,
            "refreshToken", mockRefreshToken,
            "user", user
        );
        
        return ResponseEntity.ok(response);
    }

    /**
     * Info endpoint to confirm test mode is active.
     */
    @GetMapping("/test-mode")
    public ResponseEntity<MessageResponse> testModeInfo() {
        return ResponseEntity.ok(new MessageResponse(
            "⚠️  TEST MODE ACTIVE - Using mock authentication (no Cognito)"
        ));
    }
}
