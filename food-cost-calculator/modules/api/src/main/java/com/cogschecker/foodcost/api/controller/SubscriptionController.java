package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Subscription;
import com.cogschecker.foodcost.api.domain.SubscriptionHistory;
import com.cogschecker.foodcost.api.dto.*;
import com.cogschecker.foodcost.api.service.SubscriptionService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * REST controller for subscription tier management operations.
 * Requirements: 11.1, 11.4, 11.5, 11.6, 11.7, 11.9
 */
@RestController
@RequestMapping("/api/v1/organisations/{orgId}/subscription")
public class SubscriptionController {

    private static final Logger logger = LoggerFactory.getLogger(SubscriptionController.class);

    private final SubscriptionService subscriptionService;

    public SubscriptionController(SubscriptionService subscriptionService) {
        this.subscriptionService = subscriptionService;
    }

    /**
     * Get current subscription details.
     * Requirements: 11.1, 11.7
     *
     * GET /api/v1/organisations/:orgId/subscription
     *
     * @param orgId the organisation ID
     * @return subscription details including current tier and billing info
     */
    @GetMapping
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<SubscriptionResponse> getSubscription(@PathVariable UUID orgId) {
        logger.info("GET /organisations/{}/subscription - getting subscription details", orgId);

        Subscription subscription = subscriptionService.getSubscription(orgId);

        SubscriptionResponse response = toSubscriptionResponse(subscription);

        return ResponseEntity.ok(response);
    }

    /**
     * Upgrade subscription tier.
     * Requirements: 11.4
     *
     * POST /api/v1/organisations/:orgId/subscription/upgrade
     * {
     *   "targetTier": "PRO",
     *   "stripeCustomerId": "cus_...",
     *   "stripeSubscriptionId": "sub_...",
     *   "currentPeriodEnd": "2024-01-31T23:59:59Z"
     * }
     *
     * Note: The controller expects that Stripe payment processing has already been
     * completed by the frontend/payment service before calling this endpoint.
     * This endpoint updates the subscription tier and records the Stripe IDs.
     *
     * Valid upgrade paths:
     * - FREE -> PRO
     * - FREE -> PRO_PLUS
     * - PRO -> PRO_PLUS
     *
     * @param orgId the organisation ID
     * @param request the upgrade request containing target tier and Stripe details
     * @return the updated subscription with HTTP 200
     */
    @PostMapping("/upgrade")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<SubscriptionResponse> upgradeSubscription(
            @PathVariable UUID orgId,
            @Valid @RequestBody UpgradeSubscriptionRequest request) {

        logger.info("POST /organisations/{}/subscription/upgrade - upgrading to {}",
                orgId, request.getTargetTier());

        Subscription subscription = subscriptionService.upgradeSubscription(
                orgId,
                request.getTargetTier(),
                request.getStripeCustomerId(),
                request.getStripeSubscriptionId(),
                request.getCurrentPeriodEnd()
        );

        SubscriptionResponse response = toSubscriptionResponse(subscription);

        logger.info("Successfully upgraded subscription for organisation {} to {}",
                orgId, request.getTargetTier());

        return ResponseEntity.ok(response);
    }

    /**
     * Schedule subscription downgrade.
     * Requirements: 11.5, 11.6
     *
     * POST /api/v1/organisations/:orgId/subscription/downgrade
     * {
     *   "targetTier": "FREE"
     * }
     *
     * The downgrade is scheduled to take effect at the end of the current billing period.
     * Before scheduling, the endpoint checks for conflicts (e.g., too many venues or recipes
     * for the target tier).
     *
     * If conflicts exist, returns HTTP 409 with detailed conflict information.
     *
     * Valid downgrade paths:
     * - PRO_PLUS -> PRO
     * - PRO_PLUS -> FREE
     * - PRO -> FREE
     *
     * @param orgId the organisation ID
     * @param request the downgrade request containing target tier
     * @return the updated subscription with pending downgrade scheduled, HTTP 200
     * @throws com.cogschecker.foodcost.api.exception.TierLimitExceededException if conflicts exist (HTTP 409)
     */
    @PostMapping("/downgrade")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<SubscriptionResponse> scheduleDowngrade(
            @PathVariable UUID orgId,
            @Valid @RequestBody DowngradeSubscriptionRequest request) {

        logger.info("POST /organisations/{}/subscription/downgrade - scheduling downgrade to {}",
                orgId, request.getTargetTier());

        Subscription subscription = subscriptionService.scheduleDowngrade(
                orgId,
                request.getTargetTier()
        );

        SubscriptionResponse response = toSubscriptionResponse(subscription);

        logger.info("Successfully scheduled downgrade for organisation {} to {} at end of billing period",
                orgId, request.getTargetTier());

        return ResponseEntity.ok(response);
    }

