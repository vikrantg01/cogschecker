package com.cogschecker.foodcost.api.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * JWT authentication filter for Cognito tokens.
 * Extracts JWT from Authorization header, verifies signature using JWKS,
 * parses custom claims, and populates SecurityContext with CognitoAuthenticationToken.
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final Logger logger = LoggerFactory.getLogger(JwtAuthenticationFilter.class);
    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtDecoder jwtDecoder;
    private final CognitoJwtConverter jwtConverter;

    public JwtAuthenticationFilter(JwtDecoder jwtDecoder, CognitoJwtConverter jwtConverter) {
        this.jwtDecoder = jwtDecoder;
        this.jwtConverter = jwtConverter;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        try {
            String token = extractToken(request);

            if (token != null) {
                // Decode and verify JWT signature using Cognito JWKS
                Jwt jwt = jwtDecoder.decode(token);

                // Convert JWT to CognitoAuthenticationToken with custom claims
                CognitoAuthenticationToken authentication = jwtConverter.convert(jwt);

                // Set authentication in SecurityContext
                SecurityContextHolder.getContext().setAuthentication(authentication);

                logger.debug("Successfully authenticated user: {}", authentication.getUserId());
            }
        } catch (JwtException e) {
            logger.error("JWT validation failed: {}", e.getMessage());
            // Don't set authentication - request will be rejected by Spring Security
            // if it requires authentication
        }

        filterChain.doFilter(request, response);
    }

    /**
     * Extract JWT token from Authorization header.
     * @param request the HTTP request
     * @return the token string, or null if not present or invalid format
     */
    private String extractToken(HttpServletRequest request) {
        String bearerToken = request.getHeader(AUTHORIZATION_HEADER);

        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith(BEARER_PREFIX)) {
            String token = bearerToken.substring(BEARER_PREFIX.length());
            return StringUtils.hasText(token) ? token : null;
        }

        return null;
    }
}
