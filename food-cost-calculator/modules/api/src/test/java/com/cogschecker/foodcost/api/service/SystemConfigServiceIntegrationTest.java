package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

/**
 * Integration tests for SystemConfigService with actual database.
 * Tests Requirement: 4.6
 */
@DataJpaTest
@Import(SystemConfigService.class)
@TestPropertySource(properties = {
    "spring.jpa.hibernate.ddl-auto=create-drop",
    "spring.datasource.url=jdbc:h2:mem:testdb",
    "spring.flyway.enabled=false"
})
class SystemConfigServiceIntegrationTest {
    
    @Autowired
    private TestEntityManager entityManager;
    
    @Autowired
    private SystemConfigRepository systemConfigRepository;
    
    @Autowired
    private SystemConfigService systemConfigService;
    
    private UUID venueId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
    }
    
    @Test
    void getConfig_ConfigDoesNotExist_ReturnsDefaultWithoutPersisting() {
        // When
        SystemConfig config = systemConfigService.getConfig(venueId);
        
        // Then - returns default
        assertThat(config).isNotNull();
        assertThat(config.getVenueId()).isEqualTo(venueId);
        assertThat(config.getTargetFoodCostPercentage()).isEqualByComparingTo(new BigDecimal("30.0"));
        
        // Verify not persisted
        entityManager.flush();
        entityManager.clear();
        assertThat(systemConfigRepository.findById(venueId)).isEmpty();
    }
    
    @Test
    void updateConfig_ConfigDoesNotExist_CreatesNew() {
        // When
        BigDecimal newPercentage = new BigDecimal("35.5");
        SystemConfig updated = systemConfigService.updateConfig(venueId, newPercentage);
        
        entityManager.flush();
        entityManager.clear();
        
        // Then - verify persisted
        SystemConfig retrieved = systemConfigRepository.findById(venueId).orElseThrow();
        
        assertThat(retrieved.getVenueId()).isEqualTo(venueId);
        assertThat(retrieved.getTargetFoodCostPercentage()).isEqualByComparingTo(newPercentage);
        assertThat(retrieved.getCreatedAt()).isNotNull();
        assertThat(retrieved.getUpdatedAt()).isNotNull();
    }
    
    @Test
    void updateConfig_ConfigExists_Updates() {
        // Given - existing config
        BigDecimal initialPercentage = new BigDecimal("25.0");
        SystemConfig existing = new SystemConfig(venueId, initialPercentage);
        systemConfigRepository.saveAndFlush(existing);
        entityManager.clear();
        
        // When - update
        BigDecimal newPercentage = new BigDecimal("40.0");
        SystemConfig updated = systemConfigService.updateConfig(venueId, newPercentage);
        
        entityManager.flush();
        entityManager.clear();
        
        // Then - verify updated
        SystemConfig retrieved = systemConfigRepository.findById(venueId).orElseThrow();
        
        assertThat(retrieved.getVenueId()).isEqualTo(venueId);
        assertThat(retrieved.getTargetFoodCostPercentage()).isEqualByComparingTo(newPercentage);
        assertThat(retrieved.getUpdatedAt()).isNotNull();
    }
    
    @Test
    void getConfig_AfterUpdate_RetrievesUpdatedValue() {
        // Given - update config
        BigDecimal percentage = new BigDecimal("45.0");
        systemConfigService.updateConfig(venueId, percentage);
        
        entityManager.flush();
        entityManager.clear();
        
        // When - retrieve
        SystemConfig retrieved = systemConfigService.getConfig(venueId);
        
        // Then
        assertThat(retrieved.getVenueId()).isEqualTo(venueId);
        assertThat(retrieved.getTargetFoodCostPercentage()).isEqualByComparingTo(percentage);
    }
    
    @Test
    void updateConfig_BoundaryValues_PersistsCorrectly() {
        // Test minimum
        systemConfigService.updateConfig(venueId, new BigDecimal("1.0"));
        entityManager.flush();
        
        SystemConfig min = systemConfigRepository.findById(venueId).orElseThrow();
        assertThat(min.getTargetFoodCostPercentage()).isEqualByComparingTo(new BigDecimal("1.0"));
        
        // Test maximum
        systemConfigService.updateConfig(venueId, new BigDecimal("100.0"));
        entityManager.flush();
        
        SystemConfig max = systemConfigRepository.findById(venueId).orElseThrow();
        assertThat(max.getTargetFoodCostPercentage()).isEqualByComparingTo(new BigDecimal("100.0"));
    }
    
    @Test
    void updateConfig_Validation_PreventsPersistenceOfInvalidValues() {
        // Test below minimum
        assertThatThrownBy(() -> systemConfigService.updateConfig(venueId, new BigDecimal("0.9")))
            .isInstanceOf(IllegalArgumentException.class);
        
        entityManager.flush();
        assertThat(systemConfigRepository.findById(venueId)).isEmpty();
        
        // Test above maximum
        assertThatThrownBy(() -> systemConfigService.updateConfig(venueId, new BigDecimal("100.1")))
            .isInstanceOf(IllegalArgumentException.class);
        
        entityManager.flush();
        assertThat(systemConfigRepository.findById(venueId)).isEmpty();
    }
}