    /**
     * Cancel a pending downgrade.
     * Requirements: 11.5
     *
     * DELETE /api/v1/organisations/:orgId/subscription/downgrade
     *
     * Cancels a previously scheduled downgrade, keeping the organisation on the current tier.
     *
     * @param orgId the organisation ID
     * @return the updated subscription with pending downgrade removed, HTTP 200
     */
    @DeleteMapping("/downgrade")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<SubscriptionResponse> cancelPendingDowngrade(@PathVariable UUID orgId) {

        logger.info("DELETE /organisations/{}/subscription/downgrade - cancelling pending downgrade", orgId);

        Subscription subscription = subscriptionService.cancelPendingDowngrade(orgId);

        SubscriptionResponse response = toSubscriptionResponse(subscription);

        logger.info("Successfully cancelled pending downgrade for organisation {}", orgId);

        return ResponseEntity.ok(response);
    }

    /**
     * Check for downgrade conflicts.
     * Requirements: 11.6
     *
     * GET /api/v1/organisations/:orgId/subscription/downgrade-conflicts?targetTier=FREE
     *
     * Checks if downgrading to the target tier would violate tier limits.
     * Returns conflict information including:
     * - Number of excess venues (if any)
     * - Map of venue IDs to excess recipe counts (if any)
     *
     * This is useful for the frontend to display conflict information before
     * attempting a downgrade.
     *
     * @param orgId the organisation ID
     * @param targetTier the target tier to check
     * @return conflict information
     */
    @GetMapping("/downgrade-conflicts")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<DowngradeConflictResponse> checkDowngradeConflicts(
            @PathVariable UUID orgId,
            @RequestParam String targetTier) {

        logger.info("GET /organisations/{}/subscription/downgrade-conflicts?targetTier={} - checking conflicts",
                orgId, targetTier);

        SubscriptionService.DowngradeConflictCheck conflicts = 
                subscriptionService.checkDowngradeConflicts(orgId, 
                        com.cogschecker.foodcost.api.domain.SubscriptionTier.valueOf(targetTier));

        DowngradeConflictResponse response = new DowngradeConflictResponse(
                conflicts.getExcessVenueCount(),
                conflicts.getVenuesWithExcessRecipes()
        );

        return ResponseEntity.ok(response);
    }

    /**
     * Get subscription history.
     * Requirements: 11.9
     *
     * GET /api/v1/organisations/:orgId/subscription/history
     *
     * Returns a list of past tier changes and payment events, ordered by most recent first.
     *
     * @param orgId the organisation ID
     * @return list of subscription history entries
     */
    @GetMapping("/history")
    @PreAuthorize("hasOrganisationRole('ADMIN', #orgId)")
    public ResponseEntity<List<SubscriptionHistoryResponse>> getSubscriptionHistory(
            @PathVariable UUID orgId) {

        logger.info("GET /organisations/{}/subscription/history - getting subscription history", orgId);

        List<SubscriptionHistory> history = subscriptionService.getSubscriptionHistory(orgId);

        List<SubscriptionHistoryResponse> responses = history.stream()
                .map(this::toSubscriptionHistoryResponse)
                .collect(Collectors.toList());

        return ResponseEntity.ok(responses);
    }

    // ===== Helper Methods =====

    /**
     * Convert Subscription entity to SubscriptionResponse DTO.
     */
    private SubscriptionResponse toSubscriptionResponse(Subscription subscription) {
        return new SubscriptionResponse(
                subscription.getId(),
                subscription.getOrganisationId(),
                subscription.getTier(),
                subscription.getStripeCustomerId(),
                subscription.getStripeSubscriptionId(),
                subscription.getCurrentPeriodEnd(),
                subscription.getPendingDowngradeTier(),
                subscription.getPaymentFailedAt(),
                subscription.getCreatedAt(),
                subscription.getUpdatedAt()
        );
    }

    /**
     * Convert SubscriptionHistory entity to SubscriptionHistoryResponse DTO.
     */
    private SubscriptionHistoryResponse toSubscriptionHistoryResponse(SubscriptionHistory history) {
        return new SubscriptionHistoryResponse(
                history.getId(),
                history.getOrganisationId(),
                history.getEventType(),
                history.getFromTier(),
                history.getToTier(),
                history.getStripeEventId(),
                history.getDescription(),
                history.getCreatedAt()
        );
    }
}
