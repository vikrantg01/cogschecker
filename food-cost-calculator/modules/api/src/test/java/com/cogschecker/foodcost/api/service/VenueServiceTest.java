package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Subscription;
import com.cogschecker.foodcost.api.domain.SubscriptionTier;
import com.cogschecker.foodcost.api.domain.Venue;
import com.cogschecker.foodcost.api.exception.DuplicateResourceException;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.exception.TierLimitExceededException;
import com.cogschecker.foodcost.api.repository.SubscriptionRepository;
import com.cogschecker.foodcost.api.repository.VenueRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for VenueService.
 * Requirements: 10.1, 10.2, 10.8, 11.1
 */
@ExtendWith(MockitoExtension.class)
class VenueServiceTest {
    
    @Mock
    private VenueRepository venueRepository;
    
    @Mock
    private SubscriptionRepository subscriptionRepository;
    
    @InjectMocks
    private VenueService venueService;
    
    private UUID organisationId;
    private UUID venueId;
    private Subscription freeSubscription;
    private Subscription proSubscription;
    
    @BeforeEach
    void setUp() {
        organisationId = UUID.randomUUID();
        venueId = UUID.randomUUID();
        
        freeSubscription = new Subscription(organisationId, SubscriptionTier.FREE);
        proSubscription = new Subscription(organisationId, SubscriptionTier.PRO);
    }
    
    // Create venue tests
    
    @Test
    void createVenue_success() {
        // Given
        String name = "Main Cafe";
        String address = "123 Main St";
        
        when(venueRepository.existsByOrganisationIdAndNameIgnoreCase(organisationId, name))
            .thenReturn(false);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(freeSubscription));
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(1L); // Below limit
        
        Venue savedVenue = new Venue(organisationId, name, address);
        when(venueRepository.save(any(Venue.class))).thenReturn(savedVenue);
        
        // When
        Venue result = venueService.createVenue(organisationId, name, address);
        
        // Then
        assertNotNull(result);
        assertEquals(name, result.getName());
        assertEquals(address, result.getAddress());
        assertEquals(organisationId, result.getOrganisationId());
        
