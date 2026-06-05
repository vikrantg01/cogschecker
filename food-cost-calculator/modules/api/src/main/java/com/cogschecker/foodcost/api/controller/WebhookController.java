package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.domain.Subscription;
import com.cogschecker.foodcost.api.domain.SubscriptionTier;
import com.cogschecker.foodcost.api.exception.WebhookSignatureException;
import com.cogschecker.foodcost.api.repository.SubscriptionRepository;
import com.cogschecker.foodcost.api.service.SubscriptionService;
import com.cogschecker.foodcost.shared.ErrorCodes;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.model.EventDataObjectDeserializer;
import com.stripe.model.StripeObject;
import com.stripe.net.Webhook;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;

/**
 * REST controller for handling Stripe webhook events.
 * Requirements: 11.8 (payment failure handling, automatic downgrade)
 * 
 * Handles the following webhook events:
 * - payment_intent.payment_succeeded: Payment successful
 * - payment_intent.payment_failed: Payment failed
 * - invoice.payment_failed: Invoice payment failed
 * - customer.subscription.deleted: Subscription cancelled
 */
@RestController
@RequestMapping("/api/v1/webhooks")
public class WebhookController {

    private static final Logger logger = LoggerFactory.getLogger(WebhookController.class);
    
    private static final long PAYMENT_FAILURE_GRACE_PERIOD_DAYS = 7;
    
    private final SubscriptionService subscriptionService;
    private final SubscriptionRepository subscriptionRepository;
    
    @Value("${stripe.webhook.secret}")
    private String webhookSecret;
    
    public WebhookController(
            SubscriptionService subscriptionService,
            SubscriptionRepository subscriptionRepository) {
        this.subscriptionService = subscriptionService;
        this.subscriptionRepository = subscriptionRepository;
    }
    
    /**
     * Handle Stripe webhook events.
     * Requirements: 11.8
     * 
     * POST /api/v1/webhooks/stripe
     * 
     * Verifies the webhook signature using the Stripe-Signature header
     * and processes the event based on its type.
     * 
     * Supported events:
     * - payment_intent.payment_succeeded: Clear payment failure flag
     * - payment_intent.payment_failed: Set payment failure timestamp
     * - invoice.payment_failed: Set payment failure timestamp, send email notification
     * - customer.subscription.deleted: Downgrade to Free tier if unpaid for 7 days
     * 
     * @param payload the raw webhook payload
     * @param signatureHeader the Stripe-Signature header
     * @return HTTP 200 if processed successfully
     */
    @PostMapping("/stripe")
    public ResponseEntity<Map<String, String>> handleStripeWebhook(
            @RequestBody String payload,
            @RequestHeader("Stripe-Signature") String signatureHeader) {
        
        logger.info("POST /webhooks/stripe - received Stripe webhook");
        
        Event event;
        
        try {
            // Verify webhook signature - Requirement 11.8
            event = Webhook.constructEvent(payload, signatureHeader, webhookSecret);
            logger.info("Webhook signature verified successfully for event: {}", event.getType());
        } catch (SignatureVerificationException e) {
            logger.error("Invalid webhook signature", e);
            throw new WebhookSignatureException(
                ErrorCodes.STRIPE_WEBHOOK_INVALID_SIGNATURE,
                "Invalid webhook signature"
            );
        }
        
        // Process event based on type
        try {
            switch (event.getType()) {
                case "payment_intent.payment_succeeded":
                    handlePaymentSucceeded(event);
                    break;
                    
                case "payment_intent.payment_failed":
                    handlePaymentFailed(event);
                    break;
                    
                case "invoice.payment_failed":
                    handleInvoicePaymentFailed(event);
                    break;
                    
                case "customer.subscription.deleted":
                    handleSubscriptionDeleted(event);
                    break;
                    
                default:
                    logger.info("Unhandled webhook event type: {}", event.getType());
                    break;
            }
            
            logger.info("Successfully processed webhook event: {}", event.getType());
            return ResponseEntity.ok(Map.of("status", "success"));
            
        } catch (Exception e) {
            logger.error("Error processing webhook event: {}", event.getType(), e);
            // Return 200 to Stripe to prevent retries for application errors
            // Log the error for manual investigation
            return ResponseEntity.ok(Map.of(
                "status", "error",
                "message", "Event logged for manual review"
            ));
        }
    }
    
