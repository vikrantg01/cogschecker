package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.SquareConnection;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for SquareConnection entities.
 * Requirements: 12.1 (Square OAuth connection)
 */
@Repository
public interface SquareConnectionRepository extends JpaRepository<SquareConnection, UUID> {
    
    /**
     * Find a Square connection by venue ID.
     * 
     * @param venueId the venue ID
     * @return Optional containing the connection if found
     */
    Optional<SquareConnection> findByVenueId(UUID venueId);
    
    /**
     * Check if a Square connection exists for a venue.
     * 
     * @param venueId the venue ID
     * @return true if a connection exists
     */
    boolean existsByVenueId(UUID venueId);
    
    /**
     * Delete a Square connection by venue ID.
     * 
     * @param venueId the venue ID
     */
    void deleteByVenueId(UUID venueId);
}
