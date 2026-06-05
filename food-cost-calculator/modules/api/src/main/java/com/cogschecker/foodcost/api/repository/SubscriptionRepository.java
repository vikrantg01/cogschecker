package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.Subscription;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Subscription entity.
 */
@Repository
public interface SubscriptionRepository extends JpaRepository<Subscription, UUID> {
    
    /**
     * Find a subscription by organisation ID.
     */
    Optional<Subscription> findByOrganisationId(UUID organisationId);
    
    /**
     * Find a subscription by Stripe customer ID.
     * Used by webhook processing to locate the subscription when payment events occur.
     */
    Optional<Subscription> findByStripeCustomerId(String stripeCustomerId);
}
