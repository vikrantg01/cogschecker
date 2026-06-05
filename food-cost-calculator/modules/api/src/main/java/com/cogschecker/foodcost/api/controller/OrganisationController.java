package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Organisation;
import com.cogschecker.foodcost.api.domain.Venue;
import com.cogschecker.foodcost.api.dto.*;
import com.cogschecker.foodcost.api.service.OrganisationService;
import com.cogschecker.foodcost.api.service.UserManagementService;
import com.cogschecker.foodcost.api.service.VenueService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * REST controller for organisation and user management operations.
 * Requirements: 9.6 (role management), 9.7 (user invitations), 9.9 (remove user), 
 *               10.1 (organisation management), 10.4 (cross-venue summary)
 */
@RestController
@RequestMapping("/api/v1/organisations/{orgId}")
public class OrganisationController {

    private static final Logger logger = LoggerFactory.getLogger(OrganisationController.class);

    private final UserManagementService userManagementService;
    private final OrganisationService organisationService;
    private final VenueService venueService;

    public OrganisationController(
            UserManagementService userManagementService,
            OrganisationService organisationService,
            VenueService venueService) {
        this.userManagementService = userManagementService;
        this.organisationService = organisationService;
        this.venueService = venueService;
    }
    
    // ===== Organisation Management =====
    
    /**
     * Get organisation details and tier.
     * Requirements: 10.1
     *
     * GET /api/v1/organisations/:orgId
     *
     * @param orgId the organisation ID
     * @return organisation details with tier
     */
    @GetMapping
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<OrganisationResponse> getOrganisation(@PathVariable UUID orgId) {
        logger.info("GET /organisations/{} - getting organisation details", orgId);

        Organisation org = organisationService.getOrganisation(orgId);
        String tier = organisationService.getOrganisationTier(orgId);

        OrganisationResponse response = new OrganisationResponse(
            org.getId(),
            org.getName(),
            tier,
            org.getCreatedAt(),
            org.getUpdatedAt()
        );

        return ResponseEntity.ok(response);
    }
    
    // ===== Venue Management =====
    
    /**
     * List all venues in the organisation.
     * Requirements: 10.1, 10.9
     *
     * GET /api/v1/organisations/:orgId/venues
     *
     * @param orgId the organisation ID
     * @return list of venues (Admin sees all venues in org)
     */
    @GetMapping("/venues")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<List<VenueResponse>> listVenues(@PathVariable UUID orgId) {
        logger.info("GET /organisations/{}/venues - listing venues", orgId);

        List<Venue> venues = venueService.getAllVenues(orgId);
        
        List<VenueResponse> responses = venues.stream()
            .map(this::toVenueResponse)
            .collect(Collectors.toList());

        return ResponseEntity.ok(responses);
    }
    
    /**
     * Create a new venue.
     * Requirements: 10.1, 10.2
     *
     * POST /api/v1/organisations/:orgId/venues
     * {
     *   "name": "Downtown Cafe",
     *   "address": "123 Main St"
     * }
     *
     * @param orgId the organisation ID
     * @param request the venue creation request
     * @return the created venue with HTTP 201
     */
    @PostMapping("/venues")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<VenueResponse> createVenue(
            @PathVariable UUID orgId,
            @Valid @RequestBody CreateVenueRequest request) {

        logger.info("POST /organisations/{}/venues - creating venue '{}'", orgId, request.getName());

        Venue venue = venueService.createVenue(orgId, request.getName(), request.getAddress());

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(toVenueResponse(venue));
    }
    
    /**
     * Get venue details.
     * Requirements: 10.1
     *
     * GET /api/v1/organisations/:orgId/venues/:venueId
     *
     * @param orgId the organisation ID
     * @param venueId the venue ID
     * @return venue details
     */
    @GetMapping("/venues/{venueId}")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<VenueResponse> getVenue(
            @PathVariable UUID orgId,
            @PathVariable UUID venueId) {

        logger.info("GET /organisations/{}/venues/{} - getting venue details", orgId, venueId);

        Venue venue = venueService.getVenue(orgId, venueId);

        return ResponseEntity.ok(toVenueResponse(venue));
    }
    
    /**
     * Update venue name and/or address.
     * Requirements: 10.1, 10.8
     *
     * PATCH /api/v1/organisations/:orgId/venues/:venueId
     * {
     *   "name": "New Name",
     *   "address": "New Address"
     * }
     *
     * @param orgId the organisation ID
     * @param venueId the venue ID
     * @param request the update request
     * @return the updated venue
     */
    @PatchMapping("/venues/{venueId}")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<VenueResponse> updateVenue(
            @PathVariable UUID orgId,
            @PathVariable UUID venueId,
            @Valid @RequestBody UpdateVenueRequest request) {

        logger.info("PATCH /organisations/{}/venues/{} - updating venue", orgId, venueId);

        Venue venue = venueService.getVenue(orgId, venueId);
        
        // Update name if provided
        if (request.getName() != null && !request.getName().trim().isEmpty()) {
            venue = venueService.renameVenue(orgId, venueId, request.getName());
        }
        
        // Update address if provided (can be set to null)
        if (request.getAddress() != null || request.getName() == null) {
            venue = venueService.updateVenueAddress(orgId, venueId, request.getAddress());
        }

        return ResponseEntity.ok(toVenueResponse(venue));
    }
    
