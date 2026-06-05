package com.cogschecker.foodcost.api.dto;

/**
 * Response payload for HTTP 402 Payment Required when a user attempts to access
 * a feature not included in their current subscription tier.
 * 
 * Requirements: 11.3
 */
public class UpgradePromptResponse {
    private String error;
    private String message;
    private String currentTier;
    private String requiredTier;
    private String upgradePath;

    public UpgradePromptResponse() {
    }

    public UpgradePromptResponse(String error, String message, String currentTier, String requiredTier, String upgradePath) {
        this.error = error;
        this.message = message;
        this.currentTier = currentTier;
        this.requiredTier = requiredTier;
        this.upgradePath = upgradePath;
    }

    public String getError() {
        return error;
    }

    public void setError(String error) {
        this.error = error;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getCurrentTier() {
        return currentTier;
    }

    public void setCurrentTier(String currentTier) {
        this.currentTier = currentTier;
    }

    public String getRequiredTier() {
        return requiredTier;
    }

    public void setRequiredTier(String requiredTier) {
        this.requiredTier = requiredTier;
    }

    public String getUpgradePath() {
        return upgradePath;
    }

    public void setUpgradePath(String upgradePath) {
        this.upgradePath = upgradePath;
    }
}
