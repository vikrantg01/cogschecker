package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

/**
 * Request DTO for updating an unmatched Square item (map to recipe or dismiss).
 * Requirements: 12.4 (Square sync - manual mapping or dismissal)
 */
public record UpdateUnmatchedItemRequest(
        @NotNull(message = "Status is required")
        String status, // "mapped" or "dismissed"
        
        UUID mappedRecipeId // required if status is "mapped"
) {
}
