package com.cogschecker.foodcost.api.filter;

import com.cogschecker.foodcost.api.dto.UpgradePromptResponse;
import com.cogschecker.foodcost.api.security.CognitoAuthenticationToken;
import com.cogschecker.foodcost.api.security.RequiresTier;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.BeansException;
import org.springframework.context.ApplicationContext;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.context.support.WebApplicationContextUtils;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerExecutionChain;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.io.IOException;

/**
 * Filter that enforces subscription tier requirements on controller endpoints.
 * Checks if the user's subscription tier meets the minimum tier required by the @RequiresTier annotation.
 * Returns HTTP 402 Payment Required with an upgrade prompt if the tier is insufficient.
 * 
 * Tier hierarchy: free < pro < pro_plus
 * 
 * Requirements: 11.2, 11.3
 */
public class SubscriptionGateFilter extends OncePerRequestFilter {

    private static final Logger logger = LoggerFactory.getLogger(SubscriptionGateFilter.class);
    private static final int TIER_FREE = 0;
    private static final int TIER_PRO = 1;
    private static final int TIER_PRO_PLUS = 2;

    private RequestMappingHandlerMapping handlerMapping;
    private final ObjectMapper objectMapper;

    public SubscriptionGateFilter(RequestMappingHandlerMapping handlerMapping, ObjectMapper objectMapper) {
        this.handlerMapping = handlerMapping;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {

        // Get authentication from SecurityContext
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        // If not authenticated or not a CognitoAuthenticationToken, continue
        if (authentication == null || !(authentication instanceof CognitoAuthenticationToken)) {
            filterChain.doFilter(request, response);
            return;
        }

        CognitoAuthenticationToken cognitoAuth = (CognitoAuthenticationToken) authentication;
        String userTier = cognitoAuth.getTier();

        // Get the handler method for this request
        HandlerMethod handlerMethod = getHandlerMethod(request);

        // If no handler found or not a controller method, continue
        if (handlerMethod == null) {
            filterChain.doFilter(request, response);
            return;
        }

        // Check if the method has @RequiresTier annotation
        RequiresTier requiresTier = handlerMethod.getMethodAnnotation(RequiresTier.class);

        // If no tier requirement, continue
        if (requiresTier == null) {
            filterChain.doFilter(request, response);
            return;
        }

        String requiredTier = requiresTier.value();

        // Compare tier levels
        if (!hasSufficientTier(userTier, requiredTier)) {
            logger.warn("User {} with tier '{}' attempted to access endpoint requiring tier '{}'",
                    cognitoAuth.getUserId(), userTier, requiredTier);

            sendUpgradePrompt(response, userTier, requiredTier);
            return;
        }

        logger.debug("Subscription gate validation passed for user {} with tier '{}' accessing endpoint requiring '{}'",
                cognitoAuth.getUserId(), userTier, requiredTier);

        filterChain.doFilter(request, response);
    }

    /**
     * Get the HandlerMethod for the current request.
     * Returns null if the handler is not a HandlerMethod (e.g., static resources) or if handlerMapping is not yet initialized.
     * Lazily initializes handlerMapping from WebApplicationContext to avoid circular dependency.
     */
    private HandlerMethod getHandlerMethod(HttpServletRequest request) {
        // Lazy initialization of handlerMapping to avoid circular dependency
        if (handlerMapping == null) {
            try {
                ApplicationContext context = WebApplicationContextUtils.getWebApplicationContext(request.getServletContext());
                if (context != null) {
                    handlerMapping = context.getBean(RequestMappingHandlerMapping.class);
                }
            } catch (BeansException e) {
                logger.debug("Could not retrieve RequestMappingHandlerMapping from ApplicationContext", e);
                return null;
            }
        }
        
        // If handlerMapping is still not available, skip tier checking
        if (handlerMapping == null) {
            logger.debug("HandlerMapping not yet initialized, skipping tier check");
            return null;
        }
        
        try {
            HandlerExecutionChain handlerChain = handlerMapping.getHandler(request);
            if (handlerChain != null && handlerChain.getHandler() instanceof HandlerMethod) {
                return (HandlerMethod) handlerChain.getHandler();
            }
        } catch (Exception e) {
            logger.debug("Could not resolve handler method for request: {}", request.getRequestURI(), e);
        }
        return null;
    }

    /**
     * Check if the user's tier meets the required tier level.
     * Tier hierarchy: free < pro < pro_plus
     */
    private boolean hasSufficientTier(String userTier, String requiredTier) {
        int userLevel = getTierLevel(userTier);
        int requiredLevel = getTierLevel(requiredTier);
        return userLevel >= requiredLevel;
    }

    /**
     * Map tier string to numeric level for comparison.
     */
    private int getTierLevel(String tier) {
        if (tier == null) {
            return TIER_FREE;
        }
        switch (tier.toLowerCase()) {
            case "pro":
                return TIER_PRO;
            case "pro_plus":
                return TIER_PRO_PLUS;
            case "free":
            default:
                return TIER_FREE;
        }
    }

    /**
     * Send HTTP 402 Payment Required response with upgrade prompt payload.
     */
    private void sendUpgradePrompt(HttpServletResponse response, String currentTier, String requiredTier) throws IOException {
        UpgradePromptResponse upgradePrompt = new UpgradePromptResponse(
                "Payment Required",
                buildUpgradeMessage(requiredTier),
                currentTier != null ? currentTier : "free",
                requiredTier,
                "/api/v1/organisations/subscription/upgrade"
        );

        response.setStatus(HttpServletResponse.SC_PAYMENT_REQUIRED); // 402
        response.setContentType("application/json");
        response.getWriter().write(objectMapper.writeValueAsString(upgradePrompt));
    }

    /**
     * Build a user-friendly upgrade message based on the required tier.
     */
    private String buildUpgradeMessage(String requiredTier) {
        switch (requiredTier.toLowerCase()) {
            case "pro":
                return "This feature requires a Pro subscription. Upgrade to Pro for unlimited recipes, Square POS integration, and invoice upload.";
            case "pro_plus":
                return "This feature requires a Pro+ subscription. Upgrade to Pro+ for all Pro features plus AI-driven insights.";
            default:
                return "This feature requires a higher subscription tier. Please upgrade your plan.";
        }
    }
}
