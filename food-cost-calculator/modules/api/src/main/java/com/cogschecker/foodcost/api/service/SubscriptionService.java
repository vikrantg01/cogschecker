package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Subscription;
import com.cogschecker.foodcost.api.domain.SubscriptionEventType;
import com.cogschecker.foodcost.api.domain.SubscriptionHistory;
import com.cogschecker.foodcost.api.domain.SubscriptionTier;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.exception.TierLimitExceededException;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SubscriptionHistoryRepository;
import com.cogschecker.foodcost.api.repository.SubscriptionRepository;
import com.cogschecker.foodcost.api.repository.VenueRepository;
import com.cogschecker.foodcost.shared.ErrorCodes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

/**
 * Service for managing subscription tiers with business rule enforcement.
 * Requirements: 11.4, 11.5, 11.6, 11.9
 */
@Service
@Transactional
public class SubscriptionService {
    
    private static final Logger logger = LoggerFactory.getLogger(SubscriptionService.class);
    
    // Tier limits from Requirement 11.2
    private static final int FREE_TIER_VENUE_LIMIT = 2;
    private static final int FREE_TIER_RECIPE_LIMIT_PER_VENUE = 25;
    
    private final SubscriptionRepository subscriptionRepository;
    private final VenueRepository venueRepository;
    private final RecipeRepository recipeRepository;
    private final SubscriptionHistoryRepository subscriptionHistoryRepository;
    
    public SubscriptionService(
            SubscriptionRepository subscriptionRepository,
            VenueRepository venueRepository,
            RecipeRepository recipeRepository,
            SubscriptionHistoryRepository subscriptionHistoryRepository) {
        this.subscriptionRepository = subscriptionRepository;
        this.venueRepository = venueRepository;
        this.recipeRepository = recipeRepository;
        this.subscriptionHistoryRepository = subscriptionHistoryRepository;
    }
    
    /**
     * Get the subscription for an organisation.
     * Requirement 11.7
     * 
     * @param organisationId the organisation ID
     * @return the subscription
     * @throws ResourceNotFoundException if subscription not found
     */
    @Transactional(readOnly = true)
    public Subscription getSubscription(UUID organisationId) {
        return subscriptionRepository.findByOrganisationId(organisationId)
            .orElseThrow(() -> new ResourceNotFoundException(
                ErrorCodes.SUBSCRIPTION_NOT_FOUND,
                String.format("Subscription not found for organisation %s", organisationId)
            ));
    }
    
    /**
     * Upgrade an organisation's subscription tier.
     * Requirement 11.4
     * 
     * Upgrade paths:
     * - FREE -> PRO
     * - FREE -> PRO_PLUS
     * - PRO -> PRO_PLUS
     * 
     * Note: This method handles the tier upgrade logic. Integration with Stripe for
     * payment processing should be handled by the controller layer.
     * 
     * @param organisationId the organisation ID
     * @param targetTier the target tier
     * @return the updated subscription
     * @throws IllegalArgumentException if the upgrade path is invalid
     */
    public Subscription upgradeSubscription(
            UUID organisationId,
            SubscriptionTier targetTier,
            String stripeCustomerId,
            String stripeSubscriptionId,
            Instant currentPeriodEnd) {
        
        logger.info("Upgrading subscription for organisation {} to {}", organisationId, targetTier);
        
        Subscription subscription = getSubscription(organisationId);
        SubscriptionTier currentTier = subscription.getTier();
        
        // Validate upgrade path
        validateUpgradePath(currentTier, targetTier);
        
        // Update subscription
        subscription.setTier(targetTier);
        subscription.setStripeCustomerId(stripeCustomerId);
        subscription.setStripeSubscriptionId(stripeSubscriptionId);
        subscription.setCurrentPeriodEnd(currentPeriodEnd);
        
        // Clear any pending downgrade
        subscription.setPendingDowngradeTier(null);
        
        // Clear payment failed flag
        subscription.setPaymentFailedAt(null);
        
        Subscription updated = subscriptionRepository.save(subscription);
        
        // Record history
        recordHistory(
            organisationId,
            SubscriptionEventType.UPGRADED,
            currentTier,
            targetTier,
            String.format("Upgraded from %s to %s", currentTier, targetTier)
        );
        
        logger.info("Upgraded subscription for organisation {} from {} to {}",
            organisationId, currentTier, targetTier);
        
        // TODO: Update Cognito custom:tier attribute for all users in the organisation
        // This will be implemented in the controller layer
        
        return updated;
    }
    