    /**
     * Delete a venue (with confirmation).
     * Requirements: 10.8
     *
     * DELETE /api/v1/organisations/:orgId/venues/:venueId
     * {
     *   "confirmed": true
     * }
     *
     * Note: This performs a soft delete. All ingredients, recipes, and user access 
     * records associated with this venue will be permanently deleted.
     *
     * @param orgId the organisation ID
     * @param venueId the venue ID
     * @param request the delete confirmation request
     * @return HTTP 200 with success message
     */
    @DeleteMapping("/venues/{venueId}")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<MessageResponse> deleteVenue(
            @PathVariable UUID orgId,
            @PathVariable UUID venueId,
            @Valid @RequestBody DeleteVenueRequest request) {

        logger.info("DELETE /organisations/{}/venues/{} - deleting venue (confirmed: {})", 
                   orgId, venueId, request.getConfirmed());

        venueService.deleteVenue(orgId, venueId);

        return ResponseEntity.ok(new MessageResponse(
            "Venue deleted successfully. All associated data has been removed."
        ));
    }
    
    // ===== Cross-Venue Reports =====
    
    /**
     * Get cross-venue summary report.
     * Requirements: 10.4, 10.5
     *
     * GET /api/v1/organisations/:orgId/reports/cross-venue
     *
     * Returns aggregate statistics for each venue:
     * - Total recipe count
     * - Average food cost percentage
     * - Number of recipes exceeding threshold
     *
     * @param orgId the organisation ID
     * @return cross-venue summary
     */
    @GetMapping("/reports/cross-venue")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<CrossVenueSummaryResponse> getCrossVenueSummary(@PathVariable UUID orgId) {
        logger.info("GET /organisations/{}/reports/cross-venue - generating cross-venue summary", orgId);

        CrossVenueSummaryResponse summary = organisationService.getCrossVenueSummary(orgId);

        return ResponseEntity.ok(summary);
    }
    
    // ===== User Management =====

    /**
     * List all users in the organisation with their roles.
     * Requirements: 9.7 (list users and roles - Admin only)
     *
     * GET /api/v1/organisations/:orgId/users
     *
     * @param orgId the organisation ID
     * @return list of users with roles
     */
    @GetMapping("/users")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<List<UserResponse>> listUsers(@PathVariable UUID orgId) {
        logger.info("GET /organisations/{}/users - listing users", orgId);

        List<UserResponse> users = userManagementService.listUsers(orgId);

        return ResponseEntity.ok(users);
    }

    /**
     * Invite a new user to the organisation.
     * Requirements: 9.7 (invite users with role and venue assignments - Admin only)
     *
     * POST /api/v1/organisations/:orgId/invitations
     * {
     *   "email": "user@example.com",
     *   "displayName": "Jane Doe",
     *   "isAdmin": false,
     *   "venueRoles": {
     *     "venue-uuid-1": "MANAGER",
     *     "venue-uuid-2": "STAFF"
     *   }
     * }
     *
     * @param orgId the organisation ID
     * @param request the invitation request
     * @return the created user with HTTP 201
     */
    @PostMapping("/invitations")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<UserResponse> inviteUser(
            @PathVariable UUID orgId,
            @Valid @RequestBody InviteUserRequest request) {

        logger.info("POST /organisations/{}/invitations - inviting user {}", orgId, request.getEmail());

        UserResponse user = userManagementService.inviteUser(
                orgId,
                request.getEmail(),
                request.getDisplayName(),
                request.getIsAdmin(),
                request.getVenueRoles()
        );

        return ResponseEntity
                .status(HttpStatus.CREATED)
                .body(user);
    }

    /**
     * Update a user's role.
     * Requirements: 9.6 (update role - Admin only), 9.10 (prevent sole admin removal)
     *
     * PATCH /api/v1/organisations/:orgId/users/:userId/role
     * {
     *   "isAdmin": true,
     *   "venueRoles": {
     *     "venue-uuid-1": "ADMIN",
     *     "venue-uuid-2": "MANAGER"
     *   }
     * }
     *
     * @param orgId the organisation ID
     * @param userId the user ID
     * @param request the role update request
     * @return the updated user
     */
    @PatchMapping("/users/{userId}/role")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<UserResponse> updateUserRole(
            @PathVariable UUID orgId,
            @PathVariable UUID userId,
            @Valid @RequestBody UpdateUserRoleRequest request) {

        logger.info("PATCH /organisations/{}/users/{}/role - updating role", orgId, userId);

        UserResponse user = userManagementService.updateUserRole(
                orgId,
                userId,
                request.getIsAdmin(),
                request.getVenueRoles()
        );

        return ResponseEntity.ok(user);
    }

    /**
     * Remove a user's access to the organisation.
     * Requirements: 9.9 (remove user - Admin only), 9.10 (prevent sole admin removal)
     *
     * DELETE /api/v1/organisations/:orgId/users/:userId
     *
     * @param orgId the organisation ID
     * @param userId the user ID
     * @return HTTP 204 No Content on success
     */
    @DeleteMapping("/users/{userId}")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<MessageResponse> removeUser(
            @PathVariable UUID orgId,
            @PathVariable UUID userId) {

        logger.info("DELETE /organisations/{}/users/{} - removing user", orgId, userId);

        userManagementService.removeUser(orgId, userId);

        return ResponseEntity.ok(new MessageResponse("User removed successfully. All active sessions have been invalidated."));
    }
    
    // ===== Helper Methods =====
    
    /**
     * Convert Venue entity to VenueResponse DTO.
     */
    private VenueResponse toVenueResponse(Venue venue) {
        return new VenueResponse(
            venue.getId(),
            venue.getOrganisationId(),
            venue.getName(),
            venue.getAddress(),
            venue.getCreatedAt(),
            venue.getUpdatedAt()
        );
    }
}
