package com.cogschecker.foodcost.api.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Response DTO for Square unmatched items.
 * Requirements: 12.4 (Square sync - unmatched item display)
 */
public record SquareUnmatchedItemResponse(
        UUID id,
        UUID venueId,
        String squareItemName,
        BigDecimal squareItemPrice,
        String status,
        UUID mappedRecipeId
) {
}