    /**
     * Schedule a downgrade of an organisation's subscription tier.
     * Requirement 11.5, 11.6
     * 
     * The downgrade is scheduled to take effect at the end of the current billing period.
     * Before scheduling, the method checks for conflicts (e.g., too many venues or recipes
     * for the target tier).
     * 
     * @param organisationId the organisation ID
     * @param targetTier the target tier
     * @return the updated subscription with pending downgrade scheduled
     * @throws IllegalArgumentException if the downgrade path is invalid
     * @throws TierLimitExceededException if the organisation exceeds the target tier's limits
     */
    public Subscription scheduleDowngrade(UUID organisationId, SubscriptionTier targetTier) {
        logger.info("Scheduling downgrade for organisation {} to {}", organisationId, targetTier);
        
        Subscription subscription = getSubscription(organisationId);
        SubscriptionTier currentTier = subscription.getTier();
        
        // Validate downgrade path
        validateDowngradePath(currentTier, targetTier);
        
        // Check for conflicts - Requirement 11.6
        DowngradeConflictCheck conflicts = checkDowngradeConflicts(organisationId, targetTier);
        
        if (conflicts.hasConflicts()) {
            logger.warn("Downgrade conflicts detected for organisation {}: {}", 
                organisationId, conflicts);
            throw new TierLimitExceededException(
                ErrorCodes.SUBSCRIPTION_DOWNGRADE_CONFLICT,
                buildConflictMessage(conflicts, targetTier)
            );
        }
        
        // Schedule the downgrade
        subscription.setPendingDowngradeTier(targetTier);
        
        Subscription updated = subscriptionRepository.save(subscription);
        
        // Record history
        recordHistory(
            organisationId,
            SubscriptionEventType.DOWNGRADE_SCHEDULED,
            currentTier,
            targetTier,
            String.format("Scheduled downgrade from %s to %s", currentTier, targetTier)
        );
        
        logger.info("Scheduled downgrade for organisation {} from {} to {} at end of billing period",
            organisationId, currentTier, targetTier);
        
        return updated;
    }
    
    /**
     * Cancel a pending downgrade.
     * 
     * @param organisationId the organisation ID
     * @return the updated subscription
     */
    public Subscription cancelPendingDowngrade(UUID organisationId) {
        logger.info("Cancelling pending downgrade for organisation {}", organisationId);
        
        Subscription subscription = getSubscription(organisationId);
        
        if (subscription.getPendingDowngradeTier() == null) {
            logger.warn("No pending downgrade found for organisation {}", organisationId);
            return subscription;
        }
        
        SubscriptionTier pendingTier = subscription.getPendingDowngradeTier();
        
        subscription.setPendingDowngradeTier(null);
        Subscription updated = subscriptionRepository.save(subscription);
        
        // Record history
        recordHistory(
            organisationId,
            SubscriptionEventType.DOWNGRADE_CANCELLED,
            subscription.getTier(),
            pendingTier,
            String.format("Cancelled scheduled downgrade to %s", pendingTier)
        );
        
        logger.info("Cancelled pending downgrade for organisation {}", organisationId);
        
        return updated;
    }
    
