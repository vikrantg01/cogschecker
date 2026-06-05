package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Subscription;
import com.cogschecker.foodcost.api.domain.SubscriptionTier;
import com.cogschecker.foodcost.api.domain.Venue;
import com.cogschecker.foodcost.api.exception.DuplicateResourceException;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.exception.TierLimitExceededException;
import com.cogschecker.foodcost.api.repository.SubscriptionRepository;
import com.cogschecker.foodcost.api.repository.VenueRepository;
import com.cogschecker.foodcost.shared.ErrorCodes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Service for managing venues with business rule enforcement.
 * Requirements: 10.1, 10.2, 10.8, 11.1
 */
@Service
@Transactional
public class VenueService {
    
    private static final Logger logger = LoggerFactory.getLogger(VenueService.class);
    
    private static final int FREE_TIER_VENUE_LIMIT = 2;
    
    private final VenueRepository venueRepository;
    private final SubscriptionRepository subscriptionRepository;
    
    public VenueService(
            VenueRepository venueRepository,
            SubscriptionRepository subscriptionRepository) {
        this.venueRepository = venueRepository;
        this.subscriptionRepository = subscriptionRepository;
    }
    
    /**
     * Create a new venue.
     * Requirements: 10.1, 10.2
     * 
     * @param organisationId the organisation ID
     * @param name the venue name (1-100 characters)
     * @param address the optional venue address
     * @return the created venue
     * @throws TierLimitExceededException if Free tier limit of 2 venues would be exceeded
     * @throws DuplicateResourceException if a venue with the same name already exists
     */
    public Venue createVenue(UUID organisationId, String name, String address) {
        logger.info("Creating venue '{}' for organisation {}", name, organisationId);
        
        // Validate inputs
        validateVenueName(name);
        
        // Check for duplicate name (case-insensitive) - Requirement 10.1
        if (venueRepository.existsByOrganisationIdAndNameIgnoreCase(organisationId, name)) {
            throw new DuplicateResourceException(
                ErrorCodes.VENUE_DUPLICATE_NAME,
                String.format("A venue with the name '%s' already exists in this organisation", name)
            );
        }
        
        // Check tier limits - Requirement 10.2
        enforceTierLimitForCreation(organisationId);
        
        // Create venue
        Venue venue = new Venue(organisationId, name, address);
        Venue saved = venueRepository.save(venue);
        
        logger.info("Created venue {} with ID {}", saved.getName(), saved.getId());
        return saved;
    }
    
    /**
     * Get a venue by ID.
     * Requirement 10.1
     * 
     * @param organisationId the organisation ID
     * @param venueId the venue ID
     * @return the venue
     * @throws ResourceNotFoundException if not found or soft-deleted
     */
    @Transactional(readOnly = true)
    public Venue getVenue(UUID organisationId, UUID venueId) {
        return venueRepository.findByOrganisationIdAndIdAndDeletedAtIsNull(organisationId, venueId)
            .orElseThrow(() -> new ResourceNotFoundException(
                ErrorCodes.VENUE_NOT_FOUND,
                String.format("Venue with ID %s not found in organisation %s", venueId, organisationId)
            ));
    }
    
