package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;

import java.util.UUID;

/**
 * User-Venue role mapping.
 * Requirements: 9.1 (role-based access control per venue)
 */
@Entity
@Table(
    name = "user_venue_roles",
    uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "venue_id"})
)
public class UserVenueRole {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "venue_id", nullable = false)
    private UUID venueId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Role role;

    public UserVenueRole() {
    }

    public UserVenueRole(UUID userId, UUID venueId, Role role) {
        this.userId = userId;
        this.venueId = venueId;
        this.role = role;
    }

    // Getters and setters

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public UUID getUserId() {
        return userId;
    }

    public void setUserId(UUID userId) {
        this.userId = userId;
    }

    public UUID getVenueId() {
        return venueId;
    }

    public void setVenueId(UUID venueId) {
        this.venueId = venueId;
    }

    public Role getRole() {
        return role;
    }

    public void setRole(Role role) {
        this.role = role;
    }

    /**
     * Role enum: Admin, Manager, Staff
     * Requirements: 9.1 (three roles)
     */
    public enum Role {
        ADMIN,
        MANAGER,
        STAFF
    }
}