    /**
     * Execute a pending downgrade (called by a scheduled job at billing period end).
     * Requirement 11.5
     * 
     * @param organisationId the organisation ID
     * @return the updated subscription, or empty if no pending downgrade
     */
    public Optional<Subscription> executePendingDowngrade(UUID organisationId) {
        logger.info("Executing pending downgrade for organisation {}", organisationId);
        
        Subscription subscription = getSubscription(organisationId);
        
        if (subscription.getPendingDowngradeTier() == null) {
            logger.debug("No pending downgrade for organisation {}", organisationId);
            return Optional.empty();
        }
        
        // Re-check conflicts before executing
        DowngradeConflictCheck conflicts = checkDowngradeConflicts(
            organisationId, 
            subscription.getPendingDowngradeTier()
        );
        
        if (conflicts.hasConflicts()) {
            logger.error("Cannot execute downgrade for organisation {} due to conflicts: {}",
                organisationId, conflicts);
            // Don't throw - this is a scheduled job. Log and preserve pending state.
            // Admin will need to resolve conflicts manually.
            return Optional.empty();
        }
        
        SubscriptionTier targetTier = subscription.getPendingDowngradeTier();
        SubscriptionTier currentTier = subscription.getTier();
        subscription.setTier(targetTier);
        subscription.setPendingDowngradeTier(null);
        
        Subscription updated = subscriptionRepository.save(subscription);
        
        // Record history
        recordHistory(
            organisationId,
            SubscriptionEventType.DOWNGRADED,
            currentTier,
            targetTier,
            String.format("Downgraded from %s to %s", currentTier, targetTier)
        );
        
        logger.info("Executed downgrade for organisation {} to {}", organisationId, targetTier);
        
        // TODO: Update Cognito custom:tier attribute for all users in the organisation
        
        return Optional.of(updated);
    }
    
    /**
     * Check if downgrading to a target tier would violate tier limits.
     * Requirement 11.6
     * 
     * @param organisationId the organisation ID
     * @param targetTier the target tier
     * @return conflict information
     */
    @Transactional(readOnly = true)
    public DowngradeConflictCheck checkDowngradeConflicts(
            UUID organisationId, 
            SubscriptionTier targetTier) {
        
        DowngradeConflictCheck conflicts = new DowngradeConflictCheck();
        
        // Only FREE tier has limits (Requirement 11.2)
        if (targetTier != SubscriptionTier.FREE) {
            return conflicts; // No conflicts for PRO or PRO_PLUS
        }
        
        // Check venue count limit
        long venueCount = venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId);
        if (venueCount > FREE_TIER_VENUE_LIMIT) {
            conflicts.setExcessVenueCount((int) (venueCount - FREE_TIER_VENUE_LIMIT));
        }
        