    /**
     * Get all active venues for an organisation.
     * 
     * @param organisationId the organisation ID
     * @return list of venues (excluding soft-deleted)
     */
    @Transactional(readOnly = true)
    public List<Venue> getAllVenues(UUID organisationId) {
        return venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId);
    }
    
    /**
     * Rename an existing venue.
     * Requirement 10.8
     * 
     * @param organisationId the organisation ID
     * @param venueId the venue ID
     * @param newName the new venue name
     * @return the updated venue
     * @throws DuplicateResourceException if the new name already exists
     */
    public Venue renameVenue(UUID organisationId, UUID venueId, String newName) {
        logger.info("Renaming venue {} to '{}' for organisation {}", venueId, newName, organisationId);
        
        // Validate name
        validateVenueName(newName);
        
        Venue venue = getVenue(organisationId, venueId);
        
        // If name hasn't changed, return as-is
        if (venue.getName().equals(newName)) {
            return venue;
        }
        
        // Check for duplicate name (case-insensitive) - Requirement 10.1
        if (venueRepository.existsByOrganisationIdAndNameIgnoreCaseExcludingId(
                organisationId, newName, venueId)) {
            throw new DuplicateResourceException(
                ErrorCodes.VENUE_DUPLICATE_NAME,
                String.format("A venue with the name '%s' already exists in this organisation", newName)
            );
        }
        
        venue.setName(newName);
        Venue updated = venueRepository.save(venue);
        
        logger.info("Renamed venue {} to '{}'", venueId, newName);
        return updated;
    }
    
    /**
     * Update venue address.
     * Requirement 10.1
     * 
     * @param organisationId the organisation ID
     * @param venueId the venue ID
     * @param address the new address (can be null)
     * @return the updated venue
     */
    public Venue updateVenueAddress(UUID organisationId, UUID venueId, String address) {
        logger.info("Updating address for venue {} in organisation {}", venueId, organisationId);
        
        Venue venue = getVenue(organisationId, venueId);
        venue.setAddress(address);
        
        Venue updated = venueRepository.save(venue);
        logger.info("Updated address for venue {}", venueId);
        
        return updated;
    }
    
    /**
     * Delete a venue (soft delete).
     * Requirement 10.8
     * 
     * Note: This method performs a soft delete. The caller (controller) should ensure
     * explicit user confirmation has been obtained, and handle cascading deletion of
     * associated data (ingredients, recipes, user access records).
     * 
     * @param organisationId the organisation ID
     * @param venueId the venue ID
     */
    public void deleteVenue(UUID organisationId, UUID venueId) {
        logger.info("Soft-deleting venue {} for organisation {}", venueId, organisationId);
        
        Venue venue = getVenue(organisationId, venueId);
        
        // Soft delete
        venue.setDeletedAt(Instant.now());
        venueRepository.save(venue);
        
        logger.info("Soft-deleted venue {} ({})", venueId, venue.getName());
    }
    
    // Private helper methods
    
    /**
     * Validate venue name according to requirements.
     * Requirement 10.1: name must be 1-100 characters
     */
    private void validateVenueName(String name) {
        if (name == null || name.trim().isEmpty()) {
            throw new IllegalArgumentException("Venue name cannot be empty");
        }
        
        if (name.length() > 100) {
            throw new IllegalArgumentException("Venue name cannot exceed 100 characters");
        }
    }
    
    /**
     * Enforce tier limits when creating a new venue.
     * Requirement 10.2: Free tier allows maximum 2 venues
     * 
     * @param organisationId the organisation ID
     * @throws TierLimitExceededException if creating would exceed the tier limit
     */
    private void enforceTierLimitForCreation(UUID organisationId) {
        // Get the organisation's subscription
        Subscription subscription = subscriptionRepository.findByOrganisationId(organisationId)
            .orElseThrow(() -> new ResourceNotFoundException(
                ErrorCodes.VENUE_NOT_FOUND,
                String.format("Subscription not found for organisation %s", organisationId)
            ));
        
        // Only Free tier has venue limits (Requirement 11.2)
        if (subscription.getTier() == SubscriptionTier.FREE) {
            long currentVenueCount = venueRepository.countByOrganisationIdAndDeletedAtIsNull(organisationId);
            
            if (currentVenueCount >= FREE_TIER_VENUE_LIMIT) {
                throw new TierLimitExceededException(
                    String.format(
                        "Free tier allows a maximum of %d venues. Current count: %d. " +
                        "Please upgrade to Pro or Pro+ to create more venues.",
                        FREE_TIER_VENUE_LIMIT,
                        currentVenueCount
                    )
                );
            }
        }
        // Pro and Pro+ tiers have unlimited venues, no check needed
    }
}
