package com.cogschecker.foodcost.api.security;

import org.aopalliance.intercept.MethodInvocation;
import org.springframework.security.access.expression.method.DefaultMethodSecurityExpressionHandler;
import org.springframework.security.access.expression.method.MethodSecurityExpressionOperations;
import org.springframework.security.authentication.AuthenticationTrustResolver;
import org.springframework.security.authentication.AuthenticationTrustResolverImpl;
import org.springframework.security.core.Authentication;

/**
 * Custom method security expression handler that creates CustomMethodSecurityExpressionRoot
 * instances to provide custom security expressions like hasVenueRole().
 * 
 * Requirements: 7.3, 9.1, 9.2, 9.3
 */
public class CustomMethodSecurityExpressionHandler extends DefaultMethodSecurityExpressionHandler {

    private final RbacAuthorizationManager rbacAuthorizationManager;
    private final AuthenticationTrustResolver trustResolver = new AuthenticationTrustResolverImpl();

    public CustomMethodSecurityExpressionHandler(RbacAuthorizationManager rbacAuthorizationManager) {
        this.rbacAuthorizationManager = rbacAuthorizationManager;
    }

    @Override
    protected MethodSecurityExpressionOperations createSecurityExpressionRoot(
            Authentication authentication, MethodInvocation invocation) {
        
        CustomMethodSecurityExpressionRoot root = 
                new CustomMethodSecurityExpressionRoot(authentication, rbacAuthorizationManager);
        
        root.setPermissionEvaluator(getPermissionEvaluator());
        root.setTrustResolver(trustResolver);
        root.setRoleHierarchy(getRoleHierarchy());
        
        return root;
    }
}
