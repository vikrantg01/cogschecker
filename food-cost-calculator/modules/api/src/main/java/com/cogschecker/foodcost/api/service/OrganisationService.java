package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.Organisation;
import com.cogschecker.foodcost.api.domain.Recipe;
import com.cogschecker.foodcost.api.domain.Subscription;
import com.cogschecker.foodcost.api.domain.Venue;
import com.cogschecker.foodcost.api.dto.CrossVenueSummaryResponse;
import com.cogschecker.foodcost.api.exception.ResourceNotFoundException;
import com.cogschecker.foodcost.api.repository.OrganisationRepository;
import com.cogschecker.foodcost.api.repository.RecipeRepository;
import com.cogschecker.foodcost.api.repository.SubscriptionRepository;
import com.cogschecker.foodcost.api.repository.VenueRepository;
import com.cogschecker.foodcost.shared.ErrorCodes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Service for organisation-level operations including cross-venue reports.
 * Requirements: 10.1, 10.4, 10.5
 */
@Service
@Transactional(readOnly = true)
public class OrganisationService {
    
    private static final Logger logger = LoggerFactory.getLogger(OrganisationService.class);
    
    private final OrganisationRepository organisationRepository;
    private final SubscriptionRepository subscriptionRepository;
    private final VenueRepository venueRepository;
    private final RecipeRepository recipeRepository;
    private final SystemConfigService systemConfigService;
    
    public OrganisationService(
            OrganisationRepository organisationRepository,
            SubscriptionRepository subscriptionRepository,
            VenueRepository venueRepository,
            RecipeRepository recipeRepository,
            SystemConfigService systemConfigService) {
        this.organisationRepository = organisationRepository;
        this.subscriptionRepository = subscriptionRepository;
        this.venueRepository = venueRepository;
        this.recipeRepository = recipeRepository;
        this.systemConfigService = systemConfigService;
    }
    
    /**
     * Get organisation details.
     * Requirement: 10.1
     * 
     * @param organisationId the organisation ID
     * @return the organisation
     * @throws ResourceNotFoundException if not found
     */
    public Organisation getOrganisation(UUID organisationId) {
        return organisationRepository.findById(organisationId)
            .orElseThrow(() -> new ResourceNotFoundException(
                ErrorCodes.ORGANISATION_NOT_FOUND,
                String.format("Organisation with ID %s not found", organisationId)
            ));
    }
    
    /**
     * Get organisation's subscription tier.
     * 
     * @param organisationId the organisation ID
     * @return the subscription tier name
     */
    public String getOrganisationTier(UUID organisationId) {
        Subscription subscription = subscriptionRepository.findByOrganisationId(organisationId)
            .orElseThrow(() -> new ResourceNotFoundException(
                ErrorCodes.ORGANISATION_NOT_FOUND,
                String.format("Subscription not found for organisation %s", organisationId)
            ));
        return subscription.getTier().name().toLowerCase();
    }
    
    /**
     * Get cross-venue summary report.
     * Requirements: 10.4, 10.5
     * 
     * Aggregate per venue:
     * - Total recipe count
     * - Average food cost percentage
     * - Number of recipes exceeding threshold
     * 
     * Only includes venues in the Admin's organisation.
     * 
     * @param organisationId the organisation ID
     * @return cross-venue summary
     */
    public CrossVenueSummaryResponse getCrossVenueSummary(UUID organisationId) {
        logger.info("Generating cross-venue summary report for organisation {}", organisationId);
        
        // Verify organisation exists
        getOrganisation(organisationId);
        
        // Get all active venues for this organisation
        List<Venue> venues = venueRepository.findByOrganisationIdAndDeletedAtIsNull(organisationId);
        
        // Generate summary for each venue
        List<CrossVenueSummaryResponse.VenueSummary> venueSummaries = venues.stream()
            .map(this::generateVenueSummary)
            .collect(Collectors.toList());
        
        logger.info("Generated cross-venue summary for {} venues", venueSummaries.size());
        
        return new CrossVenueSummaryResponse(venueSummaries);
    }
    
    /**
     * Generate summary statistics for a single venue.
     */
    private CrossVenueSummaryResponse.VenueSummary generateVenueSummary(Venue venue) {
        UUID venueId = venue.getId();
        
        // Get all recipes for this venue
        List<Recipe> recipes = recipeRepository.findByVenueId(venueId);
        
        // Total recipe count
        long totalRecipeCount = recipes.size();
        
        // Get threshold for this venue
        BigDecimal threshold = systemConfigService.getConfig(venueId)
            .getTargetFoodCostPercentage();
        
        // Calculate average food cost percentage
        // Only include recipes with both menu price and food cost percentage set
        List<Recipe> recipesWithPercentage = recipes.stream()
            .filter(r -> r.getFoodCostPercentage() != null)
            .filter(r -> r.getMenuSellingPrice() != null)
            .filter(r -> r.getMenuSellingPrice().compareTo(BigDecimal.ZERO) > 0)
            .collect(Collectors.toList());
        
        BigDecimal averageFoodCostPercentage = null;
        if (!recipesWithPercentage.isEmpty()) {
            BigDecimal sum = recipesWithPercentage.stream()
                .map(Recipe::getFoodCostPercentage)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
            
            averageFoodCostPercentage = sum.divide(
                new BigDecimal(recipesWithPercentage.size()), 
                1, 
                RoundingMode.HALF_UP
            );
        }
        
        // Count recipes exceeding threshold
        long recipesExceedingThreshold = recipesWithPercentage.stream()
            .filter(r -> r.getFoodCostPercentage().compareTo(threshold) > 0)
            .count();
        
        logger.debug("Venue {}: {} recipes, avg {}%, {} exceeding threshold",
            venue.getName(), totalRecipeCount, averageFoodCostPercentage, recipesExceedingThreshold);
        
        return new CrossVenueSummaryResponse.VenueSummary(
            venueId,
            venue.getName(),
            totalRecipeCount,
            averageFoodCostPercentage,
            recipesExceedingThreshold
        );
    }
}