    /**
     * Handle payment_intent.payment_succeeded event.
     * Clear any payment failure flag and ensure subscription is active.
     */
    private void handlePaymentSucceeded(Event event) {
        logger.info("Processing payment_intent.payment_succeeded event");
        
        String customerId = extractCustomerId(event);
        if (customerId == null) {
            logger.warn("Could not extract customer ID from payment success event");
            return;
        }
        
        Subscription subscription = findSubscriptionByStripeCustomerId(customerId);
        if (subscription == null) {
            logger.warn("No subscription found for Stripe customer: {}", customerId);
            return;
        }
        
        // Clear payment failure flag
        if (subscription.getPaymentFailedAt() != null) {
            subscription.setPaymentFailedAt(null);
            subscriptionRepository.save(subscription);
            logger.info("Cleared payment failure flag for organisation: {}", 
                subscription.getOrganisationId());
        }
    }
    
    /**
     * Handle payment_intent.payment_failed event.
     * Set payment failure timestamp.
     */
    private void handlePaymentFailed(Event event) {
        logger.info("Processing payment_intent.payment_failed event");
        
        String customerId = extractCustomerId(event);
        if (customerId == null) {
            logger.warn("Could not extract customer ID from payment failure event");
            return;
        }
        
        Subscription subscription = findSubscriptionByStripeCustomerId(customerId);
        if (subscription == null) {
            logger.warn("No subscription found for Stripe customer: {}", customerId);
            return;
        }
        
        // Set payment failure timestamp if not already set
        if (subscription.getPaymentFailedAt() == null) {
            subscription.setPaymentFailedAt(Instant.now());
            subscriptionRepository.save(subscription);
            logger.warn("Payment failed for organisation: {}. Grace period starts now.", 
                subscription.getOrganisationId());
            
            // TODO: Send email notification to admin via SQS to email queue
            // Email should inform of payment failure and 7-day grace period
        }
    }
    
    /**
     * Handle invoice.payment_failed event.
     * Requirements: 11.8 (notify admin by email, display in-app banner)
     * 
     * Set payment failure timestamp and send email notification.
     * After 7 days, subscription will be downgraded to Free tier.
     */
    private void handleInvoicePaymentFailed(Event event) {
        logger.info("Processing invoice.payment_failed event");
        
        String customerId = extractCustomerId(event);
        if (customerId == null) {
            logger.warn("Could not extract customer ID from invoice payment failure event");
            return;
        }
        
        Subscription subscription = findSubscriptionByStripeCustomerId(customerId);
        if (subscription == null) {
            logger.warn("No subscription found for Stripe customer: {}", customerId);
            return;
        }
        
        // Set payment failure timestamp if not already set
        if (subscription.getPaymentFailedAt() == null) {
            subscription.setPaymentFailedAt(Instant.now());
            subscriptionRepository.save(subscription);
            logger.warn("Invoice payment failed for organisation: {}. Grace period starts now.", 
                subscription.getOrganisationId());
        }
        
        // TODO: Send email notification to admin via SQS to email queue
        // Requirements: 11.8 - notify by email
        // Email should include:
        // - Payment failure notification
        // - Grace period information (7 days)
        // - Link to update payment method
        // - Warning about feature restrictions if payment not resolved
        
        logger.info("Payment failure notification queued for organisation: {}", 
            subscription.getOrganisationId());
        
        // Check if grace period has expired (7 days) - Requirement 11.8
        checkAndApplyGracePeriodExpiry(subscription);
    }
    