        // Check recipe count limit per venue
        List<UUID> venues = venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId)
            .stream()
            .map(venue -> venue.getId())
            .toList();
        
        Map<UUID, Integer> excessRecipeCounts = new HashMap<>();
        for (UUID venueId : venues) {
            long recipeCount = recipeRepository.countByVenueId(venueId);
            if (recipeCount > FREE_TIER_RECIPE_LIMIT_PER_VENUE) {
                excessRecipeCounts.put(venueId, (int) (recipeCount - FREE_TIER_RECIPE_LIMIT_PER_VENUE));
            }
        }
        
        if (!excessRecipeCounts.isEmpty()) {
            conflicts.setVenuesWithExcessRecipes(excessRecipeCounts);
        }
        
        return conflicts;
    }
    
    /**
     * Get subscription history for an organisation.
     * Requirement 11.9
     * 
     * @param organisationId the organisation ID
     * @return list of history entries, ordered by most recent first
     */
    @Transactional(readOnly = true)
    public List<SubscriptionHistory> getSubscriptionHistory(UUID organisationId) {
        return subscriptionHistoryRepository.findByOrganisationIdOrderByCreatedAtDesc(organisationId);
    }
    
    // Private helper methods
    
    /**
     * Record a subscription history event.
     */
    private void recordHistory(
            UUID organisationId,
            SubscriptionEventType eventType,
            SubscriptionTier fromTier,
            SubscriptionTier toTier,
            String description) {
        
        SubscriptionHistory history = new SubscriptionHistory(
            organisationId,
            eventType,
            fromTier,
            toTier,
            description
        );
        
        subscriptionHistoryRepository.save(history);
        logger.debug("Recorded subscription history for organisation {}: {}", organisationId, eventType);
    }
    
    /**
     * Validate that the upgrade path is valid.
     * Valid paths: FREE -> PRO, FREE -> PRO_PLUS, PRO -> PRO_PLUS
     */
    private void validateUpgradePath(SubscriptionTier current, SubscriptionTier target) {
        if (current == target) {
            throw new IllegalArgumentException(
                String.format("Already on tier %s", current)
            );
        }
        
        if (current.ordinal() > target.ordinal()) {
            throw new IllegalArgumentException(
                String.format("Cannot upgrade from %s to %s. Use downgrade instead.", current, target)
            );
        }
        
        // All upward moves are valid (FREE->PRO, FREE->PRO_PLUS, PRO->PRO_PLUS)
    }
    
    /**
     * Validate that the downgrade path is valid.
     * Valid paths: PRO_PLUS -> PRO, PRO_PLUS -> FREE, PRO -> FREE
     */
    private void validateDowngradePath(SubscriptionTier current, SubscriptionTier target) {
        if (current == target) {
            throw new IllegalArgumentException(
                String.format("Already on tier %s", current)
            );
        }
        
        if (current.ordinal() < target.ordinal()) {
            throw new IllegalArgumentException(
                String.format("Cannot downgrade from %s to %s. Use upgrade instead.", current, target)
            );
        }
        
        // All downward moves are valid (PRO_PLUS->PRO, PRO_PLUS->FREE, PRO->FREE)
    }
    
    /**
     * Build a user-friendly conflict message for downgrade conflicts.
     */
    private String buildConflictMessage(DowngradeConflictCheck conflicts, SubscriptionTier targetTier) {
        StringBuilder message = new StringBuilder();
        message.append(String.format("Cannot downgrade to %s tier due to the following conflicts:\n", targetTier));
        
        if (conflicts.getExcessVenueCount() > 0) {
            message.append(String.format(
                "- You have %d too many venues. %s tier allows a maximum of %d venues.\n",
                conflicts.getExcessVenueCount(),
                targetTier,
                FREE_TIER_VENUE_LIMIT
            ));
        }
        
        if (!conflicts.getVenuesWithExcessRecipes().isEmpty()) {
            message.append(String.format(
                "- The following venues have too many recipes (%s tier allows maximum %d recipes per venue):\n",
                targetTier,
                FREE_TIER_RECIPE_LIMIT_PER_VENUE
            ));
            
            conflicts.getVenuesWithExcessRecipes().forEach((venueId, excessCount) -> {
                message.append(String.format("  • Venue %s: %d excess recipes\n", venueId, excessCount));
            });
        }
        
        message.append("\nPlease delete the excess venues or recipes before attempting to downgrade.");
        
        return message.toString();
    }
    
    /**
     * Inner class to hold downgrade conflict information.
     */
    public static class DowngradeConflictCheck {
        private int excessVenueCount = 0;
        private Map<UUID, Integer> venuesWithExcessRecipes = new HashMap<>();
        
        public boolean hasConflicts() {
            return excessVenueCount > 0 || !venuesWithExcessRecipes.isEmpty();
        }
        
        public int getExcessVenueCount() {
            return excessVenueCount;
        }
        
        public void setExcessVenueCount(int excessVenueCount) {
            this.excessVenueCount = excessVenueCount;
        }
        
        public Map<UUID, Integer> getVenuesWithExcessRecipes() {
            return venuesWithExcessRecipes;
        }
        
        public void setVenuesWithExcessRecipes(Map<UUID, Integer> venuesWithExcessRecipes) {
            this.venuesWithExcessRecipes = venuesWithExcessRecipes;
        }
        
        @Override
        public String toString() {
            return String.format("DowngradeConflictCheck{excessVenueCount=%d, venuesWithExcessRecipes=%s}",
                excessVenueCount, venuesWithExcessRecipes);
        }
    }
}