        verify(venueRepository).save(any(Venue.class));
    }
    
    @Test
    void createVenue_duplicateName_throwsException() {
        // Given
        String name = "Duplicate Cafe";
        
        when(venueRepository.existsByOrganisationIdAndNameIgnoreCase(organisationId, name))
            .thenReturn(true);
        
        // When / Then
        assertThrows(DuplicateResourceException.class, () ->
            venueService.createVenue(organisationId, name, null)
        );
        
        verify(venueRepository, never()).save(any());
    }
    
    @Test
    void createVenue_freeTierLimit_throwsException() {
        // Given
        String name = "Third Cafe";
        
        when(venueRepository.existsByOrganisationIdAndNameIgnoreCase(organisationId, name))
            .thenReturn(false);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(freeSubscription));
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(2L); // At limit
        
        // When / Then
        TierLimitExceededException exception = assertThrows(TierLimitExceededException.class, () ->
            venueService.createVenue(organisationId, name, null)
        );
        
        assertTrue(exception.getMessage().contains("Free tier allows a maximum of 2 venues"));
        verify(venueRepository, never()).save(any());
    }
    
    @Test
    void createVenue_proTier_noLimit() {
        // Given
        String name = "Tenth Cafe";
        
        when(venueRepository.existsByOrganisationIdAndNameIgnoreCase(organisationId, name))
            .thenReturn(false);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(proSubscription));
        // No need to check count for Pro tier
        
        Venue savedVenue = new Venue(organisationId, name, null);
        when(venueRepository.save(any(Venue.class))).thenReturn(savedVenue);
        
        // When
        Venue result = venueService.createVenue(organisationId, name, null);
        
        // Then
        assertNotNull(result);
        verify(venueRepository).save(any(Venue.class));
        verify(venueRepository, never()).countByOrganisationIdAndDeletedAtIsNull(any());
    }
    
    @Test
    void createVenue_emptyName_throwsException() {
        // When / Then
        assertThrows(IllegalArgumentException.class, () ->
            venueService.createVenue(organisationId, "", null)
        );
        
        assertThrows(IllegalArgumentException.class, () ->
            venueService.createVenue(organisationId, "   ", null)
        );
        
        verify(venueRepository, never()).save(any());
    }
    
    @Test
    void createVenue_nameTooLong_throwsException() {
        // Given
        String longName = "A".repeat(101);
        
        // When / Then
        assertThrows(IllegalArgumentException.class, () ->
            venueService.createVenue(organisationId, longName, null)
        );
        
        verify(venueRepository, never()).save(any());
    }
    
    // Get venue tests
    
    @Test
    void getVenue_success() {
        // Given
        Venue venue = new Venue(organisationId, "Test Cafe", null);
        when(venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId))
            .thenReturn(Optional.of(venue));
        
        // When
        Venue result = venueService.getVenue(organisationId, venueId);
        
        // Then
        assertNotNull(result);
        assertEquals(venue, result);
    }
    
    @Test
    void getVenue_notFound_throwsException() {
        // Given
        when(venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId))
            .thenReturn(Optional.empty());
        
        // When / Then
        assertThrows(ResourceNotFoundException.class, () ->
            venueService.getVenue(organisationId, venueId)
        );
    }
    
    // Rename venue tests
    
    @Test
    void renameVenue_success() {
        // Given
        String newName = "Renamed Cafe";
        Venue venue = new Venue(organisationId, "Old Name", null);
        
        when(venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId))
            .thenReturn(Optional.of(venue));
        when(venueRepository.existsByOrganisationIdAndNameIgnoreCaseExcludingId(
            organisationId, newName, venueId))
            .thenReturn(false);
        when(venueRepository.save(any(Venue.class))).thenReturn(venue);
        
        // When
        Venue result = venueService.renameVenue(organisationId, venueId, newName);
        
        // Then
        assertNotNull(result);
        verify(venueRepository).save(any(Venue.class));
    }
    
    @Test
    void renameVenue_duplicateName_throwsException() {
        // Given
        String newName = "Existing Cafe";
        Venue venue = new Venue(organisationId, "Old Name", null);
        
        when(venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId))
            .thenReturn(Optional.of(venue));
        when(venueRepository.existsByOrganisationIdAndNameIgnoreCaseExcludingId(
            organisationId, newName, venueId))
            .thenReturn(true);
        
        // When / Then
        assertThrows(DuplicateResourceException.class, () ->
            venueService.renameVenue(organisationId, venueId, newName)
        );
        
        verify(venueRepository, never()).save(any());
    }
    
    @Test
    void renameVenue_sameNameNoChange_success() {
        // Given
        String sameName = "Same Cafe";
        Venue venue = new Venue(organisationId, sameName, null);
        
        when(venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId))
            .thenReturn(Optional.of(venue));
        
        // When
        Venue result = venueService.renameVenue(organisationId, venueId, sameName);
        
        // Then
        assertNotNull(result);
        assertEquals(sameName, result.getName());
        // Should not check for duplicates or save since name hasn't changed
        verify(venueRepository, never()).existsByOrganisationIdAndNameIgnoreCaseExcludingId(any(), any(), any());
        verify(venueRepository, never()).save(any());
    }
    
    // Update address tests
    
    @Test
    void updateVenueAddress_success() {
        // Given
        String newAddress = "456 New St";
        Venue venue = new Venue(organisationId, "Test Cafe", "Old Address");
        
        when(venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId))
            .thenReturn(Optional.of(venue));
        when(venueRepository.save(any(Venue.class))).thenReturn(venue);
        
        // When
        Venue result = venueService.updateVenueAddress(organisationId, venueId, newAddress);
        
        // Then
        assertNotNull(result);
        verify(venueRepository).save(any(Venue.class));
    }
    
    // Delete venue tests
    
    @Test
    void deleteVenue_success() {
        // Given
        Venue venue = new Venue(organisationId, "Test Cafe", null);
        
        when(venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId))
            .thenReturn(Optional.of(venue));
        when(venueRepository.save(any(Venue.class))).thenReturn(venue);
        
        // When
        venueService.deleteVenue(organisationId, venueId);
        
        // Then
        verify(venueRepository).save(any(Venue.class));
    }
    
    @Test
    void deleteVenue_notFound_throwsException() {
        // Given
        when(venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId))
            .thenReturn(Optional.empty());
        
        // When / Then
        assertThrows(ResourceNotFoundException.class, () ->
            venueService.deleteVenue(organisationId, venueId)
        );
        
        verify(venueRepository, never()).save(any());
    }
}
