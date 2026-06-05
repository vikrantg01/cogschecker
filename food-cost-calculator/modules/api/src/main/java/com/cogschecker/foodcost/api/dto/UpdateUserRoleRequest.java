package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.Map;
import java.util.UUID;

/**
 * Request DTO for updating a user's role.
 * Requirements: 9.6 (update user role)
 */
public class UpdateUserRoleRequest {

    @NotNull(message = "Admin flag is required")
    private Boolean isAdmin;

    @NotEmpty(message = "At least one venue role assignment is required")
    private Map<UUID, String> venueRoles; // venueId -> role name (ADMIN, MANAGER, STAFF)

    public UpdateUserRoleRequest() {
    }

    public UpdateUserRoleRequest(Boolean isAdmin, Map<UUID, String> venueRoles) {
        this.isAdmin = isAdmin;
        this.venueRoles = venueRoles;
    }

    // Getters and setters

    public Boolean getIsAdmin() {
        return isAdmin;
    }

    public void setIsAdmin(Boolean isAdmin) {
        this.isAdmin = isAdmin;
    }

    public Map<UUID, String> getVenueRoles() {
        return venueRoles;
    }

    public void setVenueRoles(Map<UUID, String> venueRoles) {
        this.venueRoles = venueRoles;
    }
}
