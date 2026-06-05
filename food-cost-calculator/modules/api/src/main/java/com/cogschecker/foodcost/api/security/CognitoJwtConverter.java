package com.cogschecker.foodcost.api.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.convert.converter.Converter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Converts a Cognito JWT into a CognitoAuthenticationToken.
 * Extracts custom claims (org_id, venue_roles, tier) and builds GrantedAuthority list.
 */
@Component
public class CognitoJwtConverter implements Converter<Jwt, CognitoAuthenticationToken> {

    private static final Logger logger = LoggerFactory.getLogger(CognitoJwtConverter.class);
    private static final String CLAIM_ORG_ID = "custom:org_id";
    private static final String CLAIM_VENUE_ROLES = "custom:venue_roles";
    private static final String CLAIM_TIER = "custom:tier";
    private static final String CLAIM_EMAIL = "email";

    private final ObjectMapper objectMapper;

    public CognitoJwtConverter(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public CognitoAuthenticationToken convert(Jwt jwt) {
        String userId = jwt.getSubject();
        String email = jwt.getClaimAsString(CLAIM_EMAIL);
        String organisationId = jwt.getClaimAsString(CLAIM_ORG_ID);
        String tier = jwt.getClaimAsString(CLAIM_TIER);

        // Parse venue_roles from JSON string
        Map<String, String> venueRoles = parseVenueRoles(jwt.getClaimAsString(CLAIM_VENUE_ROLES));

        // Build GrantedAuthority list from venue roles
        Collection<GrantedAuthority> authorities = buildAuthorities(venueRoles);

        logger.debug("Converted JWT for user {} with org {} and {} venue roles",
                userId, organisationId, venueRoles.size());

        return new CognitoAuthenticationToken(
                userId,
                email,
                organisationId,
                venueRoles,
                tier,
                authorities
        );
    }

    /**
     * Parse the venue_roles JSON string into a Map.
     * Expected format: {"venue-uuid-1":"admin","venue-uuid-2":"manager"}
     */
    private Map<String, String> parseVenueRoles(String venueRolesJson) {
        if (venueRolesJson == null || venueRolesJson.isEmpty()) {
            logger.warn("No venue_roles claim found in JWT");
            return Collections.emptyMap();
        }

        try {
            Map<String, String> roles = objectMapper.readValue(
                    venueRolesJson,
                    new TypeReference<Map<String, String>>() {}
            );
            return roles != null ? roles : Collections.emptyMap();
        } catch (JsonProcessingException e) {
            logger.error("Failed to parse venue_roles JSON: {}", venueRolesJson, e);
            return Collections.emptyMap();
        }
    }

    /**
     * Build GrantedAuthority list from venue roles.
     * Creates authorities in the format: ROLE_VENUE_{venueId}_{role}
     * Example: ROLE_VENUE_abc-123_ADMIN, ROLE_VENUE_def-456_MANAGER
     */
    private Collection<GrantedAuthority> buildAuthorities(Map<String, String> venueRoles) {
        if (venueRoles.isEmpty()) {
            return Collections.emptyList();
        }

        return venueRoles.entrySet().stream()
                .map(entry -> {
                    String venueId = entry.getKey();
                    String role = entry.getValue().toUpperCase();
                    String authority = String.format("ROLE_VENUE_%s_%s", venueId, role);
                    return new SimpleGrantedAuthority(authority);
                })
                .collect(Collectors.toList());
    }
}
