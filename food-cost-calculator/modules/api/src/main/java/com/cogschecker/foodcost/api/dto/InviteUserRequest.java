package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.util.Map;
import java.util.UUID;

/**
 * Request DTO for inviting a new user to an organisation.
 * Requirements: 9.7 (invite users with role and venue assignments)
 */
public class InviteUserRequest {

    @NotBlank(message = "Email is required")
    @Email(message = "Email must be valid")
    private String email;

    @NotBlank(message = "Display name is required")
    private String displayName;

    @NotNull(message = "Admin flag is required")
    private Boolean isAdmin;

    @NotEmpty(message = "At least one venue role assignment is required")
    private Map<UUID, String> venueRoles; // venueId -> role name (ADMIN, MANAGER, STAFF)

    public InviteUserRequest() {
    }

    public InviteUserRequest(String email, String displayName, Boolean isAdmin, Map<UUID, String> venueRoles) {
        this.email = email;
        this.displayName = displayName;
        this.isAdmin = isAdmin;
        this.venueRoles = venueRoles;
    }

    // Getters and setters

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getDisplayName() {
        return displayName;
    }

    public void setDisplayName(String displayName) {
        this.displayName = displayName;
    }

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
