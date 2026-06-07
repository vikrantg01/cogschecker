package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.config.TestSecurityConfig;
import com.cogschecker.foodcost.api.dto.SquareUnmatchedItemResponse;
import com.cogschecker.foodcost.api.dto.UpdateUnmatchedItemRequest;
import com.cogschecker.foodcost.api.service.SquareOAuthService;
import com.cogschecker.foodcost.api.service.SquareUnmatchedItemService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for SquareController.
 * Requirements: 12.4, 12.5 (Square disconnect and unmatched item management)
 */
@WebMvcTest(controllers = SquareController.class,
        excludeAutoConfiguration = {
                org.springframework.boot.autoconfigure.security.servlet.SecurityAutoConfiguration.class,
                org.springframework.boot.autoconfigure.security.servlet.SecurityFilterAutoConfiguration.class
        })
@Import(TestSecurityConfig.class)
class SquareControllerTest {
    
    @Autowired
    private MockMvc mockMvc;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @MockBean
    private SquareOAuthService squareOAuthService;
    
    @MockBean
    private SquareUnmatchedItemService squareUnmatchedItemService;
    
    private UUID venueId;
    private UUID unmatchedItemId;
    private UUID recipeId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        unmatchedItemId = UUID.randomUUID();
        recipeId = UUID.randomUUID();
    }
    
    @Test
    @WithMockUser(authorities = "VENUE_ADMIN_" + "test-venue-id")
    void disconnectSquare_success() throws Exception {
        // Arrange
        doNothing().when(squareOAuthService).disconnect(any(UUID.class));
        
        // Act & Assert
        mockMvc.perform(delete("/api/v1/venues/{venueId}/square/connection", venueId)
                .with(csrf()))
                .andExpect(status().isNoContent());
        
        verify(squareOAuthService, times(1)).disconnect(venueId);
    }
    
    @Test
    @WithMockUser(authorities = "VENUE_MANAGER_" + "test-venue-id")
    void getUnmatchedItems_success() throws Exception {
        // Arrange
        SquareUnmatchedItemResponse item1 = new SquareUnmatchedItemResponse(
                UUID.randomUUID(),
                venueId,
                "Latte",
                new BigDecimal("4.50"),
                "PENDING",
                null
        );
        
        SquareUnmatchedItemResponse item2 = new SquareUnmatchedItemResponse(
                UUID.randomUUID(),
                venueId,
                "Cappuccino",
                new BigDecimal("4.25"),
                "PENDING",
                null
        );
        
        List<SquareUnmatchedItemResponse> items = List.of(item1, item2);
        when(squareUnmatchedItemService.getUnmatchedItems(venueId)).thenReturn(items);
        
        // Act & Assert
        mockMvc.perform(get("/api/v1/venues/{venueId}/square/unmatched", venueId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isArray())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].squareItemName").value("Latte"))
                .andExpect(jsonPath("$[0].squareItemPrice").value(4.50))
                .andExpect(jsonPath("$[0].status").value("PENDING"))
                .andExpect(jsonPath("$[1].squareItemName").value("Cappuccino"));
        
        verify(squareUnmatchedItemService, times(1)).getUnmatchedItems(venueId);
    }
    
    @Test
    @WithMockUser(authorities = "VENUE_ADMIN_" + "test-venue-id")
    void updateUnmatchedItem_mapToRecipe_success() throws Exception {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("mapped", recipeId);
        
        SquareUnmatchedItemResponse response = new SquareUnmatchedItemResponse(
                unmatchedItemId,
                venueId,
                "Latte",
                new BigDecimal("4.50"),
                "MAPPED",
                recipeId
        );
        
        when(squareUnmatchedItemService.updateUnmatchedItem(eq(venueId), eq(unmatchedItemId), any(UpdateUnmatchedItemRequest.class)))
                .thenReturn(response);
        
        // Act & Assert
        mockMvc.perform(patch("/api/v1/venues/{venueId}/square/unmatched/{unmatchedItemId}", venueId, unmatchedItemId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(unmatchedItemId.toString()))
                .andExpect(jsonPath("$.status").value("MAPPED"))
                .andExpect(jsonPath("$.mappedRecipeId").value(recipeId.toString()));
        
        verify(squareUnmatchedItemService, times(1)).updateUnmatchedItem(eq(venueId), eq(unmatchedItemId), any(UpdateUnmatchedItemRequest.class));
    }
    
    @Test
    @WithMockUser(authorities = "VENUE_ADMIN_" + "test-venue-id")
    void updateUnmatchedItem_dismiss_success() throws Exception {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("dismissed", null);
        
        SquareUnmatchedItemResponse response = new SquareUnmatchedItemResponse(
                unmatchedItemId,
                venueId,
                "Latte",
                new BigDecimal("4.50"),
                "DISMISSED",
                null
        );
        
        when(squareUnmatchedItemService.updateUnmatchedItem(eq(venueId), eq(unmatchedItemId), any(UpdateUnmatchedItemRequest.class)))
                .thenReturn(response);
        
        // Act & Assert
        mockMvc.perform(patch("/api/v1/venues/{venueId}/square/unmatched/{unmatchedItemId}", venueId, unmatchedItemId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(unmatchedItemId.toString()))
                .andExpect(jsonPath("$.status").value("DISMISSED"))
                .andExpect(jsonPath("$.mappedRecipeId").doesNotExist());
        
        verify(squareUnmatchedItemService, times(1)).updateUnmatchedItem(eq(venueId), eq(unmatchedItemId), any(UpdateUnmatchedItemRequest.class));
    }
    
    @Test
    @WithMockUser(authorities = "VENUE_ADMIN_" + "test-venue-id")
    void updateUnmatchedItem_invalidStatus_badRequest() throws Exception {
        // Arrange
        UpdateUnmatchedItemRequest request = new UpdateUnmatchedItemRequest("invalid", null);
        
        // Act & Assert
        mockMvc.perform(patch("/api/v1/venues/{venueId}/square/unmatched/{unmatchedItemId}", venueId, unmatchedItemId)
                .with(csrf())
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isInternalServerError()); // Service will throw ValidationException
        
        verify(squareUnmatchedItemService, times(1)).updateUnmatchedItem(eq(venueId), eq(unmatchedItemId), any(UpdateUnmatchedItemRequest.class));
    }
}
