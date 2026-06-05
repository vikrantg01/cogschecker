# API Module Scaffold Summary

This document summarizes the scaffolding work completed for task 2.3.

## Dependencies Added (build.gradle)

### Database
- PostgreSQL JDBC driver (runtime only)
- Flyway Core
- Flyway PostgreSQL support

### AWS Services
- Spring Cloud AWS SQS Starter (3.1.0)

### Security
- Spring Boot OAuth2 Resource Server (for Cognito JWT validation)

### Testing
- H2 Database (for test profile)
- Spring Security Test

## Configuration Classes Created

### 1. SecurityConfig
**Location:** `com.cogschecker.foodcost.api.config.SecurityConfig`

**Features:**
- Stateless session management (JWT-based)
- Public endpoints for auth and webhooks
- Method-level security enabled (@PreAuthorize support)
- Integration with placeholder JWT filter
- CSRF disabled (API-only, no session cookies)

### 2. JwtAuthenticationFilter (Placeholder)
**Location:** `com.cogschecker.foodcost.api.security.JwtAuthenticationFilter`

**Features:**
- Placeholder implementation for task 7.1
- TODO markers for Cognito JWT verification
- Extends OncePerRequestFilter

### 3. CorsConfig
**Location:** `com.cogschecker.foodcost.api.config.CorsConfig`

**Features:**
- Configurable allowed origins (default: localhost:5173, localhost:3000)
- Supports all standard HTTP methods
- Exposes X-Total-Count header for pagination
- Credentials enabled for cookie-based sessions
- 1-hour preflight cache

### 4. JacksonConfig
**Location:** `com.cogschecker.foodcost.api.config.JacksonConfig`

**Features:**
- snake_case property naming (e.g., foodCostPerPortion → food_cost_per_portion)
- BigDecimal serialized as strings to preserve precision
- UTC timezone for all timestamps
- ISO-8601 date/time format (not Unix timestamps)
- Ignores unknown properties (forward compatibility)
- Excludes null values from JSON output

### 5. BigDecimalAsStringSerializer
**Location:** `com.cogschecker.foodcost.api.config.BigDecimalAsStringSerializer`

**Features:**
- Custom Jackson serializer for BigDecimal
- Writes values as JSON strings (not floats)
- Prevents precision loss in financial calculations

## Exception Handling

### ErrorResponse DTO
**Location:** `com.cogschecker.foodcost.api.dto.ErrorResponse`

**Structure:**
```json
{
  "error_code": "INGREDIENT_1001",
  "message": "Ingredient name already exists",
  "timestamp": "2024-01-15T12:34:56.789Z",
  "path": "/api/v1/venues/abc/ingredients",
  "details": {
    "field": "name",
    "value": "Flour"
  }
}
```

### Domain Exception Base Class
**Location:** `com.cogschecker.foodcost.api.exception.DomainException`

**Features:**
- Abstract base for all domain exceptions
- Carries error code and optional details map
- Supports exception chaining

### Concrete Exception Classes

1. **ResourceNotFoundException** - HTTP 404
2. **DuplicateResourceException** - HTTP 409
3. **ValidationException** - HTTP 400
4. **InsufficientPermissionsException** - HTTP 403
5. **SubscriptionTierException** - HTTP 402 (Payment Required)

### GlobalExceptionHandler
**Location:** `com.cogschecker.foodcost.api.exception.GlobalExceptionHandler`

**Handles:**
- All custom DomainException types
- IncompatibleUomException from shared module
- Spring validation errors (@Valid)
- Constraint violations (@NotNull, etc.)
- Spring Security AccessDeniedException
- Generic unhandled exceptions (500)

**Features:**
- Maps all exceptions to standard ErrorResponse format
- Logs errors appropriately (warn for business errors, error for unexpected)
- Includes field-level validation details
- Extracts UOM dimension information for conversion errors

## Application Configuration

### application.properties
Added configurations for:
- Database (Aurora PostgreSQL with fallback to localhost)
- JPA/Hibernate (validate mode, PostgreSQL dialect, UTC timezone)
- Flyway migrations (enabled, baseline-on-migrate)
- Redis (ElastiCache with fallback to localhost)
- AWS SQS (region and credentials)
- CORS (configurable allowed origins)

### test/resources/application-test.properties
Test-specific configuration:
- H2 in-memory database (PostgreSQL mode)
- Flyway disabled
- Redis autoconfiguration disabled
- Mock AWS credentials

## Database Migrations

**Location:** `src/main/resources/db/migration/`

- Directory created with .gitkeep
- Ready for Flyway migration scripts
- Migrations will be added in subsequent tasks

## Tests Created

### 1. ConfigurationTest
**Location:** `com.cogschecker.foodcost.api.config.ConfigurationTest`

**Tests:**
- ObjectMapper uses snake_case
- ObjectMapper uses UTC timezone
- BigDecimal serialized as string
- SecurityFilterChain properly configured
- CorsConfigurationSource properly configured

### 2. GlobalExceptionHandlerTest
**Location:** `com.cogschecker.foodcost.api.exception.GlobalExceptionHandlerTest`

**Tests:**
- ResourceNotFoundException → 404
- DuplicateResourceException → 409
- ValidationException → 400 with details
- InsufficientPermissionsException → 403
- SubscriptionTierException → 402
- IncompatibleUomException → 400 with UOM details
- AccessDeniedException → 403
- Generic Exception → 500

## Verification

✅ All code compiles successfully
✅ All tests pass (10/10)
✅ Integration with shared module works
✅ H2 test configuration allows tests without PostgreSQL
✅ Gradle build completes successfully

## Next Steps

This scaffold is ready for:
- Database schema migrations (Flyway)
- Domain entities (JPA)
- Service layer implementation
- Controller layer implementation
- Full JWT authentication (task 7.1)
- Integration with AWS services (Cognito, SQS, etc.)
