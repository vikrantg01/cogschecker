package com.cogschecker.foodcost.api.dto;

import java.util.Map;
import java.util.UUID;

/**
 * Response DTO for downgrade conflict information.
 * Requirement 11.6
 */
public class DowngradeConflictResponse {
    
    private int excessVenueCount;
    private Map<UUID, Integer> venuesWithExcessRecipes;
    
    public DowngradeConflictResponse() {
    }
    
    public DowngradeConflictResponse(int excessVenueCount, Map<UUID, Integer> venuesWithExcessRecipes) {
        this.excessVenueCount = excessVenueCount;
        this.venuesWithExcessRecipes = venuesWithExcessRecipes;
    }
    
    public int getExcessVenueCount() {
        return excessVenueCount;
    }
    
    public void setExcessVenueCount(int excessVenueCount) {
        this.excessVenueCount = excessVenueCount;
    }
    
    public Map<UUID, Integer> getVenuesWithExcessRecipes() {
        return venuesWithExcessRecipes;
    }
    
    public void setVenuesWithExcessRecipes(Map<UUID, Integer> venuesWithExcessRecipes) {
        this.venuesWithExcessRecipes = venuesWithExcessRecipes;
    }
}
