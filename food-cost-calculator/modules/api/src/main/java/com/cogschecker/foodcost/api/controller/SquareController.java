package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.SquareConnection;
import com.cogschecker.foodcost.api.dto.SquareConnectionResponse;
import com.cogschecker.foodcost.api.dto.SquareUnmatchedItemResponse;
import com.cogschecker.foodcost.api.dto.UpdateUnmatchedItemRequest;
import com.cogschecker.foodcost.api.service.SquareOAuthService;
import com.cogschecker.foodcost.api.service.SquareUnmatchedItemService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.view.RedirectView;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * REST controller for Square POS integration endpoints.
 * Requirements: 12.1 (Square OAuth authorization flow)
 */
@RestController
@RequestMapping("/api/v1/venues/{venueId}/square")
public class SquareController {
    
    private static final Logger logger = LoggerFactory.getLogger(SquareController.class);
    
    private final SquareOAuthService squareOAuthService;
    private final SquareUnmatchedItemService squareUnmatchedItemService;
    
    public SquareController(
            SquareOAuthService squareOAuthService,
            SquareUnmatchedItemService squareUnmatchedItemService) {
        this.squareOAuthService = squareOAuthService;
        this.squareUnmatchedItemService = squareUnmatchedItemService;
    }
    
    /**
     * Initiate Square OAuth flow by redirecting to Square authorization page.
     * GET /venues/:venueId/square/connect
     * 
     * Requirements: 12.1
     * Admin-only endpoint (Pro/Pro+ tier)
     * 
     * @param venueId the venue ID to connect
     * @return redirect to Square OAuth consent screen
     */
    @GetMapping("/connect")
    @PreAuthorize("hasVenueRole('ADMIN', #venueId)")
    public RedirectView initiateOAuthFlow(@PathVariable UUID venueId) {
        logger.info("Initiating Square OAuth flow for venue {}", venueId);
        
        try {
            String authorizationUrl = squareOAuthService.getAuthorizationUrl(venueId);
            return new RedirectView(authorizationUrl);
        } catch (Exception e) {
            logger.error("Failed to initiate Square OAuth flow for venue {}", venueId, e);
            throw new RuntimeException("Failed to initiate Square OAuth flow: " + e.getMessage());
        }
    }
    
    /**
     * Handle Square OAuth callback after user authorization.
     * GET /venues/:venueId/square/callback
     * 
     * Requirements: 12.1
     * This endpoint exchanges the authorization code for tokens and stores them encrypted.
     * 
     * @param venueId the venue ID
     * @param code the authorization code from Square
     * @param state the state parameter (should match venueId)
     * @param error optional error from Square
     * @param errorDescription optional error description from Square
     * @return connection confirmation response
     */
    @GetMapping("/callback")
    public ResponseEntity<?> handleOAuthCallback(
            @PathVariable UUID venueId,
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            @RequestParam(required = false) String error,
            @RequestParam(name = "error_description", required = false) String errorDescription) {
        
        logger.info("Received Square OAuth callback for venue {}", venueId);
        
        // Check for Square OAuth errors
        if (error != null) {
            logger.error("Square OAuth error for venue {}: {} - {}", venueId, error, errorDescription);
            Map<String, String> errorResponse = new HashMap<>();
            errorResponse.put("error", error);
            errorResponse.put("message", errorDescription != null ? errorDescription : "Authorization failed");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
        }
        
        // Validate state parameter matches venueId
        if (state == null || !state.equals(venueId.toString())) {
            logger.error("State parameter mismatch for venue {}: expected {}, got {}", 
                        venueId, venueId.toString(), state);
            Map<String, String> errorResponse = new HashMap<>();
            errorResponse.put("error", "invalid_state");
            errorResponse.put("message", "Invalid state parameter");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
        }
        
        // Validate code is present
        if (code == null || code.isEmpty()) {
            logger.error("Missing authorization code for venue {}", venueId);
            Map<String, String> errorResponse = new HashMap<>();
            errorResponse.put("error", "missing_code");
            errorResponse.put("message", "Authorization code is required");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorResponse);
        }
        
