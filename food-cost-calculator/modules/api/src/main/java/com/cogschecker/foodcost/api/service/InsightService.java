package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.AiInsight;
import com.cogschecker.foodcost.api.domain.SquareConnection;
import com.cogschecker.foodcost.api.dto.InsightDataAvailabilityResponse;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.repository.AiInsightRepository;
import com.cogschecker.foodcost.api.repository.SquareConnectionRepository;
import com.cogschecker.foodcost.shared.ErrorCodes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Service for managing AI insights.
 * Requirements: 13.1, 13.2, 13.3, 13.5, 13.7
 */
@Service
public class InsightService {
    
    private static final Logger logger = LoggerFactory.getLogger(InsightService.class);
    private static final int MINIMUM_DAYS_REQUIRED = 30;
    
    private final AiInsightRepository insightRepository;
    private final SquareConnectionRepository squareConnectionRepository;
    
    public InsightService(AiInsightRepository insightRepository, 
                         SquareConnectionRepository squareConnectionRepository) {
        this.insightRepository = insightRepository;
        this.squareConnectionRepository = squareConnectionRepository;
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
    
    /**
     * Check if sufficient sales data is available to generate insights.
     * Requirements: 13.1, 13.6
     * 
     * Returns availability status including:
     * - Whether sufficient data exists (30+ days)
     * - Days of data currently available
     * - Estimated date when insights will be available
     * - Informational message
     * 
     * @param venueId the venue ID
     * @return availability status
     */
    @Transactional(readOnly = true)
    public InsightDataAvailabilityResponse checkDataAvailability(UUID venueId) {
        logger.info("Checking data availability for venue: {}", venueId);
        
        // Check if venue has a Square connection
        Optional<SquareConnection> connection = squareConnectionRepository.findByVenueId(venueId);
        
        if (connection.isEmpty()) {
            // No Square connection - no data available
            return new InsightDataAvailabilityResponse(
                false,
                0,
                null,
                "To generate AI insights, connect your Square POS account to sync sales data. " +
                "Once connected, insights will be available after 30 days of sales data has been collected."
            );
        }
        
        SquareConnection conn = connection.get();
        
        // Check if data has been synced
        if (conn.getLastSyncedAt() == null) {
            // Square connected but no sync yet
            return new InsightDataAvailabilityResponse(
                false,
                0,
                LocalDate.now().plusDays(MINIMUM_DAYS_REQUIRED),
                "Square POS connected. Waiting for initial data sync. " +
                "AI insights will be available after 30 days of sales data has been collected."
            );
        }
        
        // Calculate days of data available
        Instant firstSyncDate = conn.getCreatedAt(); // Use creation date as proxy for first data point
        long daysOfData = ChronoUnit.DAYS.between(firstSyncDate, Instant.now());
        
        if (daysOfData < MINIMUM_DAYS_REQUIRED) {
            // Insufficient data
            long daysRemaining = MINIMUM_DAYS_REQUIRED - daysOfData;
            LocalDate estimatedDate = LocalDate.now().plusDays(daysRemaining);
            
            return new InsightDataAvailabilityResponse(
                false,
                (int) daysOfData,
                estimatedDate,
                String.format(
                    "AI insights require at least 30 days of sales data. You currently have %d days. " +
                    "Insights will be available on approximately %s.",
                    daysOfData,
                    estimatedDate
                )
            );
        }
        
        // Sufficient data available
        return new InsightDataAvailabilityResponse(
            true,
            (int) daysOfData,
            null,
            String.format("You have %d days of sales data. AI insights are being generated and will appear below.", daysOfData)
        );
    }
}
