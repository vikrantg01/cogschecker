package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.SquareUnmatchedItem;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for SquareUnmatchedItem entities.
 * Requirements: 12.4 (Square sync - unmatched item management)
 */
@Repository
public interface SquareUnmatchedItemRepository extends JpaRepository<SquareUnmatchedItem, UUID> {
    
    /**
     * Find an unmatched item by venue ID and Square item name (case-insensitive).
     * 
     * @param venueId the venue ID
     * @param squareItemName the Square item name
     * @return Optional containing the unmatched item if found
     */
    @Query("SELECT u FROM SquareUnmatchedItem u WHERE u.venueId = :venueId AND LOWER(u.squareItemName) = LOWER(:squareItemName)")
    Optional<SquareUnmatchedItem> findByVenueIdAndSquareItemNameIgnoreCase(
            @Param("venueId") UUID venueId, 
            @Param("squareItemName") String squareItemName);
    
    /**
     * Find all unmatched items for a venue.
     * 
     * @param venueId the venue ID
     * @return list of unmatched items
     */
    List<SquareUnmatchedItem> findByVenueId(UUID venueId);
    
    /**
     * Delete all unmatched items for a venue with status 'dismissed'.
     * Used to clean up old dismissed items during sync.
     * 
     * @param venueId the venue ID
     */
    @Modifying
    @Query("DELETE FROM SquareUnmatchedItem u WHERE u.venueId = :venueId AND u.status = 'DISMISSED'")
    void deleteByVenueIdAndStatusDismissed(@Param("venueId") UUID venueId);
}
