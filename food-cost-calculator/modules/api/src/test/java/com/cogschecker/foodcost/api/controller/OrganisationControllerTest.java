package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Organisation;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.Subscription;
import com.cogschecker.foodcost.api.domain.SubscriptionTier;
import com.cogschecker.foodcost.api.domain.Venue;
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

import java.math.BigDecimal;
import java.util.UUID;

import static org.hamcrest.Matchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration tests for OrganisationController venue CRUD and cross-venue summary endpoints.
 * Requirements: 10.1, 10.2, 10.4, 10.5, 10.8, 10.9
 */
@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)  // Disable security filters for testing
@ActiveProfiles("test")
@Transactional
class OrganisationControllerTest {

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

    @Autowired
    private SystemConfigRepository systemConfigRepository;

    private Organisation testOrg;
    private Subscription testSubscription;
    private Venue venue1;
    private Venue venue2;

    @BeforeEach
    void setUp() {
        // Create test organisation
        testOrg = new Organisation("Test Organisation");
        testOrg = organisationRepository.save(testOrg);

        // Create subscription
        testSubscription = new Subscription(testOrg.getId(), SubscriptionTier.PRO);
        testSubscription = subscriptionRepository.save(testSubscription);

        // Create test venues
        venue1 = new Venue(testOrg.getId(), "Venue One", "123 Main St");
        venue1 = venueRepository.save(venue1);

        venue2 = new Venue(testOrg.getId(), "Venue Two", "456 Oak Ave");
        venue2 = venueRepository.save(venue2);
    }

    // ===== Organisation Endpoints =====

    @Test
    void testGetOrganisation() throws Exception {
        mockMvc.perform(get("/api/v1/organisations/{orgId}", testOrg.getId())
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(testOrg.getId().toString()))
                .andExpect(jsonPath("$.name").value("Test Organisation"))
                .andExpect(jsonPath("$.tier").value("pro"));
    }

    // ===== Venue CRUD Endpoints =====

