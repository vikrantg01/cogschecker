package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.UserVenueRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for UserVenueRole entity.
 * Requirements: 9.1 (role-based access control), 9.6 (role assignment)
 */
@Repository
public interface UserVenueRoleRepository extends JpaRepository<UserVenueRole, UUID> {
    
    /**
     * Find all venue roles for a user.
     */
    List<UserVenueRole> findByUserId(UUID userId);
    
    /**
     * Find venue roles for a user in an organisation.
     */
    @Query("SELECT uvr FROM UserVenueRole uvr WHERE uvr.userId = :userId AND uvr.venueId IN " +
           "(SELECT v.id FROM Venue v WHERE v.organisationId = :organisationId)")
    List<UserVenueRole> findByUserIdAndOrganisationId(UUID userId, UUID organisationId);
    
    /**
     * Find user-venue role mapping.
     */
    Optional<UserVenueRole> findByUserIdAndVenueId(UUID userId, UUID venueId);
    
    /**
     * Delete all venue roles for a user in an organisation.
     */
    @Modifying
    @Query("DELETE FROM UserVenueRole uvr WHERE uvr.userId = :userId AND uvr.venueId IN " +
           "(SELECT v.id FROM Venue v WHERE v.organisationId = :organisationId)")
    void deleteByUserIdAndOrganisationId(UUID userId, UUID organisationId);
}
