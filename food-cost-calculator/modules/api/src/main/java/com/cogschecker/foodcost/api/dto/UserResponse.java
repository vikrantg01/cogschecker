package com.cogschecker.foodcost.api.dto;

import com.cogschecker.foodcost.api.domain.User;
import com.cogschecker.foodcost.api.domain.UserVenueRole;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Response DTO for user details with roles.
 * Requirements: 9.7 (list users and roles)
 */
public class UserResponse {

    private UUID id;
    private String email;
    private String displayName;
    
    @JsonProperty("isAdmin")
    private boolean isAdmin;
    
    private Map<UUID, String> venueRoles; // venueId -> role name

    public UserResponse() {
    }

    public UserResponse(UUID id, String email, String displayName, boolean isAdmin, Map<UUID, String> venueRoles) {
        this.id = id;
        this.email = email;
        this.displayName = displayName;
        this.isAdmin = isAdmin;
        this.venueRoles = venueRoles;
    }

    /**
     * Create UserResponse from User entity and roles.
     */
    public static UserResponse from(User user, boolean isAdmin, List<UserVenueRole> venueRoles) {
        Map<UUID, String> roleMap = venueRoles.stream()
                .collect(Collectors.toMap(
                        UserVenueRole::getVenueId,
                        uvr -> uvr.getRole().name()
                ));
        
        return new UserResponse(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                isAdmin,
                roleMap
        );
    }

    // Getters and setters

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

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

    public boolean isAdmin() {
        return isAdmin;
    }

    public void setAdmin(boolean admin) {
        isAdmin = admin;
    }

    public Map<UUID, String> getVenueRoles() {
        return venueRoles;
    }

    public void setVenueRoles(Map<UUID, String> venueRoles) {
        this.venueRoles = venueRoles;
    }
}