    @Test
    void testListVenues() throws Exception {
        mockMvc.perform(get("/api/v1/organisations/{orgId}/venues", testOrg.getId())
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$", hasSize(2)))
                .andExpect(jsonPath("$[0].name").value("Venue One"))
                .andExpect(jsonPath("$[1].name").value("Venue Two"));
    }

    @Test
    void testCreateVenue() throws Exception {
        CreateVenueRequest request = new CreateVenueRequest("New Venue", "789 Elm St");

        mockMvc.perform(post("/api/v1/organisations/{orgId}/venues", testOrg.getId())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("New Venue"))
                .andExpect(jsonPath("$.address").value("789 Elm St"))
                .andExpect(jsonPath("$.organisationId").value(testOrg.getId().toString()));
    }

    @Test
    void testCreateVenue_DuplicateName() throws Exception {
        CreateVenueRequest request = new CreateVenueRequest("Venue One", "789 Elm St");

        mockMvc.perform(post("/api/v1/organisations/{orgId}/venues", testOrg.getId())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isConflict());
    }

    @Test
    void testGetVenue() throws Exception {
        mockMvc.perform(get("/api/v1/organisations/{orgId}/venues/{venueId}",
                        testOrg.getId(), venue1.getId())
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(venue1.getId().toString()))
                .andExpect(jsonPath("$.name").value("Venue One"))
                .andExpect(jsonPath("$.address").value("123 Main St"));
    }

    @Test
    void testUpdateVenue_Name() throws Exception {
        UpdateVenueRequest request = new UpdateVenueRequest("Updated Venue Name", null);

        mockMvc.perform(patch("/api/v1/organisations/{orgId}/venues/{venueId}",
                        testOrg.getId(), venue1.getId())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Updated Venue Name"))
                .andExpect(jsonPath("$.address").value("123 Main St"));
    }

    @Test
    void testUpdateVenue_Address() throws Exception {
        UpdateVenueRequest request = new UpdateVenueRequest(null, "Updated Address");

        mockMvc.perform(patch("/api/v1/organisations/{orgId}/venues/{venueId}",
                        testOrg.getId(), venue1.getId())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Venue One"))
                .andExpect(jsonPath("$.address").value("Updated Address"));
    }

    @Test
    void testDeleteVenue() throws Exception {
        DeleteVenueRequest request = new DeleteVenueRequest(true);

        mockMvc.perform(delete("/api/v1/organisations/{orgId}/venues/{venueId}",
                        testOrg.getId(), venue1.getId())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value(containsString("deleted successfully")));
    }

    @Test
    void testDeleteVenue_WithoutConfirmation() throws Exception {
        DeleteVenueRequest request = new DeleteVenueRequest(false);

        mockMvc.perform(delete("/api/v1/organisations/{orgId}/venues/{venueId}",
                        testOrg.getId(), venue1.getId())
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    // ===== Cross-Venue Summary Report =====

    @Test
    void testGetCrossVenueSummary_EmptyVenues() throws Exception {
        mockMvc.perform(get("/api/v1/organisations/{orgId}/reports/cross-venue", testOrg.getId())
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.venues", hasSize(2)))
                .andExpect(jsonPath("$.venues[0].venueName").value("Venue One"))
                .andExpect(jsonPath("$.venues[0].totalRecipeCount").value(0))
                .andExpect(jsonPath("$.venues[0].averageFoodCostPercentage").doesNotExist())
                .andExpect(jsonPath("$.venues[0].recipesExceedingThreshold").value(0));
    }

    @Test
    void testGetCrossVenueSummary_WithRecipes() throws Exception {
        // Create recipes for venue1
        Recipe recipe1 = new Recipe();
        recipe1.setVenueId(venue1.getId());
        recipe1.setName("Recipe 1");
        recipe1.setPortionCount(4);
        recipe1.setMenuSellingPrice(new BigDecimal("20.00"));
        recipe1.setFoodCostPerPortion(new BigDecimal("5.00"));
        recipe1.setFoodCostPercentage(new BigDecimal("25.0"));
        recipeRepository.save(recipe1);

        Recipe recipe2 = new Recipe();
        recipe2.setVenueId(venue1.getId());
        recipe2.setName("Recipe 2");
        recipe2.setPortionCount(2);
        recipe2.setMenuSellingPrice(new BigDecimal("30.00"));
        recipe2.setFoodCostPerPortion(new BigDecimal("12.00"));
        recipe2.setFoodCostPercentage(new BigDecimal("40.0"));
        recipeRepository.save(recipe2);

        // Create recipes for venue2
        Recipe recipe3 = new Recipe();
        recipe3.setVenueId(venue2.getId());
        recipe3.setName("Recipe 3");
        recipe3.setPortionCount(1);
        recipe3.setMenuSellingPrice(new BigDecimal("15.00"));
        recipe3.setFoodCostPerPortion(new BigDecimal("6.00"));
        recipe3.setFoodCostPercentage(new BigDecimal("40.0"));
        recipeRepository.save(recipe3);

        mockMvc.perform(get("/api/v1/organisations/{orgId}/reports/cross-venue", testOrg.getId())
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.venues", hasSize(2)))
                .andExpect(jsonPath("$.venues[0].venueName").value("Venue One"))
                .andExpect(jsonPath("$.venues[0].totalRecipeCount").value(2))
                .andExpect(jsonPath("$.venues[0].averageFoodCostPercentage").value(32.5)) // (25 + 40) / 2
                .andExpect(jsonPath("$.venues[0].recipesExceedingThreshold").value(1)) // threshold default is 30
                .andExpect(jsonPath("$.venues[1].venueName").value("Venue Two"))
                .andExpect(jsonPath("$.venues[1].totalRecipeCount").value(1))
                .andExpect(jsonPath("$.venues[1].averageFoodCostPercentage").value(40.0))
                .andExpect(jsonPath("$.venues[1].recipesExceedingThreshold").value(1));
    }

    @Test
    void testGetCrossVenueSummary_OnlyCountsRecipesWithPrice() throws Exception {
        // Recipe with price
        Recipe recipe1 = new Recipe();
        recipe1.setVenueId(venue1.getId());
        recipe1.setName("Recipe 1");
        recipe1.setPortionCount(4);
        recipe1.setMenuSellingPrice(new BigDecimal("20.00"));
        recipe1.setFoodCostPerPortion(new BigDecimal("5.00"));
        recipe1.setFoodCostPercentage(new BigDecimal("25.0"));
        recipeRepository.save(recipe1);

        // Recipe without price (should not be counted in average or threshold)
        Recipe recipe2 = new Recipe();
        recipe2.setVenueId(venue1.getId());
        recipe2.setName("Recipe 2");
        recipe2.setPortionCount(2);
        recipe2.setFoodCostPerPortion(new BigDecimal("12.00"));
        recipeRepository.save(recipe2);

        mockMvc.perform(get("/api/v1/organisations/{orgId}/reports/cross-venue", testOrg.getId())
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.venues[0].totalRecipeCount").value(2)) // Total includes both
                .andExpect(jsonPath("$.venues[0].averageFoodCostPercentage").value(25.0)) // Only recipe1
                .andExpect(jsonPath("$.venues[0].recipesExceedingThreshold").value(0)); // recipe1 is 25%, below 30%
    }
}
