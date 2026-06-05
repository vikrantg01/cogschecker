package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.*;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.exception.TierLimitExceededException;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SubscriptionHistoryRepository;
import com.cogschecker.foodcost.api.repository.SubscriptionRepository;
import com.cogschecker.foodcost.api.repository.VenueRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Unit tests for SubscriptionService.
 * Requirements: 11.4, 11.5, 11.6, 11.9
 */
@ExtendWith(MockitoExtension.class)
class SubscriptionServiceTest {
    
    @Mock
    private SubscriptionRepository subscriptionRepository;
    
    @Mock
    private VenueRepository venueRepository;
    
    @Mock
    private RecipeRepository recipeRepository;
    
    @Mock
    private SubscriptionHistoryRepository subscriptionHistoryRepository;
    
    @InjectMocks
    private SubscriptionService subscriptionService;
    
    private UUID organisationId;
    private Subscription subscription;
    
    @BeforeEach
    void setUp() {
        organisationId = UUID.randomUUID();
        subscription = new Subscription(organisationId, SubscriptionTier.FREE);
    }
    
    // Get subscription tests
    
    @Test
    void getSubscription_success() {
        // Given
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        
        // When
        Subscription result = subscriptionService.getSubscription(organisationId);
        
        // Then
        assertNotNull(result);
        assertEquals(subscription, result);
    }
    
    @Test
    void getSubscription_notFound_throwsException() {
        // Given
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.empty());
        
