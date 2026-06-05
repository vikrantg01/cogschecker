package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.UserOrganisationRole;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for UserOrganisationRole entity.
 * Requirements: 9.2 (Admin role management), 9.10 (prevent removing sole admin)
 */
@Repository
public interface UserOrganisationRoleRepository extends JpaRepository<UserOrganisationRole, UUID> {
    
    /**
     * Find user-organisation role mapping.
     */
    Optional<UserOrganisationRole> findByUserIdAndOrganisationId(UUID userId, UUID organisationId);
    
    /**
     * Find all organisation roles for an organisation.
     */
    List<UserOrganisationRole> findByOrganisationId(UUID organisationId);
    
    /**
     * Count admins in an organisation.
     */
    long countByOrganisationIdAndIsAdminTrue(UUID organisationId);
    
    /**
     * Delete user-organisation role mapping.
     */
    void deleteByUserIdAndOrganisationId(UUID userId, UUID organisationId);
}
