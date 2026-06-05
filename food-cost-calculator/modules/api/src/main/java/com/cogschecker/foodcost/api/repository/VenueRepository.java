package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.Venue;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Venue entity.
 */
@Repository
public interface VenueRepository extends JpaRepository<Venue, UUID> {
    
    /**
     * Find all venues belonging to an organisation (excluding soft-deleted).
     */
    List<Venue> findByOrganisationIdAndDeletedAtIsNull(UUID organisationId);
    
    /**
     * Count active venues for an organisation (excluding soft-deleted).
     */
    long countByOrganisationIdAndDeletedAtIsNull(UUID organisationId);
    
    /**
     * Find a venue by organisation and ID (excluding soft-deleted).
     */
    Optional<Venue> findByOrganisationIdAndIdAndDeletedAtIsNull(UUID organisationId, UUID id);
    
    /**
     * Check if a venue name already exists in the organisation (case-insensitive, excluding soft-deleted).
     */
    @Query("SELECT CASE WHEN COUNT(v) > 0 THEN true ELSE false END FROM Venue v " +
           "WHERE v.organisationId = :organisationId AND LOWER(v.name) = LOWER(:name) AND v.deletedAt IS NULL")
    boolean existsByOrganisationIdAndNameIgnoreCase(UUID organisationId, String name);
    
    /**
     * Check if a venue name already exists in the organisation, excluding a specific venue ID 
     * (case-insensitive, excluding soft-deleted).
     */
    @Query("SELECT CASE WHEN COUNT(v) > 0 THEN true ELSE false END FROM Venue v " +
           "WHERE v.organisationId = :organisationId AND LOWER(v.name) = LOWER(:name) " +
           "AND v.id != :excludeId AND v.deletedAt IS NULL")
    boolean existsByOrganisationIdAndNameIgnoreCaseExcludingId(UUID organisationId, String name, UUID excludeId);
}
