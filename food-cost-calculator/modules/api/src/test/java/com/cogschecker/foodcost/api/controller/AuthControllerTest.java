package com.cogschecker.foodcost.api.controller;

import com.cogschecker.foodcost.api.dto.*;
import com.cogschecker.foodcost.api.exception.AuthenticationException;
import com.cogschecker.foodcost.api.security.CognitoJwtConverter;
import com.cogschecker.foodcost.api.security.JwtAuthenticationFilter;
import com.cogschecker.foodcost.api.service.AuthService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Unit tests for AuthController.
 * Requirements: 6.1, 6.2, 6.3, 6.7, 8.3, 8.4
 */
@WebMvcTest(controllers = AuthController.class)
@AutoConfigureMockMvc(addFilters = false)
// @TestPropertySource(properties = {
//     "cognito.domain=https://test-domain.auth.region.amazoncognito.com",
//     "cognito.client-id=test-client-id",
//     "cognito.redirect-uri=http://localhost:8080/api/v1/auth/oauth"
// })
class AuthControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AuthService authService;

    @MockBean
    private JwtDecoder jwtDecoder;

    @MockBean
    private JwtAuthenticationFilter jwtAuthenticationFilter;

    @MockBean
    private CognitoJwtConverter cognitoJwtConverter;

    @Test
    void register_withValidRequest_shouldReturn201() throws Exception {
        // Given
        RegisterRequest request = new RegisterRequest("test@example.com", "SecurePass123", "Test User");

        doNothing().when(authService).register(anyString(), anyString(), anyString());

        // When & Then
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.message").exists());

        verify(authService).register("test@example.com", "SecurePass123", "Test User");
    }

    @Test
    void register_withInvalidEmail_shouldReturn400() throws Exception {
        // Given
        RegisterRequest request = new RegisterRequest("invalid-email", "SecurePass123", "Test User");

        // When & Then
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("VALIDATION_9004"));

        verify(authService, never()).register(anyString(), anyString(), anyString());
    }

    @Test
    void register_withShortPassword_shouldReturn400() throws Exception {
        // Given - password less than 8 characters
        RegisterRequest request = new RegisterRequest("test@example.com", "Short1", "Test User");

        // When & Then
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("VALIDATION_9004"));

        verify(authService, never()).register(anyString(), anyString(), anyString());
    }

    @Test
    void register_withPasswordMissingUppercase_shouldReturn400() throws Exception {
        // Given - password without uppercase letter
        RegisterRequest request = new RegisterRequest("test@example.com", "securepass123", "Test User");

        // When & Then
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("VALIDATION_9004"));

        verify(authService, never()).register(anyString(), anyString(), anyString());
    }

    @Test
    void login_withValidCredentials_shouldReturn200WithTokens() throws Exception {
        // Given
        LoginRequest request = new LoginRequest("test@example.com", "SecurePass123");
        AuthResponse authResponse = new AuthResponse(
                "access-token",
                "refresh-token",
                "id-token",
                3600
        );

        when(authService.login(anyString(), anyString())).thenReturn(authResponse);

        // When & Then
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("access-token"))
                .andExpect(jsonPath("$.refreshToken").value("refresh-token"))
                .andExpect(jsonPath("$.idToken").value("id-token"))
                .andExpect(jsonPath("$.expiresIn").value(3600))
                .andExpect(jsonPath("$.tokenType").value("Bearer"));

        verify(authService).login("test@example.com", "SecurePass123");
    }

    @Test
    void login_withInvalidCredentials_shouldReturn401() throws Exception {
        // Given
        LoginRequest request = new LoginRequest("test@example.com", "WrongPassword");

        when(authService.login(anyString(), anyString()))
                .thenThrow(new AuthenticationException("Invalid email or password"));

        // When & Then
        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_5001"))
                .andExpect(jsonPath("$.message").value("Invalid email or password"));
    }

    @Test
    void refreshToken_withValidToken_shouldReturn200() throws Exception {
        // Given
        RefreshTokenRequest request = new RefreshTokenRequest("valid-refresh-token");
        AuthResponse authResponse = new AuthResponse(
                "new-access-token",
                "valid-refresh-token",
                "new-id-token",
                3600
        );

        when(authService.refreshToken(anyString())).thenReturn(authResponse);

        // When & Then
        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("new-access-token"))
                .andExpect(jsonPath("$.refreshToken").value("valid-refresh-token"))
                .andExpect(jsonPath("$.idToken").value("new-id-token"));

        verify(authService).refreshToken("valid-refresh-token");
    }

    @Test
    void refreshToken_withInvalidToken_shouldReturn401() throws Exception {
        // Given
        RefreshTokenRequest request = new RefreshTokenRequest("invalid-refresh-token");

        when(authService.refreshToken(anyString()))
                .thenThrow(new AuthenticationException("Invalid or expired refresh token"));

        // When & Then
        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_5001"));
    }

    @Test
    void logout_withValidToken_shouldReturn200() throws Exception {
        // Given
        doNothing().when(authService).logout(anyString());

        // When & Then
        mockMvc.perform(post("/api/v1/auth/logout")
                        .header("Authorization", "Bearer valid-access-token")
                        )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").value("Logged out successfully"));

        verify(authService).logout("valid-access-token");
    }

    @Test
    void logout_withoutToken_shouldReturn400() throws Exception {
        // When & Then
        mockMvc.perform(post("/api/v1/auth/logout")
                        )
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Access token is required"));

        verify(authService, never()).logout(anyString());
    }

    @Test
    void requestPasswordReset_withValidEmail_shouldReturn200() throws Exception {
        // Given
        PasswordResetRequestDto request = new PasswordResetRequestDto("test@example.com");

        doNothing().when(authService).requestPasswordReset(anyString());

        // When & Then
        mockMvc.perform(post("/api/v1/auth/password-reset/request")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").exists());

        verify(authService).requestPasswordReset("test@example.com");
    }

    @Test
    void requestPasswordReset_withInvalidEmail_shouldReturn400() throws Exception {
        // Given
        PasswordResetRequestDto request = new PasswordResetRequestDto("invalid-email");

        // When & Then
        mockMvc.perform(post("/api/v1/auth/password-reset/request")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("VALIDATION_9004"));

        verify(authService, never()).requestPasswordReset(anyString());
    }

    @Test
    void confirmPasswordReset_withValidData_shouldReturn200() throws Exception {
        // Given
        PasswordResetConfirmRequest request = new PasswordResetConfirmRequest(
                "test@example.com",
                "123456",
                "NewSecurePass123"
        );

        doNothing().when(authService).confirmPasswordReset(anyString(), anyString(), anyString());

        // When & Then
        mockMvc.perform(post("/api/v1/auth/password-reset/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.message").exists());

        verify(authService).confirmPasswordReset("test@example.com", "123456", "NewSecurePass123");
    }

    @Test
    void confirmPasswordReset_withInvalidCode_shouldReturn401() throws Exception {
        // Given
        PasswordResetConfirmRequest request = new PasswordResetConfirmRequest(
                "test@example.com",
                "wrong-code",
                "NewSecurePass123"
        );

        doThrow(new AuthenticationException("Invalid confirmation code"))
                .when(authService).confirmPasswordReset(anyString(), anyString(), anyString());

        // When & Then
        mockMvc.perform(post("/api/v1/auth/password-reset/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_5001"))
                .andExpect(jsonPath("$.message").value("Invalid confirmation code"));
    }

    @Test
    void confirmPasswordReset_withWeakPassword_shouldReturn400() throws Exception {
        // Given - password without number
        PasswordResetConfirmRequest request = new PasswordResetConfirmRequest(
                "test@example.com",
                "123456",
                "WeakPassword"
        );

        // When & Then
        mockMvc.perform(post("/api/v1/auth/password-reset/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request))
                        )
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errorCode").value("VALIDATION_9004"));

        verify(authService, never()).confirmPasswordReset(anyString(), anyString(), anyString());
    }

    @Test
    void exchangeOAuthToken_withValidCode_shouldReturn200WithTokens() throws Exception {
        // Given
        String authCode = "valid-auth-code";
        String redirectUri = "http://localhost:8080/api/v1/auth/oauth/google/callback";
        AuthResponse authResponse = new AuthResponse(
                "access-token",
                "refresh-token",
                "id-token",
                3600
        );

        when(authService.exchangeOAuthCode(anyString(), anyString())).thenReturn(authResponse);

        // When & Then
        mockMvc.perform(post("/api/v1/auth/oauth/token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + authCode + "\",\"redirectUri\":\"" + redirectUri + "\"}")
                        )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("access-token"))
                .andExpect(jsonPath("$.refreshToken").value("refresh-token"))
                .andExpect(jsonPath("$.idToken").value("id-token"))
                .andExpect(jsonPath("$.expiresIn").value(3600))
                .andExpect(jsonPath("$.tokenType").value("Bearer"));

        verify(authService).exchangeOAuthCode(authCode, redirectUri);
    }

    @Test
    void exchangeOAuthToken_withInvalidCode_shouldReturn401() throws Exception {
        // Given
        String authCode = "invalid-code";
        String redirectUri = "http://localhost:8080/api/v1/auth/oauth/google/callback";

        when(authService.exchangeOAuthCode(anyString(), anyString()))
                .thenThrow(new AuthenticationException("OAuth authentication failed: Unable to exchange authorization code"));

        // When & Then
        mockMvc.perform(post("/api/v1/auth/oauth/token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"" + authCode + "\",\"redirectUri\":\"" + redirectUri + "\"}")
                        )
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.errorCode").value("AUTH_5001"));

        verify(authService).exchangeOAuthCode(authCode, redirectUri);
    }
}
