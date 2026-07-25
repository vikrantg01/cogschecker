package com.cogschecker.foodcost.api.integration;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.dto.*;
import com.cogschecker.foodcost.api.repository.*;
import com.cogschecker.foodcost.shared.UomEnum;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Comprehensive integration tests for RBAC filter chain.
 * Tests Admin, Manager, and Staff tokens against all restricted endpoints and verifies strict venue scope isolation.
 * Requirements: 9.1, 9.2, 9.3, 9.4, 10.3
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class RbacFilterChainIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @MockBean private JwtDecoder jwtDecoder;
    @Autowired private OrganisationRepository organisationRepository;
    @Autowired private VenueRepository venueRepository;
    @Autowired private IngredientRepository ingredientRepository;
    @Autowired private RecipeRepository recipeRepository;

    private Organisation org1, org2;
    private Venue venue1Org1, venue2Org1, venue1Org2;
    private Ingredient testIngredient;
    private Recipe testRecipe;
    private String adminTokenVenue1, managerTokenVenue1, staffTokenVenue1, managerTokenVenue2, unauthorizedTokenOrg2;

    @BeforeEach
    void setUp() {
        setupTestData();
        setupJwtTokens();
    }

    @Transactional
    void setupTestData() {
        recipeRepository.deleteAll();
        ingredientRepository.deleteAll();
        venueRepository.deleteAll();
        organisationRepository.deleteAll();
        
        org1 = organisationRepository.save(createOrganisation("Test Org 1"));
        org2 = organisationRepository.save(createOrganisation("Test Org 2"));
        venue1Org1 = venueRepository.save(createVenue("Venue 1 Org 1", org1));
        venue2Org1 = venueRepository.save(createVenue("Venue 2 Org 1", org1));
        venue1Org2 = venueRepository.save(createVenue("Venue 1 Org 2", org2));
        testIngredient = ingredientRepository.save(createIngredient("Test Ingredient", venue1Org1));
        testRecipe = recipeRepository.save(createRecipe("Test Recipe", venue1Org1));
    }

    private Organisation createOrganisation(String name) {
        Organisation org = new Organisation();
        org.setId(UUID.randomUUID());
        org.setName(name);
        return org;
    }

    private Venue createVenue(String name, Organisation org) {
        Venue venue = new Venue();
        venue.setId(UUID.randomUUID());
        venue.setName(name);
        venue.setOrganisation(org);
        return venue;
    }

    private Ingredient createIngredient(String name, Venue venue) {
        Ingredient ing = new Ingredient();
        ing.setId(UUID.randomUUID());
        ing.setName(name);
        ing.setVenue(venue);
        ing.setPurchasePrice(new BigDecimal("10.00"));
        ing.setPurchaseQuantity(new BigDecimal("1.0"));
        ing.setUnitOfMeasure(UomEnum.KG);
        ing.setYieldPercentage(new BigDecimal("100.00"));
        ing.setCostPerUnit(new BigDecimal("10.0000"));
        ing.setEffectiveCostPerUsableUnit(new BigDecimal("10.0000"));
        return ing;
    }

    private Recipe createRecipe(String name, Venue venue) {
        Recipe recipe = new Recipe();
        recipe.setId(UUID.randomUUID());
        recipe.setName(name);
        recipe.setVenue(venue);
        recipe.setPortionCount(4);
        return recipe;
    }

    void setupJwtTokens() {
        adminTokenVenue1 = createJwtToken("admin-user", "admin@org1.com", org1.getId().toString(),
            Map.of(venue1Org1.getId().toString(), "admin", venue2Org1.getId().toString(), "admin"), "pro");
        managerTokenVenue1 = createJwtToken("manager-user", "manager@org1.com", org1.getId().toString(),
            Map.of(venue1Org1.getId().toString(), "manager"), "pro");
        staffTokenVenue1 = createJwtToken("staff-user", "staff@org1.com", org1.getId().toString(),
            Map.of(venue1Org1.getId().toString(), "staff"), "pro");
        managerTokenVenue2 = createJwtToken("manager2-user", "manager2@org1.com", org1.getId().toString(),
            Map.of(venue2Org1.getId().toString(), "manager"), "pro");
        unauthorizedTokenOrg2 = createJwtToken("user-org2", "user@org2.com", org2.getId().toString(),
            Map.of(venue1Org2.getId().toString(), "admin"), "pro");
        
        when(jwtDecoder.decode(any(String.class))).thenAnswer(inv -> parseTestJwt(inv.getArgument(0)));
    }

    private String createJwtToken(String userId, String email, String orgId, Map<String, String> venueRoles, String tier) {
        try {
            Map<String, Object> claims = new HashMap<>();
            claims.put("sub", userId);
            claims.put("email", email);
            claims.put("custom:org_id", orgId);
            claims.put("custom:venue_roles", objectMapper.writeValueAsString(venueRoles));
            claims.put("custom:tier", tier);
            return objectMapper.writeValueAsString(claims);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    private Jwt parseTestJwt(String tokenJson) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> claims = objectMapper.readValue(tokenJson, Map.class);
            return new Jwt("test-token", Instant.now(), Instant.now().plusSeconds(3600), Map.of("alg", "RS256"), claims);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    // ========== INGREDIENT TESTS ==========

    @Test @Order(1)
    void testAdminCanViewIngredients() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + adminTokenVenue1))
            .andExpect(status().isOk());
    }

    @Test @Order(2)
    void testManagerCanViewIngredients() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + managerTokenVenue1))
            .andExpect(status().isOk());
    }

    @Test @Order(3)
    void testStaffCanViewIngredients() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1))
            .andExpect(status().isOk());
    }

    @Test @Order(4)
    void testStaffCannotCreateIngredients() throws Exception {
        IngredientRequest request = new IngredientRequest();
        request.setName("Staff Attempt");
        request.setPurchasePrice(new BigDecimal("3.00"));
        request.setPurchaseQuantity(new BigDecimal("1.0"));
        request.setUnitOfMeasure(UomEnum.G.name());
        request.setYieldPercentage(new BigDecimal("100.00"));

        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isForbidden());
    }

    @Test @Order(5)
    void testManagerCanCreateIngredients() throws Exception {
        IngredientRequest request = new IngredientRequest();
        request.setName("Manager Created");
        request.setPurchasePrice(new BigDecimal("7.50"));
        request.setPurchaseQuantity(new BigDecimal("2.0"));
        request.setUnitOfMeasure(UomEnum.L.name());
        request.setYieldPercentage(new BigDecimal("95.00"));

        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + managerTokenVenue1)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isCreated());
    }

    @Test @Order(6)
    void testStaffCannotUpdateIngredients() throws Exception {
        IngredientRequest request = new IngredientRequest();
        request.setName("Staff Update Attempt");
        request.setPurchasePrice(new BigDecimal("15.00"));
        request.setPurchaseQuantity(new BigDecimal("1.0"));
        request.setUnitOfMeasure(UomEnum.KG.name());
        request.setYieldPercentage(new BigDecimal("100.00"));

        mockMvc.perform(patch("/api/v1/venues/{venueId}/ingredients/{id}", venue1Org1.getId(), testIngredient.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isForbidden());
    }

    @Test @Order(7)
    void testStaffCannotDeleteIngredients() throws Exception {
        mockMvc.perform(delete("/api/v1/venues/{venueId}/ingredients/{id}", venue1Org1.getId(), testIngredient.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1))
            .andExpect(status().isForbidden());
    }

    // ========== RECIPE TESTS ==========

    @Test @Order(8)
    void testAllRolesCanViewRecipes() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venue1Org1.getId())
            .header("Authorization", "Bearer " + adminTokenVenue1)).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venue1Org1.getId())
            .header("Authorization", "Bearer " + managerTokenVenue1)).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/venues/{venueId}/recipes", venue1Org1.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1)).andExpect(status().isOk());
    }

    @Test @Order(9)
    void testStaffCannotCreateRecipes() throws Exception {
        RecipeRequest request = new RecipeRequest();
        request.setName("Staff Recipe");
        request.setPortionCount(4);
        request.setIngredientLines(new ArrayList<>());

        mockMvc.perform(post("/api/v1/venues/{venueId}/recipes", venue1Org1.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isForbidden());
    }

    @Test @Order(10)
    void testStaffCannotUpdateRecipes() throws Exception {
        RecipeRequest request = new RecipeRequest();
        request.setName("Staff Update");
        request.setPortionCount(8);
        request.setIngredientLines(new ArrayList<>());

        mockMvc.perform(patch("/api/v1/venues/{venueId}/recipes/{id}", venue1Org1.getId(), testRecipe.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isForbidden());
    }

    @Test @Order(11)
    void testStaffCannotDeleteRecipes() throws Exception {
        mockMvc.perform(delete("/api/v1/venues/{venueId}/recipes/{id}", venue1Org1.getId(), testRecipe.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1))
            .andExpect(status().isForbidden());
    }

    // ========== EXPORT/IMPORT TESTS ==========

    @Test @Order(12)
    void testStaffCannotExportData() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/export", venue1Org1.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1))
            .andExpect(status().isForbidden());
    }

    @Test @Order(13)
    void testManagerCanExportData() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/export", venue1Org1.getId())
            .header("Authorization", "Bearer " + managerTokenVenue1))
            .andExpect(status().isOk());
    }

    @Test @Order(14)
    void testStaffCannotImportData() throws Exception {
        mockMvc.perform(post("/api/v1/venues/{venueId}/import", venue1Org1.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"version\":1}"))
            .andExpect(status().isForbidden());
    }

    // ========== VENUE ISOLATION TESTS ==========

    @Test @Order(15)
    void testCannotAccessVenueFromDifferentOrganisation() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + unauthorizedTokenOrg2))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.message").value("You do not have access to this venue"));
    }

    @Test @Order(16)
    void testCannotAccessUnassignedVenueInSameOrg() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + managerTokenVenue2))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.message").value("You do not have access to this venue"));
    }

    @Test @Order(17)
    void testCannotCreateIngredientInUnassignedVenue() throws Exception {
        IngredientRequest request = new IngredientRequest();
        request.setName("Unauthorized");
        request.setPurchasePrice(new BigDecimal("5.00"));
        request.setPurchaseQuantity(new BigDecimal("1.0"));
        request.setUnitOfMeasure(UomEnum.KG.name());
        request.setYieldPercentage(new BigDecimal("100.00"));

        mockMvc.perform(post("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + managerTokenVenue2)
            .contentType(MediaType.APPLICATION_JSON)
            .content(objectMapper.writeValueAsString(request)))
            .andExpect(status().isForbidden());
    }

    @Test @Order(18)
    void testAdminCanAccessMultipleVenues() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venue1Org1.getId())
            .header("Authorization", "Bearer " + adminTokenVenue1)).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/venues/{venueId}/ingredients", venue2Org1.getId())
            .header("Authorization", "Bearer " + adminTokenVenue1)).andExpect(status().isOk());
    }

    // ========== REPORT TESTS ==========

    @Test @Order(19)
    void testAllRolesCanViewCostingReport() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing", venue1Org1.getId())
            .header("Authorization", "Bearer " + adminTokenVenue1)).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing", venue1Org1.getId())
            .header("Authorization", "Bearer " + managerTokenVenue1)).andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing", venue1Org1.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1)).andExpect(status().isOk());
    }

    @Test @Order(20)
    void testStaffCannotExportCostingReport() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing/export", venue1Org1.getId())
            .header("Authorization", "Bearer " + staffTokenVenue1))
            .andExpect(status().isForbidden());
    }

    @Test @Order(21)
    void testManagerCanExportCostingReport() throws Exception {
        mockMvc.perform(get("/api/v1/venues/{venueId}/reports/costing/export", venue1Org1.getId())
            .header("Authorization", "Bearer " + managerTokenVenue1))
            .andExpect(status().isOk());
    }
}
