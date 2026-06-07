package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.AiInsight;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.repository.AiInsightRepository;
import com.cogschecker.foodcost.shared.ErrorCodes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Service for managing AI insights.
 * Requirements: 13.1, 13.2, 13.3, 13.5, 13.7
 */
@Service
public class InsightService {
    
    private static final Logger logger = LoggerFactory.getLogger(InsightService.class);
    
    private final AiInsightRepository insightRepository;
    
    public InsightService(AiInsightRepository insightRepository) {
        this.insightRepository = insightRepository;
    }
    
    /**
     * Get all insights for a venue.
     * Requirements: 13.1, 13.7
     * 
     * @param venueId the venue ID
     * @return list of insights ordered by generated_at descending
     */
    @Transactional(readOnly = true)
    public List<AiInsight> getInsights(UUID venueId) {
        logger.info("Getting all insights for venue: {}", venueId);
        return insightRepository.findByVenueIdOrderByGeneratedAtDesc(venueId);
    }
    
    /**
     * Get active insights for a venue.
     * Requirements: 13.1, 13.7
     * 
     * @param venueId the venue ID
     * @return list of active insights ordered by generated_at descending
     */
    @Transactional(readOnly = true)
    public List<AiInsight> getActiveInsights(UUID venueId) {
        logger.info("Getting active insights for venue: {}", venueId);
        return insightRepository.findByVenueIdAndStatusOrderByGeneratedAtDesc(venueId, AiInsight.Status.ACTIVE);
    }
    
    /**
     * Update the status of an insight (ACTIVE → ACTIONED or DISMISSED).
     * Requirements: 13.5
     * 
     * @param venueId the venue ID (for verification)
     * @param insightId the insight ID
     * @param newStatus the new status (ACTIONED or DISMISSED)
     * @return the updated insight
     * @throws ResourceNotFoundException if insight not found or doesn't belong to the venue
     * @throws IllegalArgumentException if attempting to change from a non-ACTIVE status
     */
    @Transactional
    public AiInsight updateInsightStatus(UUID venueId, UUID insightId, AiInsight.Status newStatus) {
        logger.info("Updating insight {} status to {} for venue: {}", insightId, newStatus, venueId);
        
        // Validate new status is ACTIONED or DISMISSED
        if (newStatus != AiInsight.Status.ACTIONED && newStatus != AiInsight.Status.DISMISSED) {
            throw new IllegalArgumentException("Status can only be updated to ACTIONED or DISMISSED");
        }
        
        // Find the insight and verify it belongs to the venue
        AiInsight insight = insightRepository.findById(insightId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorCodes.INSIGHT_NOT_FOUND,
                        String.format("Insight with ID %s not found", insightId)));
        
        if (!insight.getVenueId().equals(venueId)) {
            throw new ResourceNotFoundException(
                    ErrorCodes.INSIGHT_NOT_FOUND,
                    String.format("Insight with ID %s not found in venue %s", insightId, venueId));
        }
        
        // Only allow status changes from ACTIVE
        if (insight.getStatus() != AiInsight.Status.ACTIVE) {
            throw new IllegalArgumentException("Can only update status of ACTIVE insights. Current status: " + insight.getStatus());
        }
        
        // Update status
        insight.setStatus(newStatus);
        AiInsight updated = insightRepository.save(insight);
        
        logger.info("Successfully updated insight {} to status: {}", insightId, newStatus);
        return updated;
    }
    
    /**
     * Get a single insight by ID.
     * Requirements: 13.7
     * 
     * @param venueId the venue ID (for verification)
     * @param insightId the insight ID
     * @return the insight
     * @throws ResourceNotFoundException if insight not found or doesn't belong to the venue
     */
    @Transactional(readOnly = true)
    public AiInsight getInsight(UUID venueId, UUID insightId) {
        logger.info("Getting insight {} for venue: {}", insightId, venueId);
        
        AiInsight insight = insightRepository.findById(insightId)
                .orElseThrow(() -> new ResourceNotFoundException(
                        ErrorCodes.INSIGHT_NOT_FOUND,
                        String.format("Insight with ID %s not found", insightId)));
        
        if (!insight.getVenueId().equals(venueId)) {
            throw new ResourceNotFoundException(
                    ErrorCodes.INSIGHT_NOT_FOUND,
                    String.format("Insight with ID %s not found in venue %s", insightId, venueId));
        }
        
        return insight;
    }
}
