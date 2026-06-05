package com.cogschecker.foodcost.api.domain;

import jakarta.persistence.*;
import org.hibernate.annotations.GenericGenerator;

import java.time.Instant;
import java.util.UUID;

/**
 * SquareConnection entity representing a venue's OAuth connection to Square POS.
 * Requirements: 12.1 (Square OAuth connection)
 */
@Entity
@Table(name = "square_connections")
public class SquareConnection {
    
    @Id
    @GeneratedValue(generator = "UUID")
    @GenericGenerator(name = "UUID", strategy = "org.hibernate.id.UUIDGenerator")
    @Column(name = "id", updatable = false, nullable = false)
    private UUID id;
    
    @Column(name = "venue_id", nullable = false, unique = true)
    private UUID venueId;
    
    @Column(name = "square_merchant_id", nullable = false)
    private String squareMerchantId;
    
    @Column(name = "access_token_encrypted", nullable = false)
    private byte[] accessTokenEncrypted;
    
    @Column(name = "refresh_token_encrypted", nullable = false)
    private byte[] refreshTokenEncrypted;
    
    @Column(name = "token_expires_at", nullable = false)
    private Instant tokenExpiresAt;
    
    @Column(name = "last_synced_at")
    private Instant lastSyncedAt;
    
    @Column(name = "sync_status", nullable = false)
    @Enumerated(EnumType.STRING)
    private SyncStatus syncStatus = SyncStatus.IDLE;
    
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;
    
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;
    
    @PrePersist
    protected void onCreate() {
        createdAt = Instant.now();
        updatedAt = Instant.now();
    }
    
    @PreUpdate
    protected void onUpdate() {
        updatedAt = Instant.now();
    }
    
    // Constructors
    
    public SquareConnection() {
    }
    
    public SquareConnection(UUID venueId, String squareMerchantId, byte[] accessTokenEncrypted, 
                           byte[] refreshTokenEncrypted, Instant tokenExpiresAt) {
        this.venueId = venueId;
        this.squareMerchantId = squareMerchantId;
        this.accessTokenEncrypted = accessTokenEncrypted;
        this.refreshTokenEncrypted = refreshTokenEncrypted;
        this.tokenExpiresAt = tokenExpiresAt;
        this.syncStatus = SyncStatus.IDLE;
    }
    
    // Getters and Setters
    
    public UUID getId() {
        return id;
    }
    
    public void setId(UUID id) {
        this.id = id;
    }
    
    public UUID getVenueId() {
        return venueId;
    }
    
    public void setVenueId(UUID venueId) {
        this.venueId = venueId;
    }
    
    public String getSquareMerchantId() {
        return squareMerchantId;
    }
    
    public void setSquareMerchantId(String squareMerchantId) {
        this.squareMerchantId = squareMerchantId;
    }
    
    public byte[] getAccessTokenEncrypted() {
        return accessTokenEncrypted;
    }
    
    public void setAccessTokenEncrypted(byte[] accessTokenEncrypted) {
        this.accessTokenEncrypted = accessTokenEncrypted;
    }
    
    public byte[] getRefreshTokenEncrypted() {
        return refreshTokenEncrypted;
    }
    
    public void setRefreshTokenEncrypted(byte[] refreshTokenEncrypted) {
        this.refreshTokenEncrypted = refreshTokenEncrypted;
    }
    
    public Instant getTokenExpiresAt() {
        return tokenExpiresAt;
    }
    
    public void setTokenExpiresAt(Instant tokenExpiresAt) {
        this.tokenExpiresAt = tokenExpiresAt;
    }
    
    public Instant getLastSyncedAt() {
        return lastSyncedAt;
    }
    
    public void setLastSyncedAt(Instant lastSyncedAt) {
        this.lastSyncedAt = lastSyncedAt;
    }
    
    public SyncStatus getSyncStatus() {
        return syncStatus;
    }
    
    public void setSyncStatus(SyncStatus syncStatus) {
        this.syncStatus = syncStatus;
    }
    
    public Instant getCreatedAt() {
        return createdAt;
    }
    
    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }
    
    public Instant getUpdatedAt() {
        return updatedAt;
    }
    
    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }
    
    public enum SyncStatus {
        IDLE,
        SYNCING,
        ERROR
    }
}
