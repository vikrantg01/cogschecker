package com.cogschecker.foodcost.api.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * Request DTO for refreshing access tokens.
 * Requirements: 6.3 (token refresh)
 */
public class RefreshTokenRequest {

    @NotBlank(message = "Refresh token is required")
    private String refreshToken;

    public RefreshTokenRequest() {
    }

    public RefreshTokenRequest(String refreshToken) {
        this.refreshToken = refreshToken;
    }

    public String getRefreshToken() {
        return refreshToken;
    }

    public void setRefreshToken(String refreshToken) {
        this.refreshToken = refreshToken;
    }
}
