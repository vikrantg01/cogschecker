package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.AiInsight;
import com.cogschecker.foodcost.api.domain.SquareConnection;
import com.cogschecker.foodcost.api.dto.InsightDataAvailabilityResponse;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.repository.AiInsightRepository;
import com.cogschecker.foodcost.api.repository.SquareConnectionRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for InsightService.
 * Tests Requirements: 13.1, 13.5, 13.7
 */
@ExtendWith(MockitoExtension.class)
class InsightServiceTest {
    
    @Mock
    private AiInsightRepository insightRepository;
    
    @Mock
    private SquareConnectionRepository squareConnectionRepository;
    
    @InjectMocks
    private InsightService insightService;
    
    private UUID venueId;
    private UUID insightId;
    private AiInsight testInsight;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
        insightId = UUID.randomUUID();
        
        Map<String, Object> supportingData = new HashMap<>();
        supportingData.put("recipe_id", UUID.randomUUID().toString());
        
        testInsight = new AiInsight(
            venueId,
            AiInsight.InsightType.RECIPE_PROFITABILITY,
            "Test Insight",
            "Test explanation",
            supportingData,
            "Test action"
        );
        testInsight.setId(insightId);
        testInsight.setCreatedAt(Instant.now());
        testInsight.setUpdatedAt(Instant.now());
        testInsight.setGeneratedAt(Instant.now());
    }
    
    /**
     * Test getInsights returns all insights for a venue.
     * Requirement: 13.1, 13.7
     */
    @Test
    void testGetInsights() {
        List<AiInsight> insights = Arrays.asList(testInsight);
        when(insightRepository.findByVenueIdOrderByGeneratedAtDesc(venueId)).thenReturn(insights);
        
        List<AiInsight> result = insightService.getInsights(venueId);
        
        assertNotNull(result);
        assertEquals(1, result.size());
        assertEquals(insightId, result.get(0).getId());
        verify(insightRepository, times(1)).findByVenueIdOrderByGeneratedAtDesc(venueId);
    }
    
    /**
     * Test getActiveInsights returns only active insights.
     * Requirement: 13.1, 13.7
     */
    @Test
    void testGetActiveInsights() {
        List<AiInsight> activeInsights = Arrays.asList(testInsight);
        when(insightRepository.findByVenueIdAndStatusOrderByGeneratedAtDesc(venueId, AiInsight.Status.ACTIVE))
            .thenReturn(activeInsights);
        
        List<AiInsight> result = insightService.getActiveInsights(venueId);
        
        assertNotNull(result);
        assertEquals(1, result.size());
        assertEquals(AiInsight.Status.ACTIVE, result.get(0).getStatus());
        verify(insightRepository, times(1))
            .findByVenueIdAndStatusOrderByGeneratedAtDesc(venueId, AiInsight.Status.ACTIVE);
    }
    
    /**
     * Test updateInsightStatus successfully updates from ACTIVE to ACTIONED.
     * Requirement: 13.5
     */
    @Test
    void testUpdateInsightStatusToActioned() {
        when(insightRepository.findById(insightId)).thenReturn(Optional.of(testInsight));
        when(insightRepository.save(any(AiInsight.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        AiInsight result = insightService.updateInsightStatus(venueId, insightId, AiInsight.Status.ACTIONED);
        
        assertNotNull(result);
        assertEquals(AiInsight.Status.ACTIONED, result.getStatus());
        verify(insightRepository, times(1)).findById(insightId);
        verify(insightRepository, times(1)).save(testInsight);
    }
    
    /**
     * Test updateInsightStatus successfully updates from ACTIVE to DISMISSED.
     * Requirement: 13.5
     */
    @Test
    void testUpdateInsightStatusToDismissed() {
        when(insightRepository.findById(insightId)).thenReturn(Optional.of(testInsight));
        when(insightRepository.save(any(AiInsight.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        AiInsight result = insightService.updateInsightStatus(venueId, insightId, AiInsight.Status.DISMISSED);
        
        assertNotNull(result);
        assertEquals(AiInsight.Status.DISMISSED, result.getStatus());
        verify(insightRepository, times(1)).findById(insightId);
        verify(insightRepository, times(1)).save(testInsight);
    }
    
    /**
     * Test updateInsightStatus throws exception when insight not found.
     * Requirement: 13.5
     */
    @Test
    void testUpdateInsightStatusNotFound() {
        when(insightRepository.findById(insightId)).thenReturn(Optional.empty());
        
        assertThrows(ResourceNotFoundException.class, () -> {
            insightService.updateInsightStatus(venueId, insightId, AiInsight.Status.ACTIONED);
        });
        
        verify(insightRepository, times(1)).findById(insightId);
        verify(insightRepository, never()).save(any());
    }
    
    /**
     * Test updateInsightStatus throws exception when insight belongs to different venue.
     * Requirement: 13.5
     */
    @Test
    void testUpdateInsightStatusWrongVenue() {
        UUID differentVenueId = UUID.randomUUID();
        when(insightRepository.findById(insightId)).thenReturn(Optional.of(testInsight));
        
        assertThrows(ResourceNotFoundException.class, () -> {
            insightService.updateInsightStatus(differentVenueId, insightId, AiInsight.Status.ACTIONED);
        });
        
        verify(insightRepository, times(1)).findById(insightId);
        verify(insightRepository, never()).save(any());
    }
    
    /**
     * Test updateInsightStatus throws exception when trying to update non-ACTIVE insight.
     * Requirement: 13.5
     */
    @Test
    void testUpdateInsightStatusAlreadyActioned() {
        testInsight.setStatus(AiInsight.Status.ACTIONED);
        when(insightRepository.findById(insightId)).thenReturn(Optional.of(testInsight));
        
        IllegalArgumentException exception = assertThrows(IllegalArgumentException.class, () -> {
            insightService.updateInsightStatus(venueId, insightId, AiInsight.Status.DISMISSED);
        });
        
        assertTrue(exception.getMessage().contains("Can only update status of ACTIVE insights"));
        verify(insightRepository, times(1)).findById(insightId);
        verify(insightRepository, never()).save(any());
    }
    
    /**
     * Test updateInsightStatus throws exception when trying to set status to ACTIVE.
     * Requirement: 13.5
     */
    @Test
    void testUpdateInsightStatusToActive() {
        IllegalArgumentException exception = assertThrows(IllegalArgumentException.class, () -> {
            insightService.updateInsightStatus(venueId, insightId, AiInsight.Status.ACTIVE);
        });
        
        assertTrue(exception.getMessage().contains("Status can only be updated to ACTIONED or DISMISSED"));
        verify(insightRepository, never()).findById(any());
        verify(insightRepository, never()).save(any());
    }
    
    /**
     * Test getInsight returns the correct insight.
     * Requirement: 13.7
     */
    @Test
    void testGetInsight() {
        when(insightRepository.findById(insightId)).thenReturn(Optional.of(testInsight));
        
        AiInsight result = insightService.getInsight(venueId, insightId);
        
        assertNotNull(result);
        assertEquals(insightId, result.getId());
        assertEquals(venueId, result.getVenueId());
        verify(insightRepository, times(1)).findById(insightId);
    }
    
    /**
     * Test getInsight throws exception when insight not found.
     * Requirement: 13.7
     */
    @Test
    void testGetInsightNotFound() {
        when(insightRepository.findById(insightId)).thenReturn(Optional.empty());
        
        assertThrows(ResourceNotFoundException.class, () -> {
            insightService.getInsight(venueId, insightId);
        });
        
        verify(insightRepository, times(1)).findById(insightId);
    }
    
    /**
     * Test getInsight throws exception when insight belongs to different venue.
     * Requirement: 13.7
     */
    @Test
    void testGetInsightWrongVenue() {
        UUID differentVenueId = UUID.randomUUID();
        when(insightRepository.findById(insightId)).thenReturn(Optional.of(testInsight));
        
        assertThrows(ResourceNotFoundException.class, () -> {
            insightService.getInsight(differentVenueId, insightId);
        });
        
        verify(insightRepository, times(1)).findById(insightId);
    }
    
    /**
     * Test checkDataAvailability when no Square connection exists.
     * Requirement: 13.1, 13.6
     */
    @Test
    void testCheckDataAvailabilityNoSquareConnection() {
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.empty());
        
        InsightDataAvailabilityResponse result = insightService.checkDataAvailability(venueId);
        
        assertNotNull(result);
        assertFalse(result.isHasSufficientData());
        assertEquals(0, result.getDaysOfData());
        assertNull(result.getEstimatedAvailableDate());
        assertTrue(result.getMessage().contains("connect your Square POS account"));
        verify(squareConnectionRepository, times(1)).findByVenueId(venueId);
    }
    
    /**
     * Test checkDataAvailability when Square connected but not synced yet.
     * Requirement: 13.1, 13.6
     */
    @Test
    void testCheckDataAvailabilityNotSyncedYet() {
        SquareConnection connection = new SquareConnection(
            venueId,
            "merchant-123",
            new byte[0],
            new byte[0],
            Instant.now().plusSeconds(3600)
        );
        connection.setLastSyncedAt(null); // Not synced yet
        
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(connection));
        
        InsightDataAvailabilityResponse result = insightService.checkDataAvailability(venueId);
        
        assertNotNull(result);
        assertFalse(result.isHasSufficientData());
        assertEquals(0, result.getDaysOfData());
        assertNotNull(result.getEstimatedAvailableDate());
        assertTrue(result.getMessage().contains("Waiting for initial data sync"));
        verify(squareConnectionRepository, times(1)).findByVenueId(venueId);
    }
    
    /**
     * Test checkDataAvailability when insufficient data (< 30 days).
     * Requirement: 13.1, 13.6
     */
    @Test
    void testCheckDataAvailabilityInsufficientData() {
        Instant createdAt = Instant.now().minus(15, java.time.temporal.ChronoUnit.DAYS);
        
        SquareConnection connection = new SquareConnection(
            venueId,
            "merchant-123",
            new byte[0],
            new byte[0],
            Instant.now().plusSeconds(3600)
        );
        connection.setCreatedAt(createdAt);
        connection.setLastSyncedAt(Instant.now());
        
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(connection));
        
        InsightDataAvailabilityResponse result = insightService.checkDataAvailability(venueId);
        
        assertNotNull(result);
        assertFalse(result.isHasSufficientData());
        assertTrue(result.getDaysOfData() >= 14 && result.getDaysOfData() <= 16); // Around 15 days
        assertNotNull(result.getEstimatedAvailableDate());
        assertTrue(result.getMessage().contains("at least 30 days"));
        verify(squareConnectionRepository, times(1)).findByVenueId(venueId);
    }
    
    /**
     * Test checkDataAvailability when sufficient data (>= 30 days).
     * Requirement: 13.1, 13.6
     */
    @Test
    void testCheckDataAvailabilitySufficientData() {
        Instant createdAt = Instant.now().minus(35, java.time.temporal.ChronoUnit.DAYS);
        
        SquareConnection connection = new SquareConnection(
            venueId,
            "merchant-123",
            new byte[0],
            new byte[0],
            Instant.now().plusSeconds(3600)
        );
        connection.setCreatedAt(createdAt);
        connection.setLastSyncedAt(Instant.now());
        
        when(squareConnectionRepository.findByVenueId(venueId)).thenReturn(Optional.of(connection));
        
        InsightDataAvailabilityResponse result = insightService.checkDataAvailability(venueId);
        
        assertNotNull(result);
        assertTrue(result.isHasSufficientData());
        assertTrue(result.getDaysOfData() >= 34 && result.getDaysOfData() <= 36); // Around 35 days
        assertNull(result.getEstimatedAvailableDate());
        assertTrue(result.getMessage().contains("AI insights are being generated"));
        verify(squareConnectionRepository, times(1)).findByVenueId(venueId);
    }
}
