# Task 16.1: Square OAuth Flow Implementation

## Summary

Successfully implemented the Square OAuth flow with two endpoints for connecting Square POS accounts to venues. The implementation includes encrypted token storage using AWS KMS and follows the design specifications from requirements 12.1.

## Components Implemented

### 1. Domain Entity
- **SquareConnection** (`domain/SquareConnection.java`)
  - JPA entity for `square_connections` table
  - Stores venue ID, merchant ID, encrypted tokens, expiry time, sync status
  - Includes enum `SyncStatus` (IDLE, SYNCING, ERROR)

### 2. Repository
- **SquareConnectionRepository** (`repository/SquareConnectionRepository.java`)
  - JPA repository with methods:
    - `findByVenueId(UUID)` - Find connection by venue
    - `existsByVenueId(UUID)` - Check if connection exists
    - `deleteByVenueId(UUID)` - Delete connection

### 3. Services

#### EncryptionService (`service/EncryptionService.java`)
- Handles KMS-based encryption/decryption of Square tokens
- Methods:
  - `encryptSquareToken(String)` - Encrypts using KMS CMK
  - `decryptSquareToken(byte[])` - Decrypts using KMS
- Uses AWS KMS SDK with envelope encryption pattern

#### SquareOAuthService (`service/SquareOAuthService.java`)
- Core OAuth flow logic
- Methods:
  - `getAuthorizationUrl(UUID venueId)` - Generates Square OAuth URL
  - `exchangeCodeForTokens(UUID venueId, String code)` - Exchanges authorization code for tokens
  - `getConnection(UUID venueId)` - Retrieves connection for venue
  - `isConnected(UUID venueId)` - Checks connection status
  - `disconnect(UUID venueId)` - Removes connection
- Loads Square OAuth credentials from AWS Secrets Manager
- Makes HTTP requests to Square OAuth endpoints using RestTemplate
- Encrypts tokens before database storage

### 4. Controller
- **SquareController** (`controller/SquareController.java`)
- Endpoints:
  1. **GET `/api/v1/venues/:venueId/square/connect`**
     - Initiates OAuth flow by redirecting to Square authorization page
     - Admin-only endpoint (RBAC enforced with `@PreAuthorize`)
     - Uses venueId as OAuth state parameter for CSRF protection
  
  2. **GET `/api/v1/venues/:venueId/square/callback`**
     - Handles OAuth callback from Square
     - Validates state parameter matches venueId
     - Exchanges authorization code for access/refresh tokens
     - Encrypts and stores tokens in database
     - Returns connection status
  
  3. **GET `/api/v1/venues/:venueId/square/connection`**
     - Gets current connection status for a venue
     - Manager-level access
  
  4. **DELETE `/api/v1/venues/:venueId/square/connection`**
     - Disconnects Square integration
     - Admin-only

### 5. DTOs
- **SquareConnectionResponse** (`dto/SquareConnectionResponse.java`)
  - Response DTO with venue ID, merchant ID, connection status, sync info
  - Uses Jackson `@JsonProperty` for snake_case serialization

### 6. Configuration

#### AwsConfig (`config/AwsConfig.java`)
- Provides AWS SDK clients as Spring beans:
  - `KmsClient` - For KMS encryption
  - `SecretsManagerClient` - For loading Square OAuth credentials
  - `RestTemplate` - For HTTP requests to Square API
- Profile-based: only loaded when profile != "test"

#### TestAwsConfig (`config/TestAwsConfig.java`)
- Test configuration providing mock AWS clients
- Only loaded in test profile

### 7. Configuration Properties
Added to `application.properties`:
```properties
# AWS KMS Configuration
aws.kms.square-token-key-id=${AWS_KMS_SQUARE_TOKEN_KEY_ID:}

# Square OAuth Configuration
square.oauth.secret-name=${SQUARE_OAUTH_SECRET_NAME:fcc-square-oauth-dev}
square.oauth.callback-url=${SQUARE_OAUTH_CALLBACK_URL:http://localhost:8080/api/v1/venues/{venueId}/square/callback}
square.environment=${SQUARE_ENVIRONMENT:sandbox}
```

