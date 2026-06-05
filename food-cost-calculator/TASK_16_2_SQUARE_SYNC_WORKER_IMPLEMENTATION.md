# Task 16.2: SquareSyncWorker Implementation Summary

## Overview
Implemented `SquareSyncWorker` for syncing Square POS catalog data with recipes. The worker operates in two modes: scheduled (every 24 hours) and on-demand (via SQS messages).

## Requirements Implemented
- **Requirement 12.2**: Square POS integration - scheduled and on-demand sync
- **Requirement 12.3**: Case-insensitive name matching between Square items and recipes
- **Requirement 12.4**: Unmatched item logging

## Components Created

### 1. Domain Entities
#### `SquareUnmatchedItem.java`
- Entity for storing Square menu items that couldn't be matched to recipes
- Fields: venueId, squareItemName, squareItemPrice, status (PENDING/MAPPED/DISMISSED), mappedRecipeId
- Timestamps: createdAt, updatedAt

### 2. Repositories
#### `SquareUnmatchedItemRepository.java`
- `findByVenueIdAndSquareItemNameIgnoreCase()`: Find existing unmatched items (case-insensitive)
- `deleteByVenueIdAndStatusDismissed()`: Clean up dismissed items during sync

### 3. Worker
#### `SquareSyncWorker.java`
Comprehensive worker implementation with:

**Scheduled Sync**:
- Runs daily at 2 AM via `@Scheduled(cron = "0 0 2 * * *")`
- Syncs all venues with active Square connections
- Logs success/failure counts

**On-Demand Sync**:
- Triggered by SQS messages on the `square-sync.fifo` queue
- Message format: `{"venueId": "uuid", "timestamp": 1234567890}`
- Processes individual venue sync requests

**Token Management**:
- Checks token expiry before every sync
- Proactively refreshes tokens if within 24 hours of expiry
- Uses Square OAuth refresh token flow
- Encrypts/decrypts tokens using AWS KMS via `EncryptionService`

**Catalog Fetch**:
- Fetches items from Square Catalog API (`/v2/catalog/list?types=ITEM`)
- Parses item names and prices from JSON response
- Handles pagination (though current implementation fetches first page)
- Supports both sandbox and production Square environments

**Recipe Matching**:
- Uses `RecipeRepository.findByVenueIdAndNameIgnoreCase()` for exact case-insensitive match
- Updates `recipe.menu_selling_price` for matched items
- Logs unmatched items to `square_unmatched_items` table

**Status Tracking**:
- Updates `square_connections.sync_status` (IDLE/SYNCING/ERROR)
- Records `last_synced_at` timestamp after successful sync
- Handles errors gracefully and updates status to ERROR on failure

### 4. Configuration

#### `WorkerApplication.java` Updates
- Added `com.cogschecker.foodcost.api.repository` to JPA repository scanning
- Added `com.cogschecker.foodcost.api.service` to component scanning (for EncryptionService)

#### `application.properties` Updates
- Added Square OAuth configuration:
  - `square.oauth.secret-name`: AWS Secrets Manager secret name for Square credentials
  - `square.environment`: sandbox or production
- Added KMS configuration:
  - `aws.kms.square-token-key-id`: KMS key ID for token encryption

#### `AwsServicesConfig.java` Updates
- Added `SecretsManagerClient` bean for fetching Square OAuth credentials
- Added `KmsClient` bean for token encryption/decryption

#### `WebConfig.java` (New)
- Added `RestTemplate` bean for HTTP requests to Square API
- Added `ObjectMapper` bean with snake_case naming strategy and JavaTimeModule

#### `build.gradle` Updates
- Added `spring-boot-starter-web` for RestTemplate and HTTP support
- Added `jackson-datatype-jsr310` for Java 8 date/time serialization
- Added `software.amazon.awssdk:kms` for token encryption
- Added `software.amazon.awssdk:secretsmanager` for credentials management

## Sync Process Flow

1. **Initiation**: Scheduled task or SQS message triggers sync for a venue
2. **Token Check**: Verify token expiry; refresh if < 24h remaining
3. **Catalog Fetch**: Call Square API `/v2/catalog/list?types=ITEM`
4. **Parsing**: Extract item names and prices from Square response
5. **Matching**: For each Square item:
   - Query `recipes` table with case-insensitive name match
   - If match found: Update `recipe.menu_selling_price`
   - If no match: Upsert to `square_unmatched_items` table
