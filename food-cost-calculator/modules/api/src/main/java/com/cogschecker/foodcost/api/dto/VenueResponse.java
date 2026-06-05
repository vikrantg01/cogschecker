package com.cogschecker.foodcost.api.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for venue details.
 * Requirements: 10.1, 10.9, 10.11
 */
public class VenueResponse {
    
    private UUID id;
    private UUID organisationId;
    private String name;
    private String address;
    private Instant createdAt;
    private Instant updatedAt;
    
    public VenueResponse() {
    }
    
    public VenueResponse(UUID id, UUID organisationId, String name, String address, 
                        Instant createdAt, Instant updatedAt) {
        this.id = id;
        this.organisationId = organisationId;
        this.name = name;
        this.address = address;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }
    
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public UUID getOrganisationId() {
        return organisationId;
    }
    
    public void setOrganisationId(UUID organisationId) {
        this.organisationId = organisationId;
    }
    
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        this.name = name;
    }
    
    public String getAddress() {
        return address;
    }
    
    public void setAddress(String address) {
        this.address = address;
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
