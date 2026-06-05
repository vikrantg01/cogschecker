package com.cogschecker.foodcost.api.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

/**
 * Response DTO for cross-venue summary report.
 * Requirements: 10.4, 10.5
 */
public class CrossVenueSummaryResponse {
    
    private List<VenueSummary> venues;
    
    public CrossVenueSummaryResponse() {
    }
    
    public CrossVenueSummaryResponse(List<VenueSummary> venues) {
        this.venues = venues;
    }
    
    public List<VenueSummary> getVenues() {
        return venues;
    }
    
    public void setVenues(List<VenueSummary> venues) {
        this.venues = venues;
    }
    
    /**
     * Summary data for a single venue.
     */
    public static class VenueSummary {
        private UUID venueId;
        private String venueName;
        private long totalRecipeCount;
        private BigDecimal averageFoodCostPercentage;
        private long recipesExceedingThreshold;
        
        public VenueSummary() {
        }
        
        public VenueSummary(UUID venueId, String venueName, long totalRecipeCount, 
                           BigDecimal averageFoodCostPercentage, long recipesExceedingThreshold) {
            this.venueId = venueId;
            this.venueName = venueName;
            this.totalRecipeCount = totalRecipeCount;
            this.averageFoodCostPercentage = averageFoodCostPercentage;
            this.recipesExceedingThreshold = recipesExceedingThreshold;
        }
        
        public UUID getVenueId() {
            return venueId;
        }
        
        public void setVenueId(UUID venueId) {
            this.venueId = venueId;
        }
        
        public String getVenueName() {
            return venueName;
        }
        
        public void setVenueName(String venueName) {
            this.venueName = venueName;
        }
        
        public long getTotalRecipeCount() {
            return totalRecipeCount;
        }
        
        public void setTotalRecipeCount(long totalRecipeCount) {
            this.totalRecipeCount = totalRecipeCount;
        }
        
        public BigDecimal getAverageFoodCostPercentage() {
            return averageFoodCostPercentage;
        }
        
        public void setAverageFoodCostPercentage(BigDecimal averageFoodCostPercentage) {
            this.averageFoodCostPercentage = averageFoodCostPercentage;
        }
        
        public long getRecipesExceedingThreshold() {
            return recipesExceedingThreshold;
        }
        
        public void setRecipesExceedingThreshold(long recipesExceedingThreshold) {
            this.recipesExceedingThreshold = recipesExceedingThreshold;
        }
    }
}
