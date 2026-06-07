package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.time.LocalDate;

/**
 * Response DTO for insight data availability check.
 * Indicates whether sufficient sales data exists to generate AI insights.
 * Requirements: 13.1, 13.6
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class InsightDataAvailabilityResponse {
    
    private boolean hasSufficientData;
    private Integer daysOfData;
    private int minimumDaysRequired = 30;
    private LocalDate estimatedAvailableDate;
    private String message;
    
    // Constructors
    
    public InsightDataAvailabilityResponse() {
    }
    
    public InsightDataAvailabilityResponse(boolean hasSufficientData, Integer daysOfData, 
                                          LocalDate estimatedAvailableDate, String message) {
        this.hasSufficientData = hasSufficientData;
        this.daysOfData = daysOfData;
        this.estimatedAvailableDate = estimatedAvailableDate;
        this.message = message;
    }
    
    // Getters and Setters
    
    public boolean isHasSufficientData() {
        return hasSufficientData;
    }
    
    public void setHasSufficientData(boolean hasSufficientData) {
        this.hasSufficientData = hasSufficientData;
    }
    
    public Integer getDaysOfData() {
        return daysOfData;
    }
    
    public void setDaysOfData(Integer daysOfData) {
        this.daysOfData = daysOfData;
    }
    
    public int getMinimumDaysRequired() {
        return minimumDaysRequired;
    }
    
    public void setMinimumDaysRequired(int minimumDaysRequired) {
        this.minimumDaysRequired = minimumDaysRequired;
    }
    
    public LocalDate getEstimatedAvailableDate() {
        return estimatedAvailableDate;
    }
    
    public void setEstimatedAvailableDate(LocalDate estimatedAvailableDate) {
        this.estimatedAvailableDate = estimatedAvailableDate;
    }
    
    public String getMessage() {
        return message;
    }
    
    public void setMessage(String message) {
        this.message = message;
    }
}