### 8. Dependencies Added
Updated `build.gradle`:
- `software.amazon.awssdk:kms` - KMS client
- `software.amazon.awssdk:secretsmanager` - Secrets Manager client

### 9. Tests
- **SquareOAuthServiceTest** (`service/SquareOAuthServiceTest.java`)
  - Unit tests for OAuth flow:
    - Authorization URL generation
    - Token exchange
    - Connection status checks
    - Disconnection
  - All tests passing

## Security Features

1. **Encrypted Token Storage**
   - Access and refresh tokens encrypted using AWS KMS before database storage
   - Uses Customer Managed Key (CMK) dedicated to Square tokens
   - Envelope encryption pattern

2. **OAuth State Parameter**
   - Uses venueId as state parameter for CSRF protection
   - Validates state matches venueId in callback

3. **RBAC Authorization**
   - Connect/disconnect: Admin-only (`@PreAuthorize("hasVenueRole('ADMIN', #venueId)")`)
   - View connection: Manager-level access

4. **Secure Credential Storage**
   - Square OAuth credentials (app ID and secret) stored in AWS Secrets Manager
   - Loaded on-demand and cached in memory
   - Not logged or exposed in responses

## OAuth Flow

```
1. Admin requests connection: GET /venues/:id/square/connect
2. Controller generates Square OAuth URL with:
   - client_id from Secrets Manager
   - scopes: MERCHANT_PROFILE_READ+ITEMS_READ+ORDERS_READ
   - state: venueId (for CSRF)
3. User redirects to Square authorization page
4. User authorizes
5. Square redirects to: GET /venues/:id/square/callback?code=...&state=...
6. Controller validates state parameter
7. Service exchanges code for tokens via Square API
8. Service encrypts tokens using KMS
9. Service stores SquareConnection entity with encrypted tokens
10. Returns connection confirmation
```

## Database Schema

The `square_connections` table was already created in V3 migration:
- `id` (UUID, PK)
- `venue_id` (UUID, FK to venues, UNIQUE)
- `square_merchant_id` (VARCHAR, NOT NULL)
- `access_token_encrypted` (BYTEA, NOT NULL)
- `refresh_token_encrypted` (BYTEA, NOT NULL)
- `token_expires_at` (TIMESTAMPTZ, NOT NULL)
- `last_synced_at` (TIMESTAMPTZ, nullable)
- `sync_status` (VARCHAR, default 'idle')
- `created_at`, `updated_at` (TIMESTAMPTZ)

## Requirements Satisfied

✅ **Requirement 12.1**: Square OAuth authorization flow
- OAuth connect endpoint redirects to Square
- OAuth callback exchanges code for tokens
- Tokens encrypted with KMS before storage
- Pro/Pro+ tier feature (enforced via RBAC)

## Testing

```bash
# Run Square OAuth service tests
./gradlew :modules:api:test --tests SquareOAuthServiceTest

# Build without tests
./gradlew :modules:api:build -x test
```

All Square-specific tests pass. Build succeeds without errors.

## Environment Variables Required

For production deployment:
- `AWS_KMS_SQUARE_TOKEN_KEY_ID` - KMS key ID for token encryption
- `SQUARE_OAUTH_SECRET_NAME` - Secrets Manager secret name
- `SQUARE_OAUTH_CALLBACK_URL` - OAuth callback URL
- `SQUARE_ENVIRONMENT` - "sandbox" or "production"

## Notes

1. **No Square SDK Dependency**: Implementation uses direct HTTP calls to Square OAuth endpoints via RestTemplate instead of the Square Java SDK, avoiding dependency resolution issues.

2. **Token Refresh**: Token refresh logic is not yet implemented (will be part of task 16.2 for the sync worker).

3. **Test Profile**: AWS beans are profile-gated to avoid conflicts in test environments. Test profile provides mock implementations.

4. **Idempotent Connection**: If a venue already has a Square connection, exchanging a new code will update the existing connection rather than creating a duplicate.

## Next Steps (Future Tasks)

- Task 16.2: Implement Square sync worker for menu item price synchronization
- Task 16.3: Implement manual sync trigger endpoint
- Task 16.4: Implement unmatched items review and mapping