6. **Status Update**: Set `last_synced_at` and `sync_status` = IDLE
7. **Logging**: Record matched/unmatched counts

## Token Refresh Flow

1. Check `token_expires_at` vs current time
2. If within 24-hour threshold:
   - Decrypt refresh token using KMS
   - Call Square OAuth token endpoint with `grant_type=refresh_token`
   - Parse new access token, refresh token, and expiry time
   - Encrypt new tokens using KMS
   - Update `square_connections` record
3. Return decrypted access token for immediate use

## Error Handling

- **Token Refresh Failure**: Logs error, throws exception (triggers SQS retry)
- **Catalog Fetch Failure**: Logs error, marks sync status as ERROR, throws exception
- **Database Errors**: Transaction rollback, sync status set to ERROR
- **Invalid Message**: Logs error, throws IllegalArgumentException (moves to DLQ after retries)

## Security Considerations

- **Token Encryption**: All OAuth tokens encrypted at rest using AWS KMS
- **Credentials Storage**: Square OAuth credentials stored in AWS Secrets Manager
- **Least Privilege**: Worker IAM role has minimal permissions (KMS decrypt/encrypt, Secrets Manager read, SQS consume)

## Testing Recommendations

1. **Unit Tests**:
   - Mock SquareConnectionRepository, RecipeRepository, SquareUnmatchedItemRepository
   - Test token refresh logic with various expiry times
   - Test catalog parsing with different Square API responses
   - Test matching logic with various name permutations

2. **Integration Tests**:
   - Test scheduled sync with multiple venues
   - Test on-demand sync via SQS message
   - Test token refresh flow with real AWS KMS (local stack)
   - Test unmatched item upsert logic

3. **Property-Based Tests** (Task 16.3):
   - Generate arbitrary Square item names and recipe libraries
   - Assert case-insensitive exact match correctness
   - Verify no false positives or missed matches

## Next Steps

- **Task 16.3**: Write property test P21 for Square name matching
- **Task 16.4**: Implement disconnect endpoint and unmatched-item management endpoints
- Add pagination support for large Square catalogs
- Add retry logic with exponential backoff for Square API calls
- Implement circuit breaker for Square API failures

## Configuration Required in Production

1. **AWS Secrets Manager**: Create secret `food-cost-calculator/square-oauth` with:
   ```json
   {
     "application_id": "square-app-id",
     "application_secret": "square-app-secret"
   }
   ```

2. **AWS KMS**: Create CMK for Square token encryption and set `KMS_SQUARE_TOKEN_KEY_ID` env var

3. **SQS Queue**: Create FIFO queue `square-sync.fifo` with DLQ

4. **IAM Role** (IRSA): Attach policy with:
   - `kms:Decrypt`, `kms:Encrypt` on Square token KMS key
   - `secretsmanager:GetSecretValue` on Square OAuth secret
   - `sqs:ReceiveMessage`, `sqs:DeleteMessage` on square-sync queue

5. **Environment Variables**:
   - `SQUARE_OAUTH_SECRET_NAME=food-cost-calculator/square-oauth`
   - `SQUARE_ENVIRONMENT=production` (or `sandbox` for testing)
   - `KMS_SQUARE_TOKEN_KEY_ID=<kms-key-id>`
   - `SQS_SQUARE_SYNC_QUEUE=<queue-url>`

## Files Changed/Created

### New Files
- `modules/api/src/main/java/com/cogschecker/foodcost/api/domain/SquareUnmatchedItem.java`
- `modules/api/src/main/java/com/cogschecker/foodcost/api/repository/SquareUnmatchedItemRepository.java`
- `modules/workers/src/main/java/com/cogschecker/foodcost/workers/worker/SquareSyncWorker.java`
- `modules/workers/src/main/java/com/cogschecker/foodcost/workers/config/WebConfig.java`

### Modified Files
- `modules/workers/src/main/java/com/cogschecker/foodcost/workers/WorkerApplication.java` (added repository/service scanning)
- `modules/workers/src/main/java/com/cogschecker/foodcost/workers/config/AwsServicesConfig.java` (added KMS and Secrets Manager clients)
- `modules/workers/src/main/resources/application.properties` (added Square and KMS config)
- `modules/workers/build.gradle` (added web, jackson-datatype-jsr310, KMS, and Secrets Manager dependencies)

## Build Verification

```bash
./gradlew :modules:workers:build -x test
```

Build successful - all dependencies resolved, no compilation errors.
