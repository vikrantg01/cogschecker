package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/**
 * AiInsight entity representing AI-generated insights for Pro+ tier venues.
 * Requirements: 13.1, 13.2, 13.3, 13.5, 13.7
 */
@Entity
@Table(name = "ai_insights")
public class AiInsight {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "venue_id", nullable = false)
    private UUID venueId;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "insight_type", nullable = false, length = 50)
    private InsightType insightType;
    
    @Column(name = "title", nullable = false, length = 255)
    private String title;
    
    @Column(name = "explanation", columnDefinition = "TEXT")
    private String explanation;
    
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "supporting_data", columnDefinition = "jsonb")
    private Map<String, Object> supportingData;
    
    @Column(name = "recommended_action", columnDefinition = "TEXT")
    private String recommendedAction;
    
    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private Status status = Status.ACTIVE;
    
    @Column(name = "generated_at", nullable = false)
    private Instant generatedAt;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
    
    // Constructors
    
    public AiInsight() {
    }
    
    public AiInsight(UUID venueId, InsightType insightType, String title, String explanation,
                     Map<String, Object> supportingData, String recommendedAction) {
        this.venueId = venueId;
        this.insightType = insightType;
        this.title = title;
        this.explanation = explanation;
        this.supportingData = supportingData;
        this.recommendedAction = recommendedAction;
        this.generatedAt = Instant.now();
        this.status = Status.ACTIVE;
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
    
    public InsightType getInsightType() {
        return insightType;
    }
    
    public void setInsightType(InsightType insightType) {
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
    
    public Status getStatus() {
        return status;
    }
    
    public void setStatus(Status status) {
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
    
    public enum InsightType {
        RECIPE_PROFITABILITY,
        SUPPLIER_COST
    }
    
    public enum Status {
        ACTIVE,
        ACTIONED,
        DISMISSED
    }
}
