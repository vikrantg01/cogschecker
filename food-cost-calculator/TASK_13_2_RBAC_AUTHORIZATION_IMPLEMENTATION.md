# Task 13.2: RBAC Authorization Manager Implementation

## Summary

Implemented `RbacAuthorizationManager` and custom security expression `@PreAuthorize("hasVenueRole('MANAGER', #venueId)")` to support role-based access control at the venue level.

## Components Implemented

### 1. RbacAuthorizationManager
**Path:** `modules/api/src/main/java/com/cogschecker/foodcost/api/security/RbacAuthorizationManager.java`

Provides venue-scoped RBAC authorization logic with two main methods:
- `hasVenueRole(Authentication, String role, String venueId)` - Checks exact role match
- `hasMinimumVenueRole(Authentication, String minimumRole, String venueId)` - Checks role hierarchy (ADMIN > MANAGER > STAFF)

**Features:**
- Case-insensitive role matching
- Role hierarchy support
- Null-safe checks
- Detailed logging for debugging

### 2. CustomMethodSecurityExpressionRoot
**Path:** `modules/api/src/main/java/com/cogschecker/foodcost/api/security/CustomMethodSecurityExpressionRoot.java`

Extends Spring Security's `SecurityExpressionRoot` to provide custom security expressions:
- `hasVenueRole(String role, Object venueId)` - For use in `@PreAuthorize` annotations
- `hasMinimumVenueRole(String minimumRole, Object venueId)` - For hierarchical role checks

**Features:**
- Accepts both String and UUID venue IDs
- Null-safe parameter handling
- Delegates to RbacAuthorizationManager for actual authorization logic

### 3. CustomMethodSecurityExpressionHandler
**Path:** `modules/api/src/main/java/com/cogschecker/foodcost/api/security/CustomMethodSecurityExpressionHandler.java`

Creates `CustomMethodSecurityExpressionRoot` instances for method security evaluation.

### 4. MethodSecurityConfig
**Path:** `modules/api/src/main/java/com/cogschecker/foodcost/api/config/MethodSecurityConfig.java`

Configuration class that:
- Enables method security with `@EnableMethodSecurity`
- Registers the custom expression handler
- Removes "ROLE_" prefix from authorities for simpler expressions

## Testing

### Unit Tests (✅ Passing)

1. **RbacAuthorizationManagerTest** - 18 tests covering:
   - Exact role matching
   - Role hierarchy
   - Case-insensitive matching
   - Multiple venue access
   - Null handling
   - Invalid authentication types

2. **CustomMethodSecurityExpressionRootTest** - 16 tests covering:
   - String and UUID venue ID handling
   - Role expression evaluation
   - Minimum role level checks
   - Method security expression operations
   - Real-world usage scenarios

**Test Results:** All 34 unit tests pass successfully.

## Usage

### In Controllers

```java
@GetMapping
@PreAuthorize("hasVenueRole('STAFF', #venueId) or hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
public ResponseEntity<List<IngredientResponse>> getIngredients(
        @PathVariable UUID venueId,
        @RequestParam(required = false) String q) {
    // Implementation
}

@PostMapping
@PreAuthorize("hasVenueRole('MANAGER', #venueId) or hasVenueRole('ADMIN', #venueId)")
public ResponseEntity<IngredientResponse> createIngredient(
        @PathVariable UUID venueId,
        @Valid @RequestBody CreateIngredientRequest request) {
    // Implementation
}
```

### Alternative: Using Role Hierarchy

```java
@GetMapping
@PreAuthorize("hasMinimumVenueRole('STAFF', #venueId)")
public ResponseEntity<List<IngredientResponse>> getIngredients(@PathVariable UUID venueId) {
    // Allows STAFF, MANAGER, and ADMIN
}

@PostMapping
@PreAuthorize("hasMinimumVenueRole('MANAGER', #venueId)")
public ResponseEntity<IngredientResponse> createIngredient(@PathVariable UUID venueId) {
    // Allows MANAGER and ADMIN only
}
```

## Requirements Validation

✅ **Requirement 7.3** - Data Persistence: Authorization manager persists throughout session lifecycle  
✅ **Requirement 9.1** - Three roles supported: ADMIN, MANAGER, STAFF with exact matching  
✅ **Requirement 9.2** - Admin full access: Role hierarchy allows ADMIN to access all endpoints  
✅ **Requirement 9.3** - Manager venue-scoped access: Managers can only access their assigned venues  

## Architecture

The RBAC system works in layers:

1. **JWT Authentication** (`JwtAuthenticationFilter`):
   - Extracts and validates Cognito JWT
   - Creates `CognitoAuthenticationToken` with venue roles

2. **Venue Scope Validation** (`VenueScopeFilter`):
   - Verifies venueId in URL belongs to user's organization
   - Returns 403 Forbidden if no access

3. **Method-Level Authorization** (`RbacAuthorizationManager` + `@PreAuthorize`):
   - Evaluates role requirements for specific methods
   - Checks if user has required role for the venue
   - Returns 403 Forbidden if role check fails

## Integration with Existing Code

The `RbacAuthorizationManager` integrates with:
- `CognitoAuthenticationToken` - Provides venue roles from JWT custom claims
- `@PreAuthorize` annotations on controller methods - Existing annotations now work
- Spring Security's method security infrastructure - Automatic evaluation

## Notes

### Controller Test Compatibility

Existing `@WebMvcTest` controller tests may need updates to work with method security:

1. Import `TestSecurityConfig` to provide required beans
2. Use `@WithMockUser` or mock `CognitoAuthenticationToken` for authentication
3. Mock the `RbacAuthorizationManager` bean if needed

Example:
```java
@WebMvcTest(IngredientController.class)
@Import(TestSecurityConfig.class)
class IngredientControllerTest {
    // Tests...
}
```

### Spring Security 6.x Compatibility

This implementation uses Spring Security 6.x's method security approach with:
- `@EnableMethodSecurity` (instead of deprecated `@EnableGlobalMethodSecurity`)
- Custom `MethodSecurityExpressionHandler` for expression evaluation
- `GrantedAuthorityDefaults` to remove "ROLE_" prefix

## Future Enhancements

1. **Caching**: Add caching for role lookups to improve performance
2. **Audit Logging**: Log authorization decisions for security auditing
3. **Custom Annotations**: Create `@RequiresVenueRole` annotation for cleaner syntax
4. **Integration Tests**: Add end-to-end tests with real HTTP requests

## References

- Design Document: Section "Authentication and Authorisation Architecture"
- Requirements: 7.3, 9.1, 9.2, 9.3
- Related Tasks: 12.1 (JWT Filter), 12.2 (Auth Controller), 13.1 (Venue Scope Filter)