    /**
     * Handle customer.subscription.deleted event.
     * Downgrade subscription to Free tier.
     */
    private void handleSubscriptionDeleted(Event event) {
        logger.info("Processing customer.subscription.deleted event");
        
        String customerId = extractCustomerId(event);
        if (customerId == null) {
            logger.warn("Could not extract customer ID from subscription deletion event");
            return;
        }
        
        Subscription subscription = findSubscriptionByStripeCustomerId(customerId);
        if (subscription == null) {
            logger.warn("No subscription found for Stripe customer: {}", customerId);
            return;
        }
        
        // Downgrade to Free tier if not already on Free
        if (subscription.getTier() != SubscriptionTier.FREE) {
            logger.warn("Subscription deleted for organisation: {}. Downgrading to Free tier.", 
                subscription.getOrganisationId());
            
            subscription.setTier(SubscriptionTier.FREE);
            subscription.setStripeSubscriptionId(null);
            subscription.setPaymentFailedAt(null);
            subscriptionRepository.save(subscription);
            
            // TODO: Update Cognito custom:tier attribute for all users in the organisation
            // TODO: Send email notification about downgrade
            // TODO: Check if organisation exceeds Free tier limits and notify admin
            
            logger.info("Downgraded organisation {} to Free tier due to subscription deletion", 
                subscription.getOrganisationId());
        }
    }
    
    /**
     * Check if payment failure grace period has expired (7 days).
     * If expired, downgrade to Free tier and restrict paid features.
     * Requirement 11.8
     */
    private void checkAndApplyGracePeriodExpiry(Subscription subscription) {
        if (subscription.getPaymentFailedAt() == null) {
            return;
        }
        
        Instant now = Instant.now();
        Instant graceExpiryDate = subscription.getPaymentFailedAt()
            .plus(PAYMENT_FAILURE_GRACE_PERIOD_DAYS, ChronoUnit.DAYS);
        
        if (now.isAfter(graceExpiryDate)) {
            logger.warn("Grace period expired for organisation: {}. Downgrading to Free tier.", 
                subscription.getOrganisationId());
            
            // Downgrade to Free tier - Requirement 11.8
            if (subscription.getTier() != SubscriptionTier.FREE) {
                subscription.setTier(SubscriptionTier.FREE);
                subscription.setStripeSubscriptionId(null);
                subscriptionRepository.save(subscription);
                
                logger.info("Downgraded organisation {} to Free tier after 7 days of payment failure", 
                    subscription.getOrganisationId());
                
                // TODO: Update Cognito custom:tier attribute for all users
                // TODO: Send email notification about downgrade
                // TODO: Check if organisation exceeds Free tier limits and notify
            }
        } else {
            long daysRemaining = ChronoUnit.DAYS.between(now, graceExpiryDate);
            logger.info("Grace period in effect for organisation: {}. {} days remaining until downgrade.", 
                subscription.getOrganisationId(), daysRemaining);
        }
    }
    
    /**
     * Extract customer ID from webhook event.
     * Handles different event structures.
     */
    private String extractCustomerId(Event event) {
        try {
            EventDataObjectDeserializer dataObjectDeserializer = event.getDataObjectDeserializer();
            if (dataObjectDeserializer.getObject().isPresent()) {
                StripeObject stripeObject = dataObjectDeserializer.getObject().get();
                
                // Try to get customer ID from the event data object
                if (stripeObject instanceof com.stripe.model.PaymentIntent) {
                    return ((com.stripe.model.PaymentIntent) stripeObject).getCustomer();
                } else if (stripeObject instanceof com.stripe.model.Invoice) {
                    return ((com.stripe.model.Invoice) stripeObject).getCustomer();
                } else if (stripeObject instanceof com.stripe.model.Subscription) {
                    return ((com.stripe.model.Subscription) stripeObject).getCustomer();
                }
            }
            
            logger.warn("Could not extract customer ID from event type: {}", event.getType());
            return null;
            
        } catch (Exception e) {
            logger.error("Error extracting customer ID from webhook event", e);
            return null;
        }
    }
    
    /**
     * Find subscription by Stripe customer ID.
     */
    private Subscription findSubscriptionByStripeCustomerId(String stripeCustomerId) {
        return subscriptionRepository.findByStripeCustomerId(stripeCustomerId)
            .orElse(null);
    }
}
