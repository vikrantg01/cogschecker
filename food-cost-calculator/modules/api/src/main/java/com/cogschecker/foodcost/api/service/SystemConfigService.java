package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * Service for managing venue-specific system configuration.
 * Requirement: 4.6
 */
@Service
@Transactional
public class SystemConfigService {
    
    private static final Logger logger = LoggerFactory.getLogger(SystemConfigService.class);
    private static final BigDecimal DEFAULT_TARGET_PERCENTAGE = new BigDecimal("30.0");
    private static final BigDecimal MIN_PERCENTAGE = new BigDecimal("1.0");
    private static final BigDecimal MAX_PERCENTAGE = new BigDecimal("100.0");
    
    private final SystemConfigRepository systemConfigRepository;
    
    public SystemConfigService(SystemConfigRepository systemConfigRepository) {
        this.systemConfigRepository = systemConfigRepository;
    }
    
    /**
     * Get configuration for a venue. Creates default config if it doesn't exist.
     * Requirement: 4.6
     * 
     * @param venueId the venue ID
     * @return the system config (default if not found)
     */
    @Transactional(readOnly = true)
    public SystemConfig getConfig(UUID venueId) {
        logger.debug("Getting config for venue {}", venueId);
        
        return systemConfigRepository.findById(venueId)
            .orElseGet(() -> {
                logger.info("No config found for venue {}, returning default", venueId);
                // Return default config (not persisted yet)
                return new SystemConfig(venueId, DEFAULT_TARGET_PERCENTAGE);
            });
    }
    
    /**
     * Update configuration for a venue.
     * Requirement: 4.6
     * 
     * @param venueId the venue ID
     * @param targetFoodCostPercentage the new target percentage (must be between 1 and 100)
     * @return the updated config
     */
    public SystemConfig updateConfig(UUID venueId, BigDecimal targetFoodCostPercentage) {
        logger.info("Updating config for venue {}: targetFoodCostPercentage={}", 
            venueId, targetFoodCostPercentage);
        
        // Validate target percentage
        validateTargetPercentage(targetFoodCostPercentage);
        
        // Get or create config
        SystemConfig config = systemConfigRepository.findById(venueId)
            .orElseGet(() -> {
                logger.info("Creating new config for venue {}", venueId);
                return new SystemConfig(venueId, DEFAULT_TARGET_PERCENTAGE);
            });
        
        // Update target percentage
        config.setTargetFoodCostPercentage(targetFoodCostPercentage);
        
        SystemConfig saved = systemConfigRepository.save(config);
        logger.info("Updated config for venue {}: targetFoodCostPercentage={}", 
            saved.getVenueId(), saved.getTargetFoodCostPercentage());
        
        return saved;
    }
    
    /**
     * Validate that target percentage is within valid range [1, 100].
     * Requirement: 4.6
     */
    private void validateTargetPercentage(BigDecimal percentage) {
        if (percentage == null) {
            throw new IllegalArgumentException("Target food cost percentage cannot be null");
        }
        
        if (percentage.compareTo(MIN_PERCENTAGE) < 0) {
            throw new IllegalArgumentException(
                String.format("Target food cost percentage must be at least %s", MIN_PERCENTAGE)
            );
        }
        
        if (percentage.compareTo(MAX_PERCENTAGE) > 0) {
            throw new IllegalArgumentException(
                String.format("Target food cost percentage must be at most %s", MAX_PERCENTAGE)
            );
        }
    }
}