        // When / Then
        assertThrows(ResourceNotFoundException.class, () ->
            subscriptionService.getSubscription(organisationId)
        );
    }
    
    // Upgrade subscription tests
    
    @Test
    void upgradeSubscription_freeToProSuccess() {
        // Given
        String stripeCustomerId = "cus_123";
        String stripeSubscriptionId = "sub_123";
        Instant periodEnd = Instant.now().plusSeconds(2592000); // 30 days
        
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(subscriptionRepository.save(any(Subscription.class))).thenReturn(subscription);
        
        // When
        Subscription result = subscriptionService.upgradeSubscription(
            organisationId,
            SubscriptionTier.PRO,
            stripeCustomerId,
            stripeSubscriptionId,
            periodEnd
        );
        
        // Then
        assertNotNull(result);
        verify(subscriptionRepository).save(any(Subscription.class));
        verify(subscriptionHistoryRepository).save(any(SubscriptionHistory.class));
        
        // Verify history was recorded
        ArgumentCaptor<SubscriptionHistory> historyCaptor = ArgumentCaptor.forClass(SubscriptionHistory.class);
        verify(subscriptionHistoryRepository).save(historyCaptor.capture());
        SubscriptionHistory history = historyCaptor.getValue();
        assertEquals(SubscriptionEventType.UPGRADED, history.getEventType());
        assertEquals(SubscriptionTier.FREE, history.getFromTier());
        assertEquals(SubscriptionTier.PRO, history.getToTier());
    }
    
    @Test
    void upgradeSubscription_freeToProPlusSuccess() {
        // Given
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(subscriptionRepository.save(any(Subscription.class))).thenReturn(subscription);
        
        // When
        Subscription result = subscriptionService.upgradeSubscription(
            organisationId,
            SubscriptionTier.PRO_PLUS,
            "cus_123",
            "sub_123",
            Instant.now()
        );
        
        // Then
        assertNotNull(result);
        verify(subscriptionRepository).save(any(Subscription.class));
        verify(subscriptionHistoryRepository).save(any(SubscriptionHistory.class));
    }
    
    @Test
    void upgradeSubscription_proToProPlusSuccess() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(subscriptionRepository.save(any(Subscription.class))).thenReturn(subscription);
        
        // When
        Subscription result = subscriptionService.upgradeSubscription(
            organisationId,
            SubscriptionTier.PRO_PLUS,
            "cus_123",
            "sub_123",
            Instant.now()
        );
        
        // Then
        assertNotNull(result);
        verify(subscriptionRepository).save(any(Subscription.class));
    }
    
    @Test
    void upgradeSubscription_sameTier_throwsException() {
        // Given
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        
        // When / Then
        assertThrows(IllegalArgumentException.class, () ->
            subscriptionService.upgradeSubscription(
                organisationId,
                SubscriptionTier.FREE,
                "cus_123",
                "sub_123",
                Instant.now()
            )
        );
        
        verify(subscriptionRepository, never()).save(any());
    }
    
    @Test
    void upgradeSubscription_downgradeAttempt_throwsException() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        
        // When / Then
        assertThrows(IllegalArgumentException.class, () ->
            subscriptionService.upgradeSubscription(
                organisationId,
                SubscriptionTier.FREE,
                "cus_123",
                "sub_123",
                Instant.now()
            )
        );
        
        verify(subscriptionRepository, never()).save(any());
    }
    
    // Downgrade scheduling tests
    
    @Test
    void scheduleDowngrade_noConflicts_success() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(subscriptionRepository.save(any(Subscription.class))).thenReturn(subscription);
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(2L); // Within limit
        when(venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(Collections.emptyList()); // No venues with recipes
        
        // When
        Subscription result = subscriptionService.scheduleDowngrade(organisationId, SubscriptionTier.FREE);
        
        // Then
        assertNotNull(result);
        verify(subscriptionRepository).save(any(Subscription.class));
        verify(subscriptionHistoryRepository).save(any(SubscriptionHistory.class));
    }
    
    @Test
    void scheduleDowngrade_excessVenues_throwsException() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(3L); // Exceeds free tier limit of 2
        when(venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(Collections.emptyList());
        
        // When / Then
        TierLimitExceededException exception = assertThrows(TierLimitExceededException.class, () ->
            subscriptionService.scheduleDowngrade(organisationId, SubscriptionTier.FREE)
        );
        
        assertTrue(exception.getMessage().contains("too many venues"));
        verify(subscriptionRepository, never()).save(any());
    }
    
    @Test
    void scheduleDowngrade_excessRecipes_throwsException() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        UUID venueId = UUID.randomUUID();
        Venue venue = new Venue(organisationId, "Test Venue", null);
        venue.setId(venueId);
        
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(1L); // Within venue limit
        when(venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(List.of(venue));
        when(recipeRepository.countByVenueId(venueId))
            .thenReturn(30L); // Exceeds free tier limit of 25 per venue
        
        // When / Then
        TierLimitExceededException exception = assertThrows(TierLimitExceededException.class, () ->
            subscriptionService.scheduleDowngrade(organisationId, SubscriptionTier.FREE)
        );
        
        assertTrue(exception.getMessage().contains("too many recipes"));
        verify(subscriptionRepository, never()).save(any());
    }
    
    @Test
    void scheduleDowngrade_proToFreeMultipleConflicts_throwsException() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        UUID venueId1 = UUID.randomUUID();
        UUID venueId2 = UUID.randomUUID();
        UUID venueId3 = UUID.randomUUID();
        Venue venue1 = new Venue(organisationId, "Venue 1", null);
        venue1.setId(venueId1);
        Venue venue2 = new Venue(organisationId, "Venue 2", null);
        venue2.setId(venueId2);
        Venue venue3 = new Venue(organisationId, "Venue 3", null);
        venue3.setId(venueId3);
        
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(3L); // 1 excess venue
        when(venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(List.of(venue1, venue2, venue3));
        when(recipeRepository.countByVenueId(venueId1)).thenReturn(30L); // 5 excess recipes
        when(recipeRepository.countByVenueId(venueId2)).thenReturn(20L); // within limit
        when(recipeRepository.countByVenueId(venueId3)).thenReturn(28L); // 3 excess recipes
        
        // When / Then
        TierLimitExceededException exception = assertThrows(TierLimitExceededException.class, () ->
            subscriptionService.scheduleDowngrade(organisationId, SubscriptionTier.FREE)
        );
        
        String message = exception.getMessage();
        assertTrue(message.contains("too many venues"));
        assertTrue(message.contains("too many recipes"));
        verify(subscriptionRepository, never()).save(any());
    }
    
    @Test
    void scheduleDowngrade_proPlusToProNoConflicts_success() {
        // Given
        subscription.setTier(SubscriptionTier.PRO_PLUS);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(subscriptionRepository.save(any(Subscription.class))).thenReturn(subscription);
        // Pro tier has no limits, so no conflict checking needed
        
        // When
        Subscription result = subscriptionService.scheduleDowngrade(organisationId, SubscriptionTier.PRO);
        
        // Then
        assertNotNull(result);
        verify(subscriptionRepository).save(any(Subscription.class));
        verify(subscriptionHistoryRepository).save(any(SubscriptionHistory.class));
        // Should not check venues or recipes for PRO tier
        verify(venueRepository, never()).countByOrganisationIdAndDeletedAtIsNull(any());
        verify(venueRepository, never()).findByOrganisationIdAndDeletedAtIsNull(any());
    }
    
    // Cancel pending downgrade tests
    
    @Test
    void cancelPendingDowngrade_success() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        subscription.setPendingDowngradeTier(SubscriptionTier.FREE);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(subscriptionRepository.save(any(Subscription.class))).thenReturn(subscription);
        
        // When
        Subscription result = subscriptionService.cancelPendingDowngrade(organisationId);
        
        // Then
        assertNotNull(result);
        verify(subscriptionRepository).save(any(Subscription.class));
        verify(subscriptionHistoryRepository).save(any(SubscriptionHistory.class));
    }
    
    @Test
    void cancelPendingDowngrade_noPending_noChange() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        subscription.setPendingDowngradeTier(null);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        
        // When
        Subscription result = subscriptionService.cancelPendingDowngrade(organisationId);
        
        // Then
        assertNotNull(result);
        verify(subscriptionRepository, never()).save(any());
        verify(subscriptionHistoryRepository, never()).save(any());
    }
    
    // Execute pending downgrade tests
    
    @Test
    void executePendingDowngrade_success() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        subscription.setPendingDowngradeTier(SubscriptionTier.FREE);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(subscriptionRepository.save(any(Subscription.class))).thenReturn(subscription);
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(1L); // Within limit
        when(venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(Collections.emptyList());
        
        // When
        Optional<Subscription> result = subscriptionService.executePendingDowngrade(organisationId);
        
        // Then
        assertTrue(result.isPresent());
        verify(subscriptionRepository).save(any(Subscription.class));
        verify(subscriptionHistoryRepository).save(any(SubscriptionHistory.class));
    }
    
    @Test
    void executePendingDowngrade_noPending_empty() {
        // Given
        subscription.setPendingDowngradeTier(null);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        
        // When
        Optional<Subscription> result = subscriptionService.executePendingDowngrade(organisationId);
        
        // Then
        assertFalse(result.isPresent());
        verify(subscriptionRepository, never()).save(any());
    }
    
    @Test
    void executePendingDowngrade_conflictsStillExist_empty() {
        // Given
        subscription.setTier(SubscriptionTier.PRO);
        subscription.setPendingDowngradeTier(SubscriptionTier.FREE);
        when(subscriptionRepository.findByOrganisationId(organisationId))
            .thenReturn(Optional.of(subscription));
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(3L); // Exceeds limit
        when(venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(Collections.emptyList());
        
        // When
        Optional<Subscription> result = subscriptionService.executePendingDowngrade(organisationId);
        
        // Then
        assertFalse(result.isPresent());
        verify(subscriptionRepository, never()).save(any());
    }
    
    // Check downgrade conflicts tests
    
    @Test
    void checkDowngradeConflicts_noConflicts() {
        // Given
        when(venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(1L);
        when(venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId))
            .thenReturn(Collections.emptyList());
        
        // When
        SubscriptionService.DowngradeConflictCheck conflicts = 
            subscriptionService.checkDowngradeConflicts(organisationId, SubscriptionTier.FREE);
        
        // Then
        assertFalse(conflicts.hasConflicts());
        assertEquals(0, conflicts.getExcessVenueCount());
        assertTrue(conflicts.getVenuesWithExcessRecipes().isEmpty());
    }
    
    @Test
    void checkDowngradeConflicts_proTier_noChecks() {
        // Given / When
        SubscriptionService.DowngradeConflictCheck conflicts = 
            subscriptionService.checkDowngradeConflicts(organisationId, SubscriptionTier.PRO);
        
        // Then
        assertFalse(conflicts.hasConflicts());
        // Should not query repositories for Pro tier
        verify(venueRepository, never()).countByOrganisationIdAndDeletedAtIsNull(any());
        verify(venueRepository, never()).findByOrganisationIdAndDeletedAtIsNull(any());
    }
    
    // Get subscription history tests
    
    @Test
    void getSubscriptionHistory_success() {
        // Given
        List<SubscriptionHistory> history = List.of(
            new SubscriptionHistory(organisationId, SubscriptionEventType.UPGRADED, 
                SubscriptionTier.FREE, SubscriptionTier.PRO, "Upgraded"),
            new SubscriptionHistory(organisationId, SubscriptionEventType.CREATED, 
                null, SubscriptionTier.FREE, "Created")
        );
        when(subscriptionHistoryRepository.findByOrganisationIdOrderByCreatedAtDesc(organisationId))
            .thenReturn(history);
        
        // When
        List<SubscriptionHistory> result = subscriptionService.getSubscriptionHistory(organisationId);
        
        // Then
        assertNotNull(result);
        assertEquals(2, result.size());
        assertEquals(history, result);
    }
    
    @Test
    void getSubscriptionHistory_empty() {
        // Given
        when(subscriptionHistoryRepository.findByOrganisationIdOrderByCreatedAtDesc(organisationId))
            .thenReturn(Collections.emptyList());
        
        // When
        List<SubscriptionHistory> result = subscriptionService.getSubscriptionHistory(organisationId);
        
        // Then
        assertNotNull(result);
        assertTrue(result.isEmpty());
    }
}
