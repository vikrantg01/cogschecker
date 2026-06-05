package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.SubscriptionHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * Repository for SubscriptionHistory entity.
 * Requirement 11.9
 */
@Repository
public interface SubscriptionHistoryRepository extends JpaRepository<SubscriptionHistory, UUID> {
    
    /**
     * Find all history entries for an organisation, ordered by most recent first.
     */
    List<SubscriptionHistory> findByOrganisationIdOrderByCreatedAtDesc(UUID organisationId);
}
