# Task 13.3 - SubscriptionGateFilter Implementation Summary

## Overview
Implemented the `SubscriptionGateFilter` and `@RequiresTier` annotation to enforce subscription tier-based access control on API endpoints. The filter returns HTTP 402 Payment Required with an upgrade prompt when a user attempts to access features not included in their subscription tier.

## Implementation Details

### 1. Created @RequiresTier Annotation
**File:** `modules/api/src/main/java/com/cogschecker/foodcost/api/security/RequiresTier.java`

- Annotation placed on controller methods to specify minimum required subscription tier
- Valid tier values: "free", "pro", "pro_plus"
- Tier hierarchy: free < pro < pro_plus
- Users with a higher tier can access features requiring a lower tier

### 2. Created UpgradePromptResponse DTO
**File:** `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/UpgradePromptResponse.java`

Response payload for HTTP 402 with fields:
- `error`: "Payment Required"
- `message`: User-friendly upgrade message
- `currentTier`: User's current subscription tier
- `requiredTier`: Minimum tier required for the feature
- `upgradePath`: API path to upgrade subscription (`/api/v1/organisations/subscription/upgrade`)

### 3. Implemented SubscriptionGateFilter
**File:** `modules/api/src/main/java/com/cogschecker/foodcost/api/filter/SubscriptionGateFilter.java`

Key features:
- Extends `OncePerRequestFilter` for Spring Security filter chain integration
- Reads `custom:tier` from `CognitoAuthenticationToken` in SecurityContext
- Uses `RequestMappingHandlerMapping` to resolve handler methods and check for `@RequiresTier` annotation
- Implements lazy initialization of handler mapping to avoid circular dependency issues
- Returns HTTP 402 when user's tier is insufficient

**Tier Comparison Logic:**
```java
private static final int TIER_FREE = 0;
private static final int TIER_PRO = 1;
private static final int TIER_PRO_PLUS = 2;
```

- Converts tier strings to numeric levels for comparison
- Allows access if `userTierLevel >= requiredTierLevel`

**Filter Chain Position:**
```
JwtAuthenticationFilter 
  → VenueScopeFilter 
  → SubscriptionGateFilter 
  → Controllers
```

### 4. Updated SecurityConfig
**File:** `modules/api/src/main/java/com/cogschecker/foodcost/api/config/SecurityConfig.java`

- Added `subscriptionGateFilter()` bean creation method
- Registered filter in security filter chain after `VenueScopeFilter`
- Used `@Lazy` annotation to prevent circular dependency during bean creation

### 5. Fixed Pre-existing Bug
**File:** `modules/api/src/main/java/com/cogschecker/foodcost/api/security/CustomMethodSecurityExpressionRoot.java`

- Fixed compilation error where `this.authentication` (private field) was accessed directly
- Changed to use `getAuthentication()` method instead

### 6. Comprehensive Test Suite
**File:** `modules/api/src/test/java/com/cogschecker/foodcost/api/filter/SubscriptionGateFilterTest.java`

Test coverage includes:
- ✅ User with sufficient tier can access endpoint
- ✅ User with higher tier can access endpoints requiring lower tier
- ✅ Returns HTTP 402 when tier is insufficient
- ✅ Free tier blocked from Pro and Pro+ features
- ✅ Pro tier blocked from Pro+ features  
- ✅ Filter skips when no @RequiresTier annotation present
- ✅ Filter continues when no authentication present
- ✅ Filter continues when authentication is not CognitoAuthenticationToken
- ✅ Filter continues when handler method not found
- ✅ Handles null user tier as free tier
- ✅ Response includes upgrade path, current tier, and required tier
- ✅ Correct upgrade messages for Pro and Pro+ tiers

**All 15 tests pass successfully.**

## Usage Example

### Protecting an Endpoint

```java
@RestController
@RequestMapping("/api/v1/venues/{venueId}")
public class SquareController {
    
    @GetMapping("/square/connect")
    @RequiresTier("pro")
    public ResponseEntity<?> connectSquare(@PathVariable UUID venueId) {
        // Only Pro and Pro+ users can access
        // Free tier users receive HTTP 402 with upgrade prompt
    }
    
    @GetMapping("/insights")
    @RequiresTier("pro_plus")
    public ResponseEntity<?> getAiInsights(@PathVariable UUID venueId) {
        // Only Pro+ users can access
        // Free and Pro users receive HTTP 402 with upgrade prompt
    }
}
```

### Example HTTP 402 Response

```json
{
  "error": "Payment Required",
  "message": "This feature requires a Pro subscription. Upgrade to Pro for unlimited recipes, Square POS integration, and invoice upload.",
  "currentTier": "free",
  "requiredTier": "pro",
  "upgradePath": "/api/v1/organisations/subscription/upgrade"
}
```

## Requirements Satisfied

- ✅ **Requirement 11.1**: Default free tier assignment
- ✅ **Requirement 11.2**: Tier limit enforcement (Free, Pro, Pro+ feature gates)
- ✅ **Requirement 11.3**: Upgrade prompt display when accessing unavailable features

## Technical Decisions

### 1. Filter-Based Approach
Chose servlet filter over AOP/annotations because:
- Integrates naturally with Spring Security filter chain
- Executes before controller methods
- Can return HTTP 402 before business logic executes
- Consistent with existing `VenueScopeFilter` pattern

### 2. Lazy Initialization Pattern
Used lazy lookup of `RequestMappingHandlerMapping` via servlet context to avoid circular dependency:
- SecurityFilterChain requires filters
- Filters would require HandlerMapping
- HandlerMapping requires SecurityFilterChain
- Solution: Fetch HandlerMapping on-demand during first filter invocation

### 3. Graceful Degradation
Filter continues filter chain when:
- HandlerMapping not yet initialized (during app startup)
- No authentication present (let Spring Security handle it)
- No @RequiresTier annotation (endpoint doesn't require tier check)
- Handler method not found (static resources, error handlers)

## Notes

- The filter reads the tier from `CognitoAuthenticationToken.getTier()`, which is populated from the `custom:tier` JWT claim set by Amazon Cognito
- The `@Lazy` annotation on the filter parameter in SecurityConfig prevents eager bean initialization that would cause circular dependencies
- The filter uses WebApplicationContextUtils to lazily fetch the RequestMappingHandlerMapping, avoiding the need for constructor injection

## Future Enhancements

1. **Metrics**: Add logging/metrics for tier gate rejections to track feature adoption
2. **Caching**: Cache handler method→tier requirement mappings for performance
3. **Admin Override**: Allow admins to temporarily access higher-tier features for testing
4. **Trial Mode**: Support temporary tier upgrades for trial periods

## Files Modified/Created

### Created:
- `modules/api/src/main/java/com/cogschecker/foodcost/api/security/RequiresTier.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/dto/UpgradePromptResponse.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/filter/SubscriptionGateFilter.java`
- `modules/api/src/test/java/com/cogschecker/foodcost/api/filter/SubscriptionGateFilterTest.java`

### Modified:
- `modules/api/src/main/java/com/cogschecker/foodcost/api/config/SecurityConfig.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/security/CustomMethodSecurityExpressionRoot.java` (bug fix)

## Testing

```bash
# Run filter tests
./gradlew :modules:api:test --tests SubscriptionGateFilterTest

# Run all filter tests
./gradlew :modules:api:test --tests "*Filter*"
```

All SubscriptionGateFilter tests pass successfully (15/15 tests).
