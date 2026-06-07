package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.api.domain.AiInsight;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * Response DTO for AI insight data.
 * Returns all insight fields for Pro+ tier users.
 * Requirements: 13.1, 13.7
 */
public class AiInsightResponse {
    
    private UUID id;
    private UUID venueId;
    private String insightType;
    private String title;
    private String explanation;
    private Map<String, Object> supportingData;
    private String recommendedAction;
    private String status;
    private Instant generatedAt;
    private Instant createdAt;
    private Instant updatedAt;
    
    // Constructors
    
    public AiInsightResponse() {
    }
    
    public AiInsightResponse(AiInsight insight) {
        this.id = insight.getId();
        this.venueId = insight.getVenueId();
        this.insightType = insight.getInsightType().name().toLowerCase();
        this.title = insight.getTitle();
        this.explanation = insight.getExplanation();
        this.supportingData = insight.getSupportingData();
        this.recommendedAction = insight.getRecommendedAction();
        this.status = insight.getStatus().name().toLowerCase();
        this.generatedAt = insight.getGeneratedAt();
        this.createdAt = insight.getCreatedAt();
        this.updatedAt = insight.getUpdatedAt();
    }
    
    // Static factory method for convenience
    public static AiInsightResponse fromEntity(AiInsight insight) {
        return new AiInsightResponse(insight);
    }
    
    // Getters and Setters
    
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public UUID getVenueId() {
        return venueId;
    }
    
    public void setVenueId(UUID venueId) {
        this.venueId = venueId;
    }
    
    public String getInsightType() {
        return insightType;
    }
    
    public void setInsightType(String insightType) {
        this.insightType = insightType;
    }
    
    public String getTitle() {
        return title;
    }
    
    public void setTitle(String title) {
        this.title = title;
    }
    
    public String getExplanation() {
        return explanation;
    }
    
    public void setExplanation(String explanation) {
        this.explanation = explanation;
    }
    
    public Map<String, Object> getSupportingData() {
        return supportingData;
    }
    
    public void setSupportingData(Map<String, Object> supportingData) {
        this.supportingData = supportingData;
    }
    
    public String getRecommendedAction() {
        return recommendedAction;
    }
    
    public void setRecommendedAction(String recommendedAction) {
        this.recommendedAction = recommendedAction;
    }
    
    public String getStatus() {
        return status;
    }
    
    public void setStatus(String status) {
        this.status = status;
    }
    
    public Instant getGeneratedAt() {
        return generatedAt;
    }
    
    public void setGeneratedAt(Instant generatedAt) {
        this.generatedAt = generatedAt;
    }
    
    public Instant getCreatedAt() {
        return createdAt;
    }
    
    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
    
    public Instant getUpdatedAt() {
        return updatedAt;
    }
    
    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
}
