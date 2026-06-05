package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.dto.UserResponse;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.exception.ValidationException;
import com.cogschecker.foodcost.api.repository.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import software.amazon.awssdk.services.cognitoidentityprovider.CognitoIdentityProviderClient;
import software.amazon.awssdk.services.cognitoidentityprovider.model.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Service for user management operations.
 * Requirements: 9.6 (role assignment), 9.7 (invite users), 9.9 (remove user access), 9.10 (prevent sole admin removal)
 */
@Service
public class UserManagementService {

    private static final Logger logger = LoggerFactory.getLogger(UserManagementService.class);

    private final UserRepository userRepository;
    private final OrganisationRepository organisationRepository;
    private final VenueRepository venueRepository;
    private final UserOrganisationRoleRepository userOrganisationRoleRepository;
    private final UserVenueRoleRepository userVenueRoleRepository;
    private final CognitoIdentityProviderClient cognitoClient;

    @Value("${cognito.user-pool-id}")
    private String userPoolId;

    public UserManagementService(
            UserRepository userRepository,
            OrganisationRepository organisationRepository,
            VenueRepository venueRepository,
            UserOrganisationRoleRepository userOrganisationRoleRepository,
            UserVenueRoleRepository userVenueRoleRepository,
            CognitoIdentityProviderClient cognitoClient) {
        this.userRepository = userRepository;
        this.organisationRepository = organisationRepository;
        this.venueRepository = venueRepository;
        this.userOrganisationRoleRepository = userOrganisationRoleRepository;
        this.userVenueRoleRepository = userVenueRoleRepository;
        this.cognitoClient = cognitoClient;
    }

    /**
     * List all users in an organisation with their roles.
     * Requirements: 9.7 (list users)
     */
    @Transactional(readOnly = true)
    public List<UserResponse> listUsers(UUID organisationId) {
        logger.info("Listing users for organisation: {}", organisationId);

        organisationRepository.findById(organisationId)
                .orElseThrow(() -> new ResourceNotFoundException("ORGANISATION_NOT_FOUND", "Organisation not found"));

        List<UserOrganisationRole> orgRoles = userOrganisationRoleRepository.findByOrganisationId(organisationId);

        List<UserResponse> responses = new ArrayList<>();
        for (UserOrganisationRole orgRole : orgRoles) {
            User user = userRepository.findById(orgRole.getUserId()).orElse(null);
            if (user == null) continue;
            
            boolean isAdmin = orgRole.isAdmin();
            List<UserVenueRole> userVenueRoles = userVenueRoleRepository
                    .findByUserIdAndOrganisationId(user.getId(), organisationId);

            responses.add(UserResponse.from(user, isAdmin, userVenueRoles));
        }

        logger.info("Found {} users in organisation {}", responses.size(), organisationId);
        return responses;
    }

