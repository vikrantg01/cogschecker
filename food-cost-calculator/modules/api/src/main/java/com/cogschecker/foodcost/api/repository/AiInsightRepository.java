package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.AiInsight;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for AiInsight entities.
 * Requirements: 13.1–13.8
 */
@Repository
public interface AiInsightRepository extends JpaRepository<AiInsight, UUID> {
    
    /**
     * Find all insights for a venue, ordered by generated_at descending.
     * 
     * @param venueId the venue ID
     * @return list of insights
     */
    List<AiInsight> findByVenueIdOrderByGeneratedAtDesc(UUID venueId);
    
    /**
     * Find all active insights for a venue.
     * 
     * @param venueId the venue ID
     * @param status the status to filter by
     * @return list of insights with the given status
     */
    List<AiInsight> findByVenueIdAndStatusOrderByGeneratedAtDesc(UUID venueId, AiInsight.Status status);
    
    /**
     * Delete all insights for a venue (used when regenerating insights).
     * 
     * @param venueId the venue ID
     */
    void deleteByVenueId(UUID venueId);
}