        try {
            // Exchange code for tokens and store encrypted
            SquareConnection connection = squareOAuthService.exchangeCodeForTokens(venueId, code);
            
            // Build response
            SquareConnectionResponse response = new SquareConnectionResponse(
                    connection.getVenueId(),
                    connection.getSquareMerchantId(),
                    true,
                    connection.getLastSyncedAt(),
                    connection.getSyncStatus().name()
            );
            
            logger.info("Successfully connected Square merchant {} for venue {}", 
                       connection.getSquareMerchantId(), venueId);
            
            return ResponseEntity.ok(response);
            
        } catch (Exception e) {
            logger.error("Failed to process Square OAuth callback for venue {}", venueId, e);
            Map<String, String> errorResponse = new HashMap<>();
            errorResponse.put("error", "token_exchange_failed");
            errorResponse.put("message", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(errorResponse);
        }
    }
    
    /**
     * Get Square connection status for a venue.
     * GET /venues/:venueId/square/connection
     * 
     * @param venueId the venue ID
     * @return connection status
     */
    @GetMapping("/connection")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
    public ResponseEntity<SquareConnectionResponse> getConnectionStatus(@PathVariable UUID venueId) {
        try {
            if (!squareOAuthService.isConnected(venueId)) {
                SquareConnectionResponse response = new SquareConnectionResponse(
                        venueId, null, false, null, null);
                return ResponseEntity.ok(response);
            }
            
            SquareConnection connection = squareOAuthService.getConnection(venueId);
            SquareConnectionResponse response = new SquareConnectionResponse(
                    connection.getVenueId(),
                    connection.getSquareMerchantId(),
                    true,
                    connection.getLastSyncedAt(),
                    connection.getSyncStatus().name()
            );
            
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Failed to get Square connection status for venue {}", venueId, e);
            throw new RuntimeException("Failed to get connection status: " + e.getMessage());
        }
    }
    
    /**
     * Disconnect Square POS integration for a venue.
     * DELETE /venues/:venueId/square/connection
     * 
     * @param venueId the venue ID
     * @return no content
     */
    @DeleteMapping("/connection")
    @PreAuthorize("hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<Void> disconnectSquare(@PathVariable UUID venueId) {
        logger.info("Disconnecting Square for venue {}", venueId);
        
        try {
            squareOAuthService.disconnect(venueId);
            return ResponseEntity.noContent().build();
        } catch (Exception e) {
            logger.error("Failed to disconnect Square for venue {}", venueId, e);
            throw new RuntimeException("Failed to disconnect Square: " + e.getMessage());
        }
    }
    
    /**
     * Get all unmatched Square items for a venue.
     * GET /venues/:venueId/square/unmatched
     * 
     * Requirements: 12.4
     * Admin or Manager can view unmatched items
     * 
     * @param venueId the venue ID
     * @return list of unmatched items
     */
    @GetMapping("/unmatched")
    @PreAuthorize("hasVenueRole('MANAGER', #venueId)")
    public ResponseEntity<List<SquareUnmatchedItemResponse>> getUnmatchedItems(@PathVariable UUID venueId) {
        logger.info("Fetching unmatched items for venue {}", venueId);
        
        try {
            List<SquareUnmatchedItemResponse> unmatchedItems = squareUnmatchedItemService.getUnmatchedItems(venueId);
            return ResponseEntity.ok(unmatchedItems);
        } catch (Exception e) {
            logger.error("Failed to fetch unmatched items for venue {}", venueId, e);
            throw new RuntimeException("Failed to fetch unmatched items: " + e.getMessage());
        }
    }
    
    /**
     * Update an unmatched Square item (map to recipe or dismiss).
     * PATCH /venues/:venueId/square/unmatched/:id
     * 
     * Requirements: 12.4
     * Admin can map or dismiss unmatched items
     * 
     * @param venueId the venue ID
     * @param unmatchedItemId the unmatched item ID
     * @param request the update request
     * @return updated unmatched item
     */
    @PatchMapping("/unmatched/{unmatchedItemId}")
    @PreAuthorize("hasVenueRole('ADMIN', #venueId)")
    public ResponseEntity<SquareUnmatchedItemResponse> updateUnmatchedItem(
            @PathVariable UUID venueId,
            @PathVariable UUID unmatchedItemId,
            @Valid @RequestBody UpdateUnmatchedItemRequest request) {
        
        logger.info("Updating unmatched item {} for venue {}", unmatchedItemId, venueId);
        
        try {
            SquareUnmatchedItemResponse response = squareUnmatchedItemService.updateUnmatchedItem(
                    venueId, unmatchedItemId, request);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            logger.error("Failed to update unmatched item {} for venue {}", unmatchedItemId, venueId, e);
            throw new RuntimeException("Failed to update unmatched item: " + e.getMessage());
        }
    }
}
