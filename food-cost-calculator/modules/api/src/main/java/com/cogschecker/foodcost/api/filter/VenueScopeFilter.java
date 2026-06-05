package com.cogschecker.foodcost.api.filter;

import com.cogschecker.foodcost.api.security.CognitoAuthenticationToken;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.servlet.HandlerMapping;

import java.io.IOException;
import java.util.Map;

/**
 * Filter that validates venueId from request path belongs to the user's organisation.
 * Extracts venueId from path variables and verifies it exists in the user's venue roles.
 * Returns HTTP 403 Forbidden if the venue does not belong to the user's organisation.
 * 
 * Requirements: 7.2, 10.3 - Data scoping and venue isolation
 */
public class VenueScopeFilter extends OncePerRequestFilter {

    private static final Logger logger = LoggerFactory.getLogger(VenueScopeFilter.class);
    private static final String VENUE_ID_PATH_VAR = "venueId";

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        // Get authentication from SecurityContext first
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        // If not authenticated or not a CognitoAuthenticationToken, let Spring Security handle it
        if (authentication == null || !(authentication instanceof CognitoAuthenticationToken)) {
            filterChain.doFilter(request, response);
            return;
        }

        // Extract venueId from path variables
        String venueId = extractVenueId(request);

        // If no venueId in path, continue without validation
        if (venueId == null) {
            filterChain.doFilter(request, response);
            return;
        }

        CognitoAuthenticationToken cognitoAuth = (CognitoAuthenticationToken) authentication;

        // Verify the venueId belongs to the user's organisation
        if (!cognitoAuth.hasAccessToVenue(venueId)) {
            logger.warn("User {} attempted to access venue {} which does not belong to their organisation {}",
                    cognitoAuth.getUserId(), venueId, cognitoAuth.getOrganisationId());
            
            response.setStatus(HttpServletResponse.SC_FORBIDDEN);
            response.setContentType("application/json");
            response.getWriter().write("{\"error\":\"Forbidden\",\"message\":\"You do not have access to this venue\"}");
            return;
        }

        logger.debug("Venue scope validation passed for user {} accessing venue {}",
                cognitoAuth.getUserId(), venueId);

        filterChain.doFilter(request, response);
    }

    /**
     * Extract venueId from request path variables.
     * Uses Spring's HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE set by the DispatcherServlet.
     * 
     * @param request the HTTP request
     * @return the venueId string, or null if not present in the path
     */
    @SuppressWarnings("unchecked")
    private String extractVenueId(HttpServletRequest request) {
        Map<String, String> pathVariables = 
            (Map<String, String>) request.getAttribute(HandlerMapping.URI_TEMPLATE_VARIABLES_ATTRIBUTE);

        if (pathVariables != null && pathVariables.containsKey(VENUE_ID_PATH_VAR)) {
            return pathVariables.get(VENUE_ID_PATH_VAR);
        }

        return null;
    }
}
