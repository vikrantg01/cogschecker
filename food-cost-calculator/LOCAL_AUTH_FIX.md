# Local Authentication Fix

## Problem
The frontend was getting 403 Forbidden errors when trying to create venues because:
1. The mock auth tokens from `TestAuthController` couldn't be validated by the JWT decoder
2. The JWT decoder was configured to use real Cognito JWKS URI even in local profile
3. Organisation admin roles weren't being set up for the test user

## Solution

### 1. Created LocalJwtConfig (@Profile("local"))
- Provides a mock `JwtDecoder` that accepts any token
- Returns JWT with test organisation claims:
  - `sub`: `00000000-0000-0000-0000-000000000002` (test user UUID)
  - `email`: `test@example.com`
  - `custom:org_id`: `00000000-0000-0000-0000-000000000001` (test org UUID)
  - `custom:tier`: `FREE`
  - `custom:venue_roles`: `{}` (empty venue roles)

### 2. Set Up Test Data in Database
Inserted test records into PostgreSQL:
```sql
-- Test organisation
INSERT INTO organisations (id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Organisation');

-- Test subscription (note: tier must be uppercase to match Java enum)
INSERT INTO subscriptions (organisation_id, tier)
VALUES ('00000000-0000-0000-0000-000000000001', 'FREE');

-- Test user
INSERT INTO users (id, email, display_name)
VALUES ('00000000-0000-0000-0000-000000000002', 'test@example.com', 'Test User');

-- Grant admin role
INSERT INTO user_organisation_roles (user_id, organisation_id, is_admin)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', true);
```

**Important**: The subscription tier must be uppercase (`'FREE'`, `'PRO'`, `'PRO_PLUS'`) to match the Java `SubscriptionTier` enum. The database check constraints were updated to accept uppercase values.

### 3. Updated Frontend to Use Test Organisation UUID
- Replaced all instances of `'temp-org-id'` with `'00000000-0000-0000-0000-000000000001'`
- Files updated:
  - `VenueCreatePage.tsx`
  - `VenueRenamePage.tsx`
  - `VenueDeletePage.tsx`
  - `CrossVenueSummaryPage.tsx`

### 4. Local Development Workaround for Method Security
Created `LocalSecurityConfig` to bypass `@PreAuthorize` checks in local profile only:
- Disables method security expressions that use custom methods like `hasOrganisationRole()`
- Allows authenticated requests to pass through
- **Only active in 'local' profile** - production uses full RBAC

## How It Works

1. **Frontend login**: User logs in with test credentials, receives mock JWT token from `TestAuthController`
2. **Backend authentication**: 
   - `LocalJwtConfig` JWT decoder accepts the mock token
   - Creates JWT with test user/org claims
   - `CognitoJwtConverter` converts JWT to `CognitoAuthenticationToken`
3. **Authorization (Local Only)**:
   - `LocalSecurityConfig` provides a permissive method security configuration
   - All authenticated requests are allowed through
   - Production still uses full RBAC with custom security expressions

## Testing

Try creating a venue:
```bash
curl -X POST http://localhost:8080/api/v1/organisations/00000000-0000-0000-0000-000000000001/venues \
  -H "Authorization: Bearer any-token-works" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Venue","address":"123 Test St"}'
```

Should return `201 Created` with venue details.

## Known Issue: Custom Security Expressions

**Issue**: The custom `hasOrganisationRole()` security expression fails to evaluate in Spring Security 6.x

**Error**: `Failed to evaluate expression 'hasOrganisationRole('ADMIN', #orgId)'`

**Root Cause**: The `CustomMethodSecurityExpressionHandler` is not being properly registered with Spring Security's method security infrastructure in Spring Security 6.x. The expression evaluator cannot find the custom method defined in `CustomMethodSecurityExpressionRoot`.

**Investigation Summary**:
- JWT authentication works correctly (tokens are decoded and converted to `CognitoAuthenticationToken`)
- The `CustomMethodSecurityExpressionHandler` bean is created but not used by Spring Security
- The SpEL evaluator throws `IllegalArgumentException` before the custom method is ever invoked
- Similar issue affects `hasVenueRole()` and other custom security expressions

**Production Impact**: This affects organization-level endpoints (venue CRUD) but not venue-scoped endpoints which may use different authorization patterns.

**Workaround**: For local development, `LocalSecurityConfig` bypasses all method security checks. For production, this issue needs to be resolved by properly configuring the custom expression handler for Spring Security 6.x.

**TODO**: 
- Research Spring Security 6.x documentation for proper custom expression handler configuration
- Consider migrating to `@PostAuthorize` or programmatic authorization checks
- Add integration tests for RBAC to catch these issues earlier

## Important Notes

- **Local profile only**: These changes are only active when `spring.profiles.active=local`
- **Do not use in production**: The mock JWT decoder and permissive authorization bypass all security
- **Test UUIDs**: Using well-known UUIDs (all zeros with sequential IDs) for easy identification
- **Database persistence**: Test data persists across restarts unless you drop the database
- **Security bypass**: Local development has NO authorization checks - any authenticated request is allowed

## Files Modified

1. `modules/api/src/main/java/com/cogschecker/foodcost/api/config/LocalJwtConfig.java` - Created mock JWT decoder
2. `modules/api/src/main/java/com/cogschecker/foodcost/api/config/LocalSecurityConfig.java` - Created permissive method security (NEW)
3. `modules/api/src/main/java/com/cogschecker/foodcost/api/security/CustomMethodSecurityExpressionRoot.java` - Added hasOrganisationRole (has issues)
4. `frontend/src/features/venues/*.tsx` - Updated temp-org-id to UUID
5. Database schema - Updated subscription tier check constraints to use uppercase enum values

## Additional Issues Fixed

### Subscription Tier Enum Case Mismatch
**Issue**: Database check constraints used lowercase values (`'free'`, `'pro'`, `'pro_plus'`) but the Java `SubscriptionTier` enum uses uppercase (`FREE`, `PRO`, `PRO_PLUS`). This caused a runtime error when creating venues.

**Error**: `java.lang.IllegalArgumentException: No enum constant com.cogschecker.foodcost.api.domain.SubscriptionTier.free`

**Solution**: Updated database schema to use uppercase values:
```sql
-- Drop old constraints
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_tier_check;
ALTER TABLE subscriptions DROP CONSTRAINT subscriptions_pending_downgrade_tier_check;

-- Update existing data
UPDATE subscriptions SET tier = UPPER(tier);

-- Recreate with uppercase values
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_tier_check 
  CHECK (tier IN ('FREE', 'PRO', 'PRO_PLUS'));

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_pending_downgrade_tier_check 
  CHECK (pending_downgrade_tier IN ('FREE', 'PRO', 'PRO_PLUS') OR pending_downgrade_tier IS NULL);
```

**Note**: For production, this should be done via a Flyway migration script.
