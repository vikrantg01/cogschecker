package com.cogschecker.foodcost.api.repository;

import com.cogschecker.foodcost.api.domain.Ingredient;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Repository for Ingredient entity.
 * Requirements: 1.9 (search), 1.10 (duplicate detection)
 */
@Repository
public interface IngredientRepository extends JpaRepository<Ingredient, UUID> {
    
    /**
     * Find all ingredients for a venue.
     */
    List<Ingredient> findByVenueId(UUID venueId);
    
    /**
     * Find ingredient by venue and ID.
     */
    Optional<Ingredient> findByVenueIdAndId(UUID venueId, UUID id);
    
    /**
     * Search ingredients by venue and name (case-insensitive partial match).
     * Requirement 1.9
     */
    List<Ingredient> findByVenueIdAndNameContainingIgnoreCase(UUID venueId, String nameQuery);
    
    /**
     * Find ingredient by venue and exact name match (case-insensitive).
     * Used for cross-venue recipe copy to find matching ingredients.
     */
    @Query("SELECT i FROM Ingredient i WHERE i.venueId = :venueId AND LOWER(i.name) = LOWER(:name)")
    Optional<Ingredient> findByVenueIdAndNameIgnoreCase(@Param("venueId") UUID venueId, @Param("name") String name);
    
    /**
     * Check if ingredient with the given name exists in a venue (case-insensitive).
     * Requirement 1.10 - Used for duplicate name detection.
     */
    @Query("SELECT CASE WHEN COUNT(i) > 0 THEN true ELSE false END FROM Ingredient i " +
           "WHERE i.venueId = :venueId AND LOWER(i.name) = LOWER(:name)")
    boolean existsByVenueIdAndNameIgnoreCase(@Param("venueId") UUID venueId, @Param("name") String name);
    
    /**
     * Check if ingredient with the given name exists in a venue, excluding a specific ID.
     * Used for duplicate name detection during updates.
     */
    @Query("SELECT CASE WHEN COUNT(i) > 0 THEN true ELSE false END FROM Ingredient i " +
           "WHERE i.venueId = :venueId AND LOWER(i.name) = LOWER(:name) AND i.id != :excludeId")
    boolean existsByVenueIdAndNameIgnoreCaseExcludingId(
        @Param("venueId") UUID venueId, 
        @Param("name") String name, 
        @Param("excludeId") UUID excludeId
    );
    
    /**
     * Delete all ingredients for a venue.
     * Used for data import to atomically replace venue data.
     * Requirements: 7.5, 7.6
     */
    void deleteByVenueId(UUID venueId);
}
