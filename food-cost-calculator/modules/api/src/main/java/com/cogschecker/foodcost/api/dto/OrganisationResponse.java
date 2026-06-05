package com.cogschecker.foodcost.api.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for organisation details.
 * Requirements: 10.1
 */
public class OrganisationResponse {
    
    private UUID id;
    private String name;
    private String tier;
    private Instant createdAt;
    private Instant updatedAt;
    
    public OrganisationResponse() {
    }
    
    public OrganisationResponse(UUID id, String name, String tier, Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.name = name;
        this.tier = tier;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }
    
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        this.name = name;
    }
    
    public String getTier() {
        return tier;
    }
    
    public void setTier(String tier) {
        this.tier = tier;
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
