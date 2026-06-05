package com.cogschecker.foodcost.api.service;

import com.cogschecker.foodcost.api.domain.SystemConfig;
import com.cogschecker.foodcost.api.repository.SystemConfigRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Unit tests for SystemConfigService.
 * Tests Requirement: 4.6
 */
@ExtendWith(MockitoExtension.class)
class SystemConfigServiceTest {
    
    @Mock
    private SystemConfigRepository systemConfigRepository;
    
    @InjectMocks
    private SystemConfigService systemConfigService;
    
    private UUID venueId;
    
    @BeforeEach
    void setUp() {
        venueId = UUID.randomUUID();
    }
    
    // Get config tests - Requirement 4.6
    
    @Test
    void getConfig_ConfigExists_ReturnsExistingConfig() {
        // Given
        BigDecimal customPercentage = new BigDecimal("25.0");
        SystemConfig existingConfig = new SystemConfig(venueId, customPercentage);
        
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.of(existingConfig));
        
        // When
        SystemConfig result = systemConfigService.getConfig(venueId);
        
        // Then
        assertThat(result).isNotNull();
        assertThat(result.getVenueId()).isEqualTo(venueId);
        assertThat(result.getTargetFoodCostPercentage()).isEqualByComparingTo(customPercentage);
        
        verify(systemConfigRepository).findById(venueId);
    }
    
    @Test
    void getConfig_ConfigDoesNotExist_ReturnsDefaultConfig() {
        // Given
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.empty());
        
        // When
        SystemConfig result = systemConfigService.getConfig(venueId);
        
        // Then
        assertThat(result).isNotNull();
        assertThat(result.getVenueId()).isEqualTo(venueId);
        assertThat(result.getTargetFoodCostPercentage()).isEqualByComparingTo(new BigDecimal("30.0"));
        
        verify(systemConfigRepository).findById(venueId);
        verify(systemConfigRepository, never()).save(any());
    }
    
    // Update config tests - Requirement 4.6
    
    @Test
    void updateConfig_ValidPercentage_UpdatesAndReturnsConfig() {
        // Given
        BigDecimal newPercentage = new BigDecimal("35.5");
        SystemConfig existingConfig = new SystemConfig(venueId, new BigDecimal("30.0"));
        
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.of(existingConfig));
        when(systemConfigRepository.save(any(SystemConfig.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // When
        SystemConfig result = systemConfigService.updateConfig(venueId, newPercentage);
        
        // Then
        assertThat(result).isNotNull();
        assertThat(result.getVenueId()).isEqualTo(venueId);
        assertThat(result.getTargetFoodCostPercentage()).isEqualByComparingTo(newPercentage);
        
        verify(systemConfigRepository).findById(venueId);
        verify(systemConfigRepository).save(any(SystemConfig.class));
    }
    
    @Test
    void updateConfig_ConfigDoesNotExist_CreatesNewConfigWithValue() {
        // Given
        BigDecimal newPercentage = new BigDecimal("40.0");
        
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.empty());
        when(systemConfigRepository.save(any(SystemConfig.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // When
        SystemConfig result = systemConfigService.updateConfig(venueId, newPercentage);
        
        // Then
        assertThat(result).isNotNull();
        assertThat(result.getVenueId()).isEqualTo(venueId);
        assertThat(result.getTargetFoodCostPercentage()).isEqualByComparingTo(newPercentage);
        
        verify(systemConfigRepository).findById(venueId);
        verify(systemConfigRepository).save(any(SystemConfig.class));
    }
    
    @Test
    void updateConfig_BoundaryValue1_Accepts() {
        // Given - minimum valid value
        BigDecimal minPercentage = new BigDecimal("1.0");
        
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.empty());
        when(systemConfigRepository.save(any(SystemConfig.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // When
        SystemConfig result = systemConfigService.updateConfig(venueId, minPercentage);
        
        // Then
        assertThat(result.getTargetFoodCostPercentage()).isEqualByComparingTo(minPercentage);
        verify(systemConfigRepository).save(any(SystemConfig.class));
    }
    
    @Test
    void updateConfig_BoundaryValue100_Accepts() {
        // Given - maximum valid value
        BigDecimal maxPercentage = new BigDecimal("100.0");
        
        when(systemConfigRepository.findById(venueId)).thenReturn(Optional.empty());
        when(systemConfigRepository.save(any(SystemConfig.class))).thenAnswer(invocation -> invocation.getArgument(0));
        
        // When
        SystemConfig result = systemConfigService.updateConfig(venueId, maxPercentage);
        
        // Then
        assertThat(result.getTargetFoodCostPercentage()).isEqualByComparingTo(maxPercentage);
        verify(systemConfigRepository).save(any(SystemConfig.class));
    }
    
    // Validation tests - Requirement 4.6
    
    @Test
    void updateConfig_NullPercentage_ThrowsIllegalArgumentException() {
        // When/Then
        assertThatThrownBy(() -> systemConfigService.updateConfig(venueId, null))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Target food cost percentage cannot be null");
        
        verify(systemConfigRepository, never()).save(any());
    }
    
    @Test
    void updateConfig_PercentageBelowMinimum_ThrowsIllegalArgumentException() {
        // Given - below minimum (< 1.0)
        BigDecimal belowMin = new BigDecimal("0.9");
        
        // When/Then
        assertThatThrownBy(() -> systemConfigService.updateConfig(venueId, belowMin))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Target food cost percentage must be at least");
        
        verify(systemConfigRepository, never()).save(any());
    }
    
    @Test
    void updateConfig_PercentageAboveMaximum_ThrowsIllegalArgumentException() {
        // Given - above maximum (> 100.0)
        BigDecimal aboveMax = new BigDecimal("100.1");
        
        // When/Then
        assertThatThrownBy(() -> systemConfigService.updateConfig(venueId, aboveMax))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Target food cost percentage must be at most");
        
        verify(systemConfigRepository, never()).save(any());
    }
    
    @Test
    void updateConfig_ZeroPercentage_ThrowsIllegalArgumentException() {
        // Given
        BigDecimal zero = BigDecimal.ZERO;
        
        // When/Then
        assertThatThrownBy(() -> systemConfigService.updateConfig(venueId, zero))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Target food cost percentage must be at least");
        
        verify(systemConfigRepository, never()).save(any());
    }
    
    @Test
    void updateConfig_NegativePercentage_ThrowsIllegalArgumentException() {
        // Given
        BigDecimal negative = new BigDecimal("-5.0");
        
        // When/Then
        assertThatThrownBy(() -> systemConfigService.updateConfig(venueId, negative))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Target food cost percentage must be at least");
        
        verify(systemConfigRepository, never()).save(any());
    }
}
