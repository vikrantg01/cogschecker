package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.SystemConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

/**
 * Repository for SystemConfig entity.
 * Requirement: 4.6
 */
@Repository
public interface SystemConfigRepository extends JpaRepository<SystemConfig, UUID> {
    // venueId is the primary key, so findById(venueId) is sufficient
}
