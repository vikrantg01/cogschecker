package com.cogschecker.foodcost.api.security;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.dto.request.CreateIngredientRequest;
import com.cogschecker.foodcost.api.dto.request.CreateRecipeRequest;
import com.cogschecker.foodcost.api.dto.request.UpdateIngredientRequest;
import com.cogschecker.foodcost.api.repository.*;
import com.cogschecker.foodcost.shared.model.UomEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Integration test for complete RBAC filter chain with Admin, Manager, Staff tokens
 * against all restricted endpoints, verifying venue scope isolation.
 * 
 * Filter chain order:
 * 1. CognitoJwtFilter - JWT validation and SecurityContext population
 * 2. VenueScopeFilter - Verify venueId belongs to user's organisation
 * 3. RbacAuthorizationManager - @PreAuthorize role checks (hasVenueRole, hasOrganisationRole)
 * 4. SubscriptionGateFilter - @RequiresTier subscription checks
 * 
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.9, 10.3
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class RbacFilterChainIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JwtDecoder jwtDecoder;

    @Autowired
    private OrganisationRepository organisationRepository;

    @Autowired
    private VenueRepository venueRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private UserVenueRoleRepository userVenueRoleRepository;

    @Autowired
    private IngredientRepository ingredientRepository;

    @Autowired
    private RecipeRepository recipeRepository;

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    private UUID orgId;
    private UUID venueAId;
    private UUID venueBId;
    private UUID adminUserId;
    private UUID managerUserId;
    private UUID staffUserId;
    private UUID ingredientId;
    private UUID recipeId;

    @BeforeEach
    void setUp() {
        // Create organisation
        Organisation org = new Organisation();
        org.setName("Test Organisation");
        org = organisationRepository.save(org);
        orgId = org.getId();

        // Create subscription (Pro tier for most tests)
        Subscription subscription = new Subscription();
        subscription.setOrganisation(org);
        subscription.setTier(SubscriptionTier.PRO);
        subscriptionRepository.save(subscription);

        // Create two venues (A and B)
        Venue venueA = new Venue();
        venueA.setName("Venue A");
        venueA.setOrganisation(org);
        venueA = venueRepository.save(venueA);
        venueAId = venueA.getId();

        Venue venueB = new Venue();
        venueB.setName("Venue B");
        venueB.setOrganisation(org);
        venueB = venueRepository.save(venueB);
        venueBId = venueB.getId();

        // Create users
        User adminUser = new User();
        adminUser.setEmail("admin@test.com");
        adminUser.setDisplayName("Admin User");
        adminUser = userRepository.save(adminUser);
        adminUserId = adminUser.getId();

        User managerUser = new User();
        managerUser.setEmail("manager@test.com");
        managerUser.setDisplayName("Manager User");
        managerUser = userRepository.save(managerUser);
        managerUserId = managerUser.getId();

        User staffUser = new User();
        staffUser.setEmail("staff@test.com");
        staffUser.setDisplayName("Staff User");
        staffUser = userRepository.save(staffUser);
        staffUserId = staffUser.getId();

        // Assign roles: Admin to both venues, Manager to Venue A only, Staff to Venue A only
        UserVenueRole adminRoleA = new UserVenueRole();
        adminRoleA.setUser(adminUser);
        adminRoleA.setVenue(venueA);
        adminRoleA.setRole(VenueRole.ADMIN);
        userVenueRoleRepository.save(adminRoleA);

        UserVenueRole adminRoleB = new UserVenueRole();
        adminRoleB.setUser(adminUser);
        adminRoleB.setVenue(venueB);
        adminRoleB.setRole(VenueRole.ADMIN);
        userVenueRoleRepository.save(adminRoleB);

        UserVenueRole managerRoleA = new UserVenueRole();
        managerRoleA.setUser(managerUser);
        managerRoleA.setVenue(venueA);
        managerRoleA.setRole(VenueRole.MANAGER);
        userVenueRoleRepository.save(managerRoleA);

        UserVenueRole staffRoleA = new UserVenueRole();
        staffRoleA.setUser(staffUser);
        staffRoleA.setVenue(venueA);
        staffRoleA.setRole(VenueRole.STAFF);
        userVenueRoleRepository.save(staffRoleA);

        // Create test ingredient in Venue A
        Ingredient ingredient = new Ingredient();
        ingredient.setVenue(venueA);
        ingredient.setName("Test Flour");
        ingredient.setPurchasePrice(new BigDecimal("10.00"));
        ingredient.setPurchaseQuantity(new BigDecimal("1.0"));
        ingredient.setUnitOfMeasure(UomEnum.KG);
        ingredient.setYieldPercentage(new BigDecimal("100.0"));
        ingredient = ingredientRepository.save(ingredient);
        ingredientId = ingredient.getId();

        // Create test recipe in Venue A
        Recipe recipe = new Recipe();
        recipe.setVenue(venueA);
        recipe.setName("Test Bread");
        recipe.setPortionCount(4);
        recipe = recipeRepository.save(recipe);
        recipeId = recipe.getId();
    }

    // ==================== ADMIN ROLE TESTS ====================

    @Test
    @Order(1)
    @DisplayName("Admin can read ingredients from assigned venue")
    void adminCanReadIngredientsFromAssignedVenue() throws Exception {
        Jwt jwt = createJwt(adminUserId, "admin@test.com", orgId, Map.of(
                venueAId.toString(), "admin",
                venueBId.toString(), "admin"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueAId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());
    }

    @Test
    @Order(2)
    @DisplayName("Admin can create ingredient in assigned venue")
    void adminCanCreateIngredientInAssignedVenue() throws Exception {
        Jwt jwt = createJwt(adminUserId, "admin@test.com", orgId, Map.of(
                venueAId.toString(), "admin",
                venueBId.toString(), "admin"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        CreateIngredientRequest request = new CreateIngredientRequest();
        request.setName("Admin Created Ingredient");
        request.setPurchasePrice(new BigDecimal("5.00"));
        request.setPurchaseQuantity(new BigDecimal("1.0"));
        request.setUnitOfMeasure(UomEnum.KG);
        request.setYieldPercentage(new BigDecimal("100.0"));

        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venueAId)
                        .header("Authorization", "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Admin Created Ingredient"));
    }

    @Test
    @Order(3)
    @DisplayName("Admin can update ingredient in assigned venue")
    void adminCanUpdateIngredientInAssignedVenue() throws Exception {
        Jwt jwt = createJwt(adminUserId, "admin@test.com", orgId, Map.of(
                venueAId.toString(), "admin",
                venueBId.toString(), "admin"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        UpdateIngredientRequest request = new UpdateIngredientRequest();
        request.setName("Updated Flour");
        request.setPurchasePrice(new BigDecimal("12.00"));

        mockMvc.perform(patch("/api/v1/venues/{venueId}/ingredients/{id}", venueAId, ingredientId)
                        .header("Authorization", "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.name").value("Updated Flour"));
    }

    @Test
    @Order(4)
    @DisplayName("Admin can delete ingredient in assigned venue")
    void adminCanDeleteIngredientInAssignedVenue() throws Exception {
        Jwt jwt = createJwt(adminUserId, "admin@test.com", orgId, Map.of(
                venueAId.toString(), "admin",
                venueBId.toString(), "admin"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        // Create a new ingredient to delete
        Ingredient toDelete = new Ingredient();
        toDelete.setVenue(venueRepository.findById(venueAId).orElseThrow());
        toDelete.setName("To Delete");
        toDelete.setPurchasePrice(new BigDecimal("1.00"));
        toDelete.setPurchaseQuantity(new BigDecimal("1.0"));
        toDelete.setUnitOfMeasure(UomEnum.KG);
        toDelete.setYieldPercentage(new BigDecimal("100.0"));
        toDelete = ingredientRepository.save(toDelete);

        mockMvc.perform(delete("/api/v1/venues/{venueId}/ingredients/{id}", venueAId, toDelete.getId())
                        .header("Authorization", "Bearer test-token")
                        .param("confirm", "true"))
                .andExpect(status().isNoContent());
    }

    @Test
    @Order(5)
    @DisplayName("Admin can read recipes from assigned venue")
    void adminCanReadRecipesFromAssignedVenue() throws Exception {
        Jwt jwt = createJwt(adminUserId, "admin@test.com", orgId, Map.of(
                venueAId.toString(), "admin",
                venueBId.toString(), "admin"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venueAId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());
    }

    @Test
    @Order(6)
    @DisplayName("Admin can create recipe in assigned venue")
    void adminCanCreateRecipeInAssignedVenue() throws Exception {
        Jwt jwt = createJwt(adminUserId, "admin@test.com", orgId, Map.of(
                venueAId.toString(), "admin",
                venueBId.toString(), "admin"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        CreateRecipeRequest request = new CreateRecipeRequest();
        request.setName("Admin Created Recipe");
        request.setPortionCount(2);
        request.setIngredientLines(Collections.emptyList());

        mockMvc.perform(post("/api/v1/venues/{venueId}/recipes", venueAId)
                        .header("Authorization", "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Admin Created Recipe"));
    }

    // ==================== MANAGER ROLE TESTS ====================

    @Test
    @Order(10)
    @DisplayName("Manager can read ingredients from assigned venue")
    void managerCanReadIngredientsFromAssignedVenue() throws Exception {
        Jwt jwt = createJwt(managerUserId, "manager@test.com", orgId, Map.of(
                venueAId.toString(), "manager"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueAId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());
    }

    @Test
    @Order(11)
    @DisplayName("Manager can create ingredient in assigned venue")
    void managerCanCreateIngredientInAssignedVenue() throws Exception {
        Jwt jwt = createJwt(managerUserId, "manager@test.com", orgId, Map.of(
                venueAId.toString(), "manager"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        CreateIngredientRequest request = new CreateIngredientRequest();
        request.setName("Manager Created Ingredient");
        request.setPurchasePrice(new BigDecimal("3.00"));
        request.setPurchaseQuantity(new BigDecimal("1.0"));
        request.setUnitOfMeasure(UomEnum.KG);
        request.setYieldPercentage(new BigDecimal("100.0"));

        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venueAId)
                        .header("Authorization", "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.name").value("Manager Created Ingredient"));
    }

    @Test
    @Order(12)
    @DisplayName("Manager can update ingredient in assigned venue")
    void managerCanUpdateIngredientInAssignedVenue() throws Exception {
        Jwt jwt = createJwt(managerUserId, "manager@test.com", orgId, Map.of(
                venueAId.toString(), "manager"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        UpdateIngredientRequest request = new UpdateIngredientRequest();
        request.setName("Manager Updated Flour");

        mockMvc.perform(patch("/api/v1/venues/{venueId}/ingredients/{id}", venueAId, ingredientId)
                        .header("Authorization", "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk());
    }

    @Test
    @Order(13)
    @DisplayName("Manager can read recipes from assigned venue")
    void managerCanReadRecipesFromAssignedVenue() throws Exception {
        Jwt jwt = createJwt(managerUserId, "manager@test.com", orgId, Map.of(
                venueAId.toString(), "manager"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venueAId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());
    }

    @Test
    @Order(14)
    @DisplayName("Manager can view costing report from assigned venue")
    void managerCanViewCostingReportFromAssignedVenue() throws Exception {
        Jwt jwt = createJwt(managerUserId, "manager@test.com", orgId, Map.of(
                venueAId.toString(), "manager"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing", venueAId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk());
    }

    @Test
    @Order(15)
    @DisplayName("Manager can export costing report from assigned venue")
    void managerCanExportCostingReportFromAssignedVenue() throws Exception {
        Jwt jwt = createJwt(managerUserId, "manager@test.com", orgId, Map.of(
                venueAId.toString(), "manager"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing/export", venueAId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk())
                .andExpect(header().exists("Content-Disposition"));
    }

    @Test
    @Order(16)
    @DisplayName("Manager CANNOT access venue they are not assigned to")
    void managerCannotAccessUnassignedVenue() throws Exception {
        Jwt jwt = createJwt(managerUserId, "manager@test.com", orgId, Map.of(
                venueAId.toString(), "manager"
                // Note: No access to venueB
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        // Should be blocked by VenueScopeFilter (403 Forbidden)
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueBId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("Forbidden"));
    }

    // ==================== STAFF ROLE TESTS ====================

    @Test
    @Order(20)
    @DisplayName("Staff can read ingredients from assigned venue")
    void staffCanReadIngredientsFromAssignedVenue() throws Exception {
        Jwt jwt = createJwt(staffUserId, "staff@test.com", orgId, Map.of(
                venueAId.toString(), "staff"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venueAId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray());
    }

    @Test
    @Order(21)
    @DisplayName("Staff can read specific ingredient from assigned venue")
    void staffCanReadSpecificIngredientFromAssignedVenue() throws Exception {
        Jwt jwt = createJwt(staffUserId, "staff@test.com", orgId, Map.of(
                venueAId.toString(), "staff"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients/{id}", venueAId, ingredientId)
                        .header("Authorization", "Bearer test-token"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").exists());
    }

    @Test
    @Order(22)
    @DisplayName("Staff CANNOT create ingredient (blocked by RBAC)")
    void staffCannotCreateIngredient() throws Exception {
        Jwt jwt = createJwt(staffUserId, "staff@test.com", orgId, Map.of(
                venueAId.toString(), "staff"
        ), "pro");
        when(jwtDecoder.decode(any(String.class))).thenReturn(jwt);

        CreateIngredientRequest request = new CreateIngredientRequest();
        request.setName("Staff Attempt");
        request.setPurchasePrice(new BigDecimal("1.00"));
        request.setPurchaseQuantity(new BigDecimal("1.0"));
        request.setUnitOfMeasure(UomEnum.KG);
        request.setYieldPercentage(new BigDecimal("100.0"));

        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venueAId)
                        .header("Authorization", "Bearer test-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());
    }
