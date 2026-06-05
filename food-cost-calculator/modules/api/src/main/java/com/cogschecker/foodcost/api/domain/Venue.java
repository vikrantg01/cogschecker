package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * Venue entity representing a physical cafe or restaurant location.
 * Requirements: 10.1, 10.2, 10.3, 10.8
 */
@Entity
@Table(name = "venues")
public class Venue {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "organisation_id", nullable = false)
    private UUID organisationId;
    
    @Column(name = "name", nullable = false, length = 100)
    private String name;
    
    @Column(name = "address")
    private String address;
    
    @Column(name = "deleted_at")
    private Instant deletedAt;
    
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
    
    public Venue() {
    }
    
    public Venue(UUID organisationId, String name, String address) {
        this.organisationId = organisationId;
        this.name = name;
        this.address = address;
    }
    
    // Getters and Setters
    
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
    
    public Instant getDeletedAt() {
        return deletedAt;
    }
    
    public void setDeletedAt(Instant deletedAt) {
        this.deletedAt = deletedAt;
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