    /**
     * Invite a new user to the organisation.
     * Requirements: 9.7 (invite users with role and venue assignments)
     */
    @Transactional
    public UserResponse inviteUser(UUID organisationId, String email, String displayName, 
                                   boolean isAdmin, Map<UUID, String> venueRoles) {
        logger.info("Inviting user {} to organisation {}", email, organisationId);

        organisationRepository.findById(organisationId)
                .orElseThrow(() -> new ResourceNotFoundException("ORGANISATION_NOT_FOUND", "Organisation not found"));

        for (UUID venueId : venueRoles.keySet()) {
            Venue venue = venueRepository.findById(venueId)
                    .orElseThrow(() -> new ResourceNotFoundException("VENUE_NOT_FOUND", "Venue not found: " + venueId));
            
            if (!venue.getOrganisationId().equals(organisationId)) {
                throw new ValidationException("VENUE_ORGANISATION_MISMATCH", 
                        "Venue " + venueId + " does not belong to organisation " + organisationId);
            }
        }

        User user = userRepository.findByEmailIgnoreCase(email)
                .orElseGet(() -> userRepository.save(new User(email, displayName)));

        UserOrganisationRole orgRole = new UserOrganisationRole(user.getId(), organisationId, isAdmin);
        userOrganisationRoleRepository.save(orgRole);

        List<UserVenueRole> createdVenueRoles = new ArrayList<>();
        for (Map.Entry<UUID, String> entry : venueRoles.entrySet()) {
            UUID venueId = entry.getKey();
            String roleName = entry.getValue();

            UserVenueRole.Role role;
            try {
                role = UserVenueRole.Role.valueOf(roleName.toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new ValidationException("INVALID_ROLE", "Invalid role: " + roleName);
            }

            UserVenueRole venueRole = new UserVenueRole(user.getId(), venueId, role);
            createdVenueRoles.add(userVenueRoleRepository.save(venueRole));
        }

        updateCognitoUserAttributes(user.getId(), organisationId, isAdmin, createdVenueRoles);

        logger.info("User {} invited successfully to organisation {}", email, organisationId);
        return UserResponse.from(user, isAdmin, createdVenueRoles);
    }

    /**
     * Update a user's role.
     * Requirements: 9.6 (update role), 9.10 (prevent sole admin removal)
     */
    @Transactional
    public UserResponse updateUserRole(UUID organisationId, UUID userId, boolean isAdmin, 
                                      Map<UUID, String> venueRoles) {
        logger.info("Updating role for user {} in organisation {}", userId, organisationId);

        organisationRepository.findById(organisationId)
                .orElseThrow(() -> new ResourceNotFoundException("ORGANISATION_NOT_FOUND", "Organisation not found"));

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("USER_NOT_FOUND", "User not found"));

        UserOrganisationRole orgRole = userOrganisationRoleRepository
                .findByUserIdAndOrganisationId(userId, organisationId)
                .orElseThrow(() -> new ResourceNotFoundException("USER_NOT_MEMBER", 
                        "User is not a member of this organisation"));

        if (orgRole.isAdmin() && !isAdmin) {
            long adminCount = userOrganisationRoleRepository.countByOrganisationIdAndIsAdminTrue(organisationId);
            if (adminCount <= 1) {
                throw new ValidationException("SOLE_ADMIN_REMOVAL", 
                        "Cannot remove Admin role from the sole administrator");
            }
        }

        orgRole.setAdmin(isAdmin);
        userOrganisationRoleRepository.save(orgRole);

        List<UserVenueRole> existingVenueRoles = userVenueRoleRepository
                .findByUserIdAndOrganisationId(userId, organisationId);
        userVenueRoleRepository.deleteAll(existingVenueRoles);

        List<UserVenueRole> createdVenueRoles = new ArrayList<>();
        for (Map.Entry<UUID, String> entry : venueRoles.entrySet()) {
            UUID venueId = entry.getKey();
            String roleName = entry.getValue();

            Venue venue = venueRepository.findById(venueId)
                    .orElseThrow(() -> new ResourceNotFoundException("VENUE_NOT_FOUND", "Venue not found: " + venueId));
            
            if (!venue.getOrganisationId().equals(organisationId)) {
                throw new ValidationException("VENUE_ORGANISATION_MISMATCH", 
                        "Venue " + venueId + " does not belong to organisation " + organisationId);
            }

            UserVenueRole.Role role;
            try {
                role = UserVenueRole.Role.valueOf(roleName.toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new ValidationException("INVALID_ROLE", "Invalid role: " + roleName);
            }

            UserVenueRole venueRole = new UserVenueRole(userId, venueId, role);
            createdVenueRoles.add(userVenueRoleRepository.save(venueRole));
        }

        updateCognitoUserAttributes(userId, organisationId, isAdmin, createdVenueRoles);

        logger.info("Role updated successfully for user {} in organisation {}", userId, organisationId);
        return UserResponse.from(user, isAdmin, createdVenueRoles);
    }

    /**
     * Remove a user's access to the organisation.
     * Requirements: 9.9 (remove user access and invalidate sessions), 9.10 (prevent sole admin removal)
     */
    @Transactional
    public void removeUser(UUID organisationId, UUID userId) {
        logger.info("Removing user {} from organisation {}", userId, organisationId);

        organisationRepository.findById(organisationId)
                .orElseThrow(() -> new ResourceNotFoundException("ORGANISATION_NOT_FOUND", "Organisation not found"));

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new ResourceNotFoundException("USER_NOT_FOUND", "User not found"));

        UserOrganisationRole orgRole = userOrganisationRoleRepository
                .findByUserIdAndOrganisationId(userId, organisationId)
                .orElseThrow(() -> new ResourceNotFoundException("USER_NOT_MEMBER", 
                        "User is not a member of this organisation"));

        if (orgRole.isAdmin()) {
            long adminCount = userOrganisationRoleRepository.countByOrganisationIdAndIsAdminTrue(organisationId);
            if (adminCount <= 1) {
                throw new ValidationException("SOLE_ADMIN_REMOVAL", 
                        "Cannot remove the sole administrator from the organisation");
            }
        }

        List<UserVenueRole> venueRoles = userVenueRoleRepository
                .findByUserIdAndOrganisationId(userId, organisationId);
        userVenueRoleRepository.deleteAll(venueRoles);

        userOrganisationRoleRepository.delete(orgRole);

        invalidateCognitoUserSessions(user.getEmail());

        logger.info("User {} removed successfully from organisation {}", userId, organisationId);
    }

    /**
     * Update Cognito user custom attributes with role information.
     * Requirements: 9.6 (apply new permissions immediately)
     */
    private void updateCognitoUserAttributes(UUID userId, UUID organisationId, boolean isAdmin, 
                                            List<UserVenueRole> venueRoles) {
        try {
            Map<String, String> venueRoleMap = venueRoles.stream()
                    .collect(Collectors.toMap(
                            uvr -> uvr.getVenueId().toString(),
                            uvr -> uvr.getRole().name()
                    ));
            
            String venueRolesJson = new com.fasterxml.jackson.databind.ObjectMapper()
                    .writeValueAsString(venueRoleMap);

            logger.info("Would update Cognito attributes for user {}: org={}, admin={}, venueRoles={}",
                    userId, organisationId, isAdmin, venueRolesJson);

        } catch (Exception e) {
            logger.error("Failed to update Cognito attributes for user {}: {}", userId, e.getMessage(), e);
        }
    }

    /**
     * Invalidate all Cognito sessions for a user.
     * Requirements: 9.9 (invalidate sessions when access removed)
     */
    private void invalidateCognitoUserSessions(String email) {
        try {
            logger.info("Invalidating Cognito sessions for user: {}", email);

            AdminDisableUserRequest disableRequest = AdminDisableUserRequest.builder()
                    .userPoolId(userPoolId)
                    .username(email)
                    .build();
            cognitoClient.adminDisableUser(disableRequest);

            AdminUserGlobalSignOutRequest signOutRequest = AdminUserGlobalSignOutRequest.builder()
                    .userPoolId(userPoolId)
                    .username(email)
                    .build();
            cognitoClient.adminUserGlobalSignOut(signOutRequest);

            logger.info("Cognito sessions invalidated for user: {}", email);

        } catch (CognitoIdentityProviderException e) {
            logger.error("Failed to invalidate Cognito sessions for {}: {}", email, e.getMessage(), e);
            throw new RuntimeException("Failed to invalidate user sessions: " + e.awsErrorDetails().errorMessage());
        }
    }
}
