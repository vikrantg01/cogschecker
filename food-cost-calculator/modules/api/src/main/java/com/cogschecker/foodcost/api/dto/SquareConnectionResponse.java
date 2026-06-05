package com.cogschecker.foodcost.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.Instant;
import java.util.UUID;

/**
 * Response DTO for Square connection status.
 * Requirements: 12.1 (Square OAuth connection)
 */
public class SquareConnectionResponse {
    
    @JsonProperty("venue_id")
    private UUID venueId;
    
    @JsonProperty("merchant_id")
    private String merchantId;
    
    @JsonProperty("connected")
    private boolean connected;
    
    @JsonProperty("last_synced_at")
    private Instant lastSyncedAt;
    
    @JsonProperty("sync_status")
    private String syncStatus;
    
    public SquareConnectionResponse() {
    }
    
    public SquareConnectionResponse(UUID venueId, String merchantId, boolean connected, 
                                   Instant lastSyncedAt, String syncStatus) {
        this.venueId = venueId;
        this.merchantId = merchantId;
        this.connected = connected;
        this.lastSyncedAt = lastSyncedAt;
        this.syncStatus = syncStatus;
    }
    
    // Getters and Setters
    
    public UUID getVenueId() {
        return venueId;
    }
    
    public void setVenueId(UUID venueId) {
        this.venueId = venueId;
    }
    
    public String getMerchantId() {
        return merchantId;
    }
    
    public void setMerchantId(String merchantId) {
        this.merchantId = merchantId;
    }
    
    public boolean isConnected() {
        return connected;
    }
    
    public void setConnected(boolean connected) {
        this.connected = connected;
    }
    
    public Instant getLastSyncedAt() {
        return lastSyncedAt;
    }
    
    public void setLastSyncedAt(Instant lastSyncedAt) {
        this.lastSyncedAt = lastSyncedAt;
    }
    
    public String getSyncStatus() {
        return syncStatus;
    }
    
    public void setSyncStatus(String syncStatus) {
        this.syncStatus = syncStatus;
    }
}
