package com.cogschecker.foodcost.api.security;

import com.cogschecker.foodcost.api.controller.IngredientController;
import com.cogschecker.foodcost.api.service.CostEventSseService;
import com.cogschecker.foodcost.api.service.IngredientService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Integration test for RBAC security with custom @PreAuthorize expressions.
 * Tests that hasVenueRole() expression works correctly in @PreAuthorize annotations.
 * 
 * Validates: Requirements 7.3, 9.1, 9.2, 9.3
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class RbacSecurityIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private CognitoJwtConverter cognitoJwtConverter;

    @MockBean
    private JwtDecoder jwtDecoder;

    @MockBean
    private IngredientService ingredientService;

    @MockBean
    private CostEventSseService costEventSseService;

    @Test
    void hasVenueRole_WithManagerRole_ShouldAllowAccessToManagerEndpoint() throws Exception {
        // Arrange - create a JWT with MANAGER role for venue-1
        UUID venueId = UUID.randomUUID();
        String venueIdStr = venueId.toString();
        
        Map<String, Object> claims = Map.of(
                "sub", "user-123",
                "email", "manager@example.com",
                "custom:org_id", "org-456",
                "custom:venue_roles", String.format("{\"%s\":\"manager\"}", venueIdStr),
                "custom:tier", "pro"
        );

        Jwt jwt = createJwt(claims);
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);
        when(ingredientService.getAllIngredients(venueId)).thenReturn(Collections.emptyList());

        // Act & Assert - should allow access to GET endpoint (which requires MANAGER or STAFF or ADMIN)
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueId)
                        .header("Authorization", "Bearer test-token"))
                .andDo(result -> {
                    System.out.println("Status: " + result.getResponse().getStatus());
                    System.out.println("Response: " + result.getResponse().getContentAsString());
                    if (result.getResolvedException() != null) {
                        System.out.println("Exception: " + result.getResolvedException().getMessage());
                        result.getResolvedException().printStackTrace();
                    }
                })
                .andExpect(status().isOk());
    }

    @Test
    void hasVenueRole_WithStaffRole_ShouldAllowAccessToReadEndpoint() throws Exception {
        // Arrange - create a JWT with STAFF role for venue-1
        UUID venueId = UUID.randomUUID();
        String venueIdStr = venueId.toString();
        
        Map<String, Object> claims = Map.of(
                "sub", "user-123",
                "email", "staff@example.com",
                "custom:org_id", "org-456",
                "custom:venue_roles", String.format("{\"%s\":\"staff\"}", venueIdStr),
                "custom:tier", "pro"
        );

        Jwt jwt = createJwt(claims);
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);
        when(ingredientService.getAllIngredients(venueId)).thenReturn(Collections.emptyList());

        // Act & Assert - should allow access to GET endpoint
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk());
    }

    @Test
    void hasVenueRole_WithNoAccessToVenue_ShouldDenyAccess() throws Exception {
        // Arrange - create a JWT with access to venue-1, but trying to access venue-2
        UUID venueIdWithAccess = UUID.randomUUID();
        UUID venueIdWithoutAccess = UUID.randomUUID();
        
        Map<String, Object> claims = Map.of(
                "sub", "user-123",
                "email", "user@example.com",
                "custom:org_id", "org-456",
                "custom:venue_roles", String.format("{\"%s\":\"manager\"}", venueIdWithAccess.toString()),
                "custom:tier", "pro"
        );

        Jwt jwt = createJwt(claims);
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        // Act & Assert - should deny access (403 Forbidden from VenueScopeFilter)
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueIdWithoutAccess)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser
    void hasVenueRole_WithoutJwtAuthentication_ShouldDenyAccess() throws Exception {
        // Arrange
        UUID venueId = UUID.randomUUID();

        // Act & Assert - @WithMockUser doesn't provide CognitoAuthenticationToken,
        // so hasVenueRole() should return false and deny access
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueId))
                .andExpect(status().isForbidden());
    }

    /**
     * Helper method to create a test JWT with given claims.
     */
    private Jwt createJwt(Map<String, Object> claims) {
        return new Jwt(
                "test-token",
                Instant.now(),
                Instant.now().plusSeconds(3600),
                Map.of("alg", "RS256"),
                claims
        );
    }
}
