package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;

import java.util.UUID;

/**
 * User-Organisation role mapping (Admin flag at organisation level).
 * Requirements: 9.1 (role-based access control), 9.2 (Admin access to all venues)
 */
@Entity
@Table(
    name = "user_organisation_roles",
    uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "organisation_id"})
)
public class UserOrganisationRole {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "organisation_id", nullable = false)
    private UUID organisationId;

    @Column(name = "is_admin", nullable = false)
    private boolean isAdmin;

    public UserOrganisationRole() {
    }

    public UserOrganisationRole(UUID userId, UUID organisationId, boolean isAdmin) {
        this.userId = userId;
        this.organisationId = organisationId;
        this.isAdmin = isAdmin;
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

    public UUID getOrganisationId() {
        return organisationId;
    }

    public void setOrganisationId(UUID organisationId) {
        this.organisationId = organisationId;
    }

    public boolean isAdmin() {
        return isAdmin;
    }

    public void setAdmin(boolean admin) {
        isAdmin = admin;
    }
}
