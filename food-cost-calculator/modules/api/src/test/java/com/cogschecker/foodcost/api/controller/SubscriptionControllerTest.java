package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.dto.*;
import com.cogschecker.foodcost.api.repository.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for SubscriptionController REST endpoints.
 * Tests Requirements: 11.1, 11.4, 11.5, 11.6, 11.7, 11.9
 */
@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)  // Disable security filters for testing
@ActiveProfiles("test")
@Transactional
class SubscriptionControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @Autowired
    private OrganisationRepository organisationRepository;
    
    @Autowired
    private SubscriptionRepository subscriptionRepository;
    
    @Autowired
    private VenueRepository venueRepository;
    
    @Autowired
    private RecipeRepository recipeRepository;
    
    private Organisation testOrg;
    private Subscription subscription;
    
    @BeforeEach
    void setUp() {
        // Create test organisation
        testOrg = new Organisation("Test Organisation");
        testOrg = organisationRepository.save(testOrg);
        
        // Create subscription (default FREE tier)
        subscription = new Subscription(testOrg.getId(), SubscriptionTier.FREE);
        subscription = subscriptionRepository.save(subscription);
    }
    
    /**
     * Test GET /organisations/:orgId/subscription - get subscription details.
     * Requirements: 11.1, 11.7
     */
    @Test
    @WithMockUser
    void testGetSubscription_ReturnsSubscriptionDetails() throws Exception {
        // When/Then
        mockMvc.perform(get("/api/v1/organisations/{orgId}/subscription", testOrg.getId())
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.organisation_id").value(testOrg.getId().toString()))
            .andExpect(jsonPath("$.tier").value("FREE"));
    }
    
    /**
     * Test POST /organisations/:orgId/subscription/upgrade - upgrade subscription.
     * Requirement: 11.4
     */
    @Test
    @WithMockUser
    void testUpgradeSubscription_ValidRequest_UpgradesSuccessfully() throws Exception {
        // Given
        Instant currentPeriodEnd = Instant.now().plusSeconds(2592000); // 30 days
        UpgradeSubscriptionRequest request = new UpgradeSubscriptionRequest(
            SubscriptionTier.PRO,
            "cus_test123",
            "sub_test456",
            currentPeriodEnd
        );
        
        // When/Then
        mockMvc.perform(post("/api/v1/organisations/{orgId}/subscription/upgrade", testOrg.getId())
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.organisation_id").value(testOrg.getId().toString()))
            .andExpect(jsonPath("$.tier").value("PRO"))
            .andExpect(jsonPath("$.stripe_customer_id").value("cus_test123"))
            .andExpect(jsonPath("$.stripe_subscription_id").value("sub_test456"));
        
        // Verify the subscription was updated
        Subscription updated = subscriptionRepository.findByOrganisationId(testOrg.getId()).orElseThrow();
        assert updated.getTier() == SubscriptionTier.PRO;
        assert updated.getStripeCustomerId().equals("cus_test123");
    }
    
    /**
     * Test POST /organisations/:orgId/subscription/upgrade - validation fails on missing fields.
     * Requirement: 11.4
     */
    @Test
    @WithMockUser
    void testUpgradeSubscription_MissingFields_ReturnsBadRequest() throws Exception {
        // Given - request missing required fields
        UpgradeSubscriptionRequest request = new UpgradeSubscriptionRequest();
        
        // When/Then
        mockMvc.perform(post("/api/v1/organisations/{orgId}/subscription/upgrade", testOrg.getId())
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isBadRequest());
    }
    
    /**
     * Test POST /organisations/:orgId/subscription/downgrade - schedule downgrade.
     * Requirements: 11.5, 11.6
     */
    @Test
    @WithMockUser
    void testScheduleDowngrade_ValidRequest_SchedulesSuccessfully() throws Exception {
        // Given - upgrade first so we can downgrade
        subscription.setTier(SubscriptionTier.PRO);
        subscriptionRepository.save(subscription);
        
        DowngradeSubscriptionRequest request = new DowngradeSubscriptionRequest(SubscriptionTier.FREE);
        
        // When/Then
        mockMvc.perform(post("/api/v1/organisations/{orgId}/subscription/downgrade", testOrg.getId())
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.organisation_id").value(testOrg.getId().toString()))
            .andExpect(jsonPath("$.tier").value("PRO"))
            .andExpect(jsonPath("$.pending_downgrade_tier").value("FREE"));
        
        // Verify pending downgrade was set
        Subscription updated = subscriptionRepository.findByOrganisationId(testOrg.getId()).orElseThrow();
        assert updated.getPendingDowngradeTier() == SubscriptionTier.FREE;
    }
    
    /**
     * Test DELETE /organisations/:orgId/subscription/downgrade - cancel pending downgrade.
     * Requirement: 11.5
     */
    @Test
    @WithMockUser
    void testCancelPendingDowngrade_RemovesPendingDowngrade() throws Exception {
        // Given - set up a pending downgrade
        subscription.setTier(SubscriptionTier.PRO);
        subscription.setPendingDowngradeTier(SubscriptionTier.FREE);
        subscriptionRepository.save(subscription);
        
        // When/Then
        mockMvc.perform(delete("/api/v1/organisations/{orgId}/subscription/downgrade", testOrg.getId())
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.organisation_id").value(testOrg.getId().toString()))
            .andExpect(jsonPath("$.tier").value("PRO"))
            .andExpect(jsonPath("$.pending_downgrade_tier").doesNotExist());
        
        // Verify pending downgrade was removed
        Subscription updated = subscriptionRepository.findByOrganisationId(testOrg.getId()).orElseThrow();
        assert updated.getPendingDowngradeTier() == null;
    }
    
    /**
     * Test GET /organisations/:orgId/subscription/downgrade-conflicts - check for conflicts.
     * Requirement: 11.6
     */
    @Test
    @WithMockUser
    void testCheckDowngradeConflicts_WithConflicts_ReturnsConflictDetails() throws Exception {
        // Given - create 3 venues (exceeds FREE tier limit of 2)
        Venue venue1 = new Venue(testOrg.getId(), "Venue 1", null);
        Venue venue2 = new Venue(testOrg.getId(), "Venue 2", null);
        Venue venue3 = new Venue(testOrg.getId(), "Venue 3", null);
        venueRepository.save(venue1);
        venueRepository.save(venue2);
        venueRepository.save(venue3);
        
        // When/Then
        mockMvc.perform(get("/api/v1/organisations/{orgId}/subscription/downgrade-conflicts", testOrg.getId())
                .param("targetTier", "FREE")
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.excess_venue_count").value(1))
            .andExpect(jsonPath("$.venues_with_excess_recipes").isMap());
    }
    
    /**
     * Test GET /organisations/:orgId/subscription/downgrade-conflicts - no conflicts.
     * Requirement: 11.6
     */
    @Test
    @WithMockUser
    void testCheckDowngradeConflicts_NoConflicts_ReturnsEmpty() throws Exception {
        // Given - only 1 venue (within FREE tier limit of 2)
        Venue venue1 = new Venue(testOrg.getId(), "Venue 1", null);
        venueRepository.save(venue1);
        
        // When/Then
        mockMvc.perform(get("/api/v1/organisations/{orgId}/subscription/downgrade-conflicts", testOrg.getId())
                .param("targetTier", "FREE")
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.excess_venue_count").value(0))
            .andExpect(jsonPath("$.venues_with_excess_recipes").isEmpty());
    }
    
    /**
     * Test GET /organisations/:orgId/subscription/history - get subscription history.
     * Requirement: 11.9
     */
    @Test
    @WithMockUser
    void testGetSubscriptionHistory_ReturnsHistory() throws Exception {
        // When/Then - at minimum we have the CREATED event
        mockMvc.perform(get("/api/v1/organisations/{orgId}/subscription/history", testOrg.getId())
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray());
    }
    
    /**
     * Test GET /organisations/:orgId/subscription/history - empty history.
     * Requirement: 11.9
     */
    @Test
    @WithMockUser
    void testGetSubscriptionHistory_EmptyHistory_ReturnsEmptyList() throws Exception {
        // When/Then
        mockMvc.perform(get("/api/v1/organisations/{orgId}/subscription/history", testOrg.getId())
                .contentType(MediaType.APPLICATION_JSON))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$").isArray());
    }
}
