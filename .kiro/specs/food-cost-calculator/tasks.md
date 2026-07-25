# Implementation Plan: Food Cost Calculator

## Overview

Incremental implementation of a multi-tenant SaaS food cost calculator. Each task builds on the previous, wiring all pieces together at the end. The stack is Java 21 + Spring Boot 3 (Gradle multi-module: `api`, `workers`, `shared`) on Amazon EKS, React (TypeScript) + Vite on the frontend, backed by Aurora PostgreSQL, ElastiCache Redis, Amazon SQS FIFO, Amazon Cognito, S3, Textract, Bedrock, Stripe, and Amazon SES. Infrastructure is defined in AWS CDK (TypeScript). CI/CD runs on GitHub Actions.

## Tasks

- [x] 1. AWS CDK infrastructure stacks
  - [x] 1.1 Scaffold the CDK TypeScript app and define `NetworkStack` (VPC, public/private subnets, NAT gateways, security groups)
    - Create `infra/bin/app.ts` CDK entry point and `infra/lib/stacks/NetworkStack.ts`
    - Define VPC with two public subnets and four private subnets spread across three AZs
    - Add NAT gateways (one per AZ) and route tables
    - Define baseline security groups for ALB, EKS nodes, Aurora, ElastiCache
    - _Requirements: 10.1, 10.3_

  - [x] 1.2 Implement `DatabaseStack` (Aurora PostgreSQL Multi-AZ, parameter groups, Secrets Manager credentials)
    - Create `infra/lib/stacks/DatabaseStack.ts`
    - Define Aurora Serverless v2 PostgreSQL cluster with Multi-AZ standby
    - Store DB credentials in Secrets Manager; reference secret ARN via environment variable
    - Configure parameter group with `rds.force_ssl = 1` and `pgaudit` logging
    - _Requirements: 7.1, 7.2_

  - [x] 1.3 Implement `CacheStack` (ElastiCache Redis cluster mode, Multi-AZ replication groups)
    - Create `infra/lib/stacks/CacheStack.ts`
    - Define Redis 7 cluster with two shards and two replicas per shard across AZs
    - Restrict access to EKS security group via security group ingress rule
    - _Requirements: 3.3_

  - [x] 1.4 Implement `StorageStack` (S3 buckets for invoice files and static assets, lifecycle policies, KMS encryption)
    - Create `infra/lib/stacks/StorageStack.ts`
    - Define `invoices` bucket with KMS-CMK SSE, block-public-access, versioning enabled, 90-day lifecycle transition to Glacier
    - Define `assets` bucket for React SPA build artefacts; enable static website hosting
    - _Requirements: 12.6_

  - [x] 1.5 Implement `AuthStack` (Cognito User Pool, Google and Apple identity providers, hosted UI, custom attributes)
    - Create `infra/lib/stacks/AuthStack.ts`
    - Define Cognito User Pool with password policy (min 8 chars, upper, lower, digit), 30-day refresh token TTL
    - Add Google and Apple OIDC identity providers
    - Define custom attributes: `custom:org_id`, `custom:venue_roles`, `custom:tier`
    - Create App Client with allowed OAuth flows for hosted UI
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.10_

  - [x] 1.6 Implement `MessagingStack` (SQS FIFO queues: cost-propagation, ocr-processing, ai-insights, square-sync; DLQs; CloudWatch alarms on DLQ depth)
    - Create `infra/lib/stacks/MessagingStack.ts`
    - Define four FIFO queues with content-based deduplication enabled and 14-day retention
    - Attach a DLQ to each queue (maxReceiveCount = 3)
    - Create CloudWatch alarms that fire when any DLQ depth > 0
    - _Requirements: 3.3, 12.7, 13.4_

  - [x] 1.7 Implement `SecretsStack` (KMS CMKs for Square token encryption, Secrets Manager secrets for DB, Stripe, Square, Bedrock API keys)
    - Create `infra/lib/stacks/SecretsStack.ts`
    - Define one KMS CMK per sensitive secret category (DB, Square OAuth tokens, Stripe webhook secret)
    - Define Secrets Manager secrets with automatic rotation enabled for the DB secret
    - _Requirements: 12.1_

  - [x] 1.8 Implement `EksStack` (EKS cluster, managed node groups across 3 AZs, IRSA roles for api and workers, OIDC provider)
    - Create `infra/lib/stacks/EksStack.ts`
    - Define EKS 1.30 cluster with three managed node groups (one per AZ), instance type `m6i.xlarge`
    - Create OIDC provider and IRSA IAM roles for the `api` and `workers` service accounts
    - Attach least-privilege IAM policies: api → RDS Data, S3 read, SQS send, Cognito; workers → SQS consume, Textract, Bedrock, SES, S3 read/write
    - _Requirements: 3.3, 12.7_

  - [x] 1.9 Implement `CdnStack` (CloudFront distribution with ALB origin and S3 SPA origin, WAF WebACL, SSL certificate)
    - Create `infra/lib/stacks/CdnStack.ts`
    - Define CloudFront distribution with two origins: ALB (for `/api/*`) and S3 assets bucket (for `/*`)
    - Attach AWS WAF WebACL with rate-limit and managed rule groups
    - Configure SSL certificate via ACM (us-east-1) for custom domain
    - _Requirements: 10.10_

  - [x] 1.10 Implement `ObservabilityStack` (CloudWatch dashboards, metric alarms for API latency and error rate, X-Ray groups, structured log groups)
    - Create `infra/lib/stacks/ObservabilityStack.ts`
    - Define CloudWatch dashboards for API, workers, Aurora, and ElastiCache metrics
    - Add alarms: p99 API latency > 2 s, 5xx error rate > 1%, DLQ depth > 0, Aurora failover event
    - Create X-Ray groups for `api` and `workers` services
    - _Requirements: 3.3, 4.5_

  - [x] 1.11 Create the reusable `SpringBootService` CDK construct (EKS Deployment, HPA, ALB Ingress, PodDisruptionBudget, IRSA wiring)
    - Create `infra/lib/constructs/SpringBootService.ts`
    - Parameterise: image URI, service name, env vars, IRSA role ARN, HPA min/max replicas, resource limits
    - Include readiness and liveness probes pointing to `/actuator/health`
    - Set `PodDisruptionBudget` with `minAvailable: 1`
    - _Requirements: 3.3_

- [x] 2. Gradle multi-module project scaffold
  - [x] 2.1 Initialise Gradle multi-module project with `api`, `workers`, and `shared` modules; configure Spring Boot 3 and Java 21 toolchain
    - Create root `build.gradle` and `settings.gradle`; declare `modules/api`, `modules/workers`, `modules/shared` subprojects
    - Apply `java-library` to `shared`, `org.springframework.boot` to `api` and `workers`
    - Set Java toolchain to version 21 in all modules; enable virtual threads via `spring.threads.virtual.enabled=true`
    - _Requirements: 3.1_

  - [x] 2.2 Implement `shared` module: `UomConverter`, `CostCalculator`, `RoundingUtils`, UOM enum, error code constants
    - Create `UomEnum` with all supported units grouped by dimension (weight, volume, count)
    - Implement `UomConverter.convert(quantity, fromUnit, toUnit)` applying exact factors from Requirement 6.3; throw `IncompatibleUomException` for cross-dimension conversions
    - Implement `CostCalculator` with pure static methods: `costPerUnit`, `effectiveCostPerUsableUnit`, `lineCost`, `batchCost`, `foodCostPerPortion`, `foodCostPercentage` — all using `BigDecimal` with `HALF_UP` rounding
    - Implement `RoundingUtils` with `round(value, scale)` helpers
    - _Requirements: 1.2, 1.5, 3.1, 3.2, 4.2, 6.2, 6.3_

  - [x] 2.3 Scaffold `api` Spring Boot application: `SecurityConfig`, `CorsConfig`, `JacksonConfig`, `GlobalExceptionHandler`; add Flyway, JPA, Redis, SQS dependencies
    - Wire `SecurityConfig` with a placeholder JWT filter (to be replaced in task 7.1)
    - Configure Jackson for `snake_case` serialization, `BigDecimal` as string, UTC timestamps
    - Implement `GlobalExceptionHandler` with `@RestControllerAdvice` mapping all custom exceptions to the standard error response format
    - _Requirements: 7.1_

  - [x] 2.4 Scaffold `workers` Spring Boot application: `WorkerApplication` entry point, SQS listener configuration, Spring Batch job registry; add Textract, Bedrock, SES dependencies
    - Disable Spring MVC auto-configuration (workers expose no HTTP endpoints)
    - Configure Spring Cloud AWS SQS listeners with visibility timeout and max concurrent consumers
    - _Requirements: 3.3, 12.7, 13.4_


- [x] 3. Database migrations (Flyway)
  - [x] 3.1 Write Flyway migration `V1__create_core_tables.sql`: `organisations`, `subscriptions`, `users`, `user_organisation_roles`, `user_venue_roles`, `venues`, `system_config`
    - Include all columns, constraints, foreign keys, and indexes as specified in the data model
    - Add `UNIQUE(venue_id, lower(name))` function-based index on `venues` for case-insensitive uniqueness
    - _Requirements: 8.1, 9.1, 10.1, 11.1_

  - [x] 3.2 Write Flyway migration `V2__create_ingredient_recipe_tables.sql`: `ingredients`, `recipes`, `recipe_ingredient_lines`
    - Add `CHECK (ingredient_id IS NOT NULL) <> (sub_recipe_id IS NOT NULL)` XOR constraint on `recipe_ingredient_lines`
    - Add `UNIQUE(venue_id, lower(name))` function-based indexes on `ingredients` and `recipes`
    - _Requirements: 1.1, 1.10, 2.1_

  - [x] 3.3 Write Flyway migration `V3__create_pro_proplus_tables.sql`: `invoices`, `invoice_line_items`, `square_connections`, `square_unmatched_items`, `ai_insights`
    - _Requirements: 12.6, 12.10, 13.1_

- [x] 4. Ingredient management
  - [x] 4.1 Implement `IngredientService`: create, read, update, delete, and search operations with business rule enforcement
    - On create/update: call `CostCalculator.costPerUnit` and `CostCalculator.effectiveCostPerUsableUnit`; persist both computed fields
    - Enforce case-insensitive duplicate name check within venue; throw `DuplicateNameException` mapped to 409
    - On delete: query `recipe_ingredient_lines` for references; if found, throw `DeleteConflictException` with list of affected recipe names (requires prior confirmation flag in request)
    - Search: delegate to JPA `findByVenueIdAndNameContainingIgnoreCase`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [x] 4.2 Write property test P1: `cost_per_unit == round(purchase_price / purchase_quantity, 4)`
    - **Property 1: Cost-Per-Unit Calculation**
    - **Validates: Requirements 1.2, 1.3**
    - Use `@ForAll @BigRange(min="0.01", max="999999.99") BigDecimal` for price and quantity; run 5000 tries

  - [x] 4.3 Write property test P2: `effective_cost_per_usable_unit == round(cost_per_unit / (yield / 100), 4)`
    - **Property 2: Effective Cost Per Usable Unit Calculation**
    - **Validates: Requirements 1.5**
    - Use `@ForAll` for cost > 0 and yield in [1, 100]; run 5000 tries

  - [x] 4.4 Write property test P3: referenced ingredient deletion requires explicit confirmation
    - **Property 3: Referenced Entity Deletion Requires Confirmation**
    - **Validates: Requirements 1.8**
    - Generate arbitrary ingredient referenced by 1+ recipes; assert DELETE without confirmation flag returns 409 with affected recipe names listed

  - [x] 4.5 Write property test P4: case-insensitive partial-match search returns exactly the correct set
    - **Property 4: Case-Insensitive Partial-Match Search Returns Exactly the Correct Set**
    - **Validates: Requirements 1.9**
    - Use `@ForAll String` query and list of ingredient names; assert every name containing the query (case-insensitive) appears in results and no others do

  - [x] 4.6 Write property test P5: duplicate ingredient name rejection is case-insensitive
    - **Property 5: Duplicate Name Rejection Is Case-Insensitive**
    - **Validates: Requirements 1.10**
    - Generate arbitrary name, generate all-caps/all-lower/mixed permutations; assert each permutation is rejected when the original name already exists

  - [x] 4.7 Implement `IngredientController` REST endpoints (`GET /venues/:venueId/ingredients`, `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`)
    - Validate request DTOs with Bean Validation (`@NotBlank`, `@DecimalMin`, `@Size`)
    - Wire `@PreAuthorize("hasVenueRole('MANAGER', #venueId)")` on mutating endpoints; Staff gets only `GET`
    - _Requirements: 1.1, 1.6, 1.7, 1.8, 1.9, 9.3, 9.4_

  - [x] 4.8 Trigger `CostPropagationService` after every ingredient price/quantity/yield update
    - After persisting the ingredient update, call `CostPropagationService.enqueue(venueId, ingredientId)` which sends a message to `cost-propagation.fifo`
    - The API returns the updated ingredient immediately (fire-and-forget to SQS)
    - _Requirements: 1.3, 3.3_

- [x] 5. Recipe management
  - [x] 5.1 Implement `RecipeService`: create, read, update, duplicate, delete, and search operations with validation
    - Validate: name non-empty/non-whitespace, portion count [1, 9999], all line quantities > 0; collect all errors and throw `ValidationException` with field list
    - Enforce case-insensitive duplicate name within venue; throw `DuplicateNameException`
    - Duplicate: copy with name prefixed `"Copy of "`, all ingredient lines copied; save as new entity
    - On delete: check `recipe_ingredient_lines.sub_recipe_id` references; if found, throw `DeleteConflictException`
    - Free tier: before create, count recipes in venue; if count ≥ 25, throw `TierLimitExceededException`
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12_

  - [x] 5.2 Implement circular sub-recipe reference detection using recursive CTE
    - Create `RecipeRepository.existsCircularReference(parentRecipeId, candidateSubRecipeId)` executing the recursive CTE from the design
    - Call before persisting any new or updated `recipe_ingredient_lines` row that sets `sub_recipe_id`
    - Throw `CircularReferenceException` mapped to 409 if cycle detected
    - _Requirements: 2.3, 2.4_

  - [x] 5.3 Write property test P6: circular sub-recipe reference is always prevented
    - **Property 6: Circular Sub-Recipe Reference Is Always Prevented**
    - **Validates: Requirements 2.4**
    - Generate arbitrary DAG of recipes; attempt to add a back-edge; assert the attempt is blocked and the graph is unchanged

  - [x] 5.4 Write property test P7: recipe validation rejects all invalid inputs
    - **Property 7: Recipe Validation Rejects All Invalid Inputs**
    - **Validates: Requirements 2.1, 2.10, 2.11**
    - Use `@ForAll` record with name (empty/whitespace variants), portion count (outside [1,9999]), and line quantities (≤ 0); assert each invalid combo is rejected and each failing field is identified

  - [x] 5.5 Implement `RecipeController` REST endpoints (`GET /venues/:venueId/recipes`, `POST`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/duplicate`, `POST /copy`)
    - Return full cost breakdown on `GET /:id` (each line: name, qty, uom, unit cost, line cost; totals)
    - Missing-price lines: substitute `null` cost fields, include `missingPrice: true` flag per line
    - Wire RBAC: Manager/Admin for mutations, Staff read-only
    - _Requirements: 2.1–2.12, 3.5, 3.6, 3.7, 9.3, 9.4_

  - [x] 5.6 Implement cross-venue recipe copy (`POST /venues/:venueId/recipes/copy`) with missing-ingredient resolution flow
    - Check every `ingredient_id` in the source recipe against the destination venue's ingredient library
    - If missing ingredients exist, return 409 with list of missing names; accept a `ingredientMappings` body for Admin to re-submit with mappings or create-new flags
    - _Requirements: 10.6, 10.7_


- [x] 6. Food cost calculation engine
  - [x] 6.1 Implement `CostingService.calculateBatchCost(recipe)`: iterate ingredient lines, apply UOM conversion, accumulate `line_cost`; handle sub-recipe lines using sub-recipe's `food_cost_per_portion`
    - Call `UomConverter.convert` for each line; catch `IncompatibleUomException` and surface as 422
    - If `effective_cost_per_usable_unit` is null for a line, flag `missingPrice = true` and skip that line from the sum
    - If all lines are missing price, return `foodCostPerPortion = null` with `incomplete = true`
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7_

  - [x] 6.2 Write property test P8: batch cost calculation is correct for all recipe compositions
    - **Property 8: Batch Cost Calculation Is Correct for All Recipe Compositions**
    - **Validates: Requirements 3.1, 3.4**
    - Generate `@ForAll List<IngredientLine>` with varied qty, uom, yield; assert computed `total_batch_cost` equals manual sum of converted quantities × effective costs

  - [x] 6.3 Write property test P9: food cost per portion equals `round(batchCost / portionCount, 2)`
    - **Property 9: Food Cost Per Portion Calculation**
    - **Validates: Requirements 3.2**
    - Use `@ForAll BigDecimal` batchCost ≥ 0 and `@ForAll @IntRange(min=1, max=9999)` portionCount; run 5000 tries

  - [x] 6.4 Implement `CostPropagationWorker` SQS listener: recursive CTE to find all transitively dependent recipes; recalculate and batch-update in dependency order
    - Use `@SqsListener("cost-propagation.fifo")` in the `workers` module
    - Execute recursive CTE: find all recipe IDs that directly or transitively reference the changed ingredient
    - Sort by dependency depth (leaves first); recalculate each recipe in order within a single `@Transactional` batch UPDATE
    - After update, publish `COST_UPDATED` event to Redis pub/sub channel `venue:{venueId}:costs`
    - _Requirements: 3.3_

  - [x] 6.5 Write property test P10: cost propagation reaches all transitively dependent recipes
    - **Property 10: Cost Propagation Reaches All Transitively Dependent Recipes**
    - **Validates: Requirements 3.3**
    - Generate recipe graph with varied depth/branching; update a base ingredient; assert every dependent recipe has the correct recalculated `food_cost_per_portion`

  - [x] 6.6 Implement SSE endpoint for real-time cost updates (`GET /venues/:venueId/cost-events`)
    - Subscribe to Redis pub/sub channel `venue:{venueId}:costs` on connection; forward `COST_UPDATED` events as SSE to connected browser clients
    - React Query on the frontend invalidates the cache for affected recipe IDs on receipt
    - _Requirements: 3.3_

- [x] 7. UOM conversion and validation
  - [x] 7.1 Implement `UomConverter.convert(quantity, fromUnit, toUnit)` in the `shared` module using exact factors
    - Map each unit to its canonical base unit (g for weight, ml for volume, each for count)
    - Throw `IncompatibleUomException` if `fromUnit` and `toUnit` belong to different dimensions
    - `each` is its own dimension; never convertible to weight or volume
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.2 Write property test P16: UOM conversion applies exact defined factors
    - **Property 16: UOM Conversion Applies Exact Defined Factors**
    - **Validates: Requirements 6.2, 6.3**
    - Generate arbitrary quantities and all compatible unit pairs; assert result equals `quantity × exact_factor` using `BigDecimal` compareTo

  - [x] 7.3 Write property test P17: cross-dimension UOM combination is always rejected
    - **Property 17: Cross-Dimension UOM Combination Is Always Rejected**
    - **Validates: Requirements 6.4, 6.5**
    - Enumerate all incompatible dimension pairs (weight×volume, weight×count, volume×count); assert each throws `IncompatibleUomException` and no line is saved

- [x] 8. Food cost percentage analysis
  - [x] 8.1 Implement `CostingService.calculateFoodCostPercentage(foodCostPerPortion, menuSellingPrice)` returning `null` when `menuSellingPrice` is null or 0
    - Formula: `round((foodCostPerPortion / menuSellingPrice) × 100, 1)`
    - Persist result in `recipes.food_cost_percentage`; update on every recipe save and after cost propagation
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 8.2 Write property test P11: food cost percentage equals `round((fcp / price) × 100, 1)`
    - **Property 11: Food Cost Percentage Calculation**
    - **Validates: Requirements 4.2**
    - Use positive `BigDecimal` for both cost and price; run 5000 tries

  - [x] 8.3 Implement venue `system_config` service and endpoint (`GET /venues/:venueId/config`, `PATCH`): `target_food_cost_percentage` defaulting to 30.0, validated [1, 100]
    - _Requirements: 4.6_

  - [x] 8.4 Implement `ThresholdEvaluator.evaluate(foodCostPercentage, threshold)` returning `EXCEEDING` or `PASSING` enum; expose result in recipe and report DTOs
    - _Requirements: 4.7, 4.8_

  - [x] 8.5 Write property test P12: threshold indicator correctly reflects the comparison for all values
    - **Property 12: Threshold Indicator Reflects the Correct Comparison**
    - **Validates: Requirements 4.7, 4.8**
    - Generate arbitrary floats for percentage and threshold; assert `EXCEEDING` iff `fcp > threshold`, else `PASSING`

- [x] 9. Recipe costing report
  - [x] 9.1 Implement `ReportService.getCostingReport(venueId, sortColumn, sortDir, filter)` with server-side sort and threshold filter
    - Enforce pre-inclusion validation: non-empty name, non-negative food cost and menu selling price
    - Apply "exceeds threshold" filter: exclude recipes with no menu selling price; include only `food_cost_percentage > threshold`
    - Default sort: recipe name ASC
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 9.2 Write property test P13: report sort is correct for all columns and directions
    - **Property 13: Report Sort Is Correct for All Columns and Directions**
    - **Validates: Requirements 5.2, 5.3**
    - Generate `@ForAll List<RecipeDto>` and all sortable column/direction combos; assert sorted output matches `Comparator`-based reference sort; assert toggling same column reverses direction

  - [x] 9.3 Write property test P14: threshold filter returns exactly the exceeding recipes
    - **Property 14: Threshold Filter Returns Exactly the Exceeding Recipes**
    - **Validates: Requirements 5.4**
    - Generate `@ForAll List<RecipeDto>` with varied fcp%, arbitrary threshold; assert filtered set equals `{r | r.fcp > threshold && r.menuPrice != null}`

  - [x] 9.4 Implement `CsvExportService.export(recipes)` producing a correctly rounded CSV
    - Columns: Recipe Name, Food Cost Per Portion (2 d.p.), Menu Price (2 d.p.), Food Cost Percentage (1 d.p.), Portions Per Batch
    - When report is filtered, export only filtered rows
    - _Requirements: 5.6, 5.7_

  - [x] 9.5 Write property test P15: CSV export contains correct rows and correctly rounded values
    - **Property 15: CSV Export Contains Correct Rows and Correctly Rounded Values**
    - **Validates: Requirements 5.6, 5.7**
    - Generate arbitrary recipe sets (full and filtered); parse exported CSV; assert row count matches recipe count and numeric values match rounding rules

  - [x] 9.6 Implement `ReportController` endpoints (`GET /venues/:venueId/reports/costing`, `GET /venues/:venueId/reports/costing/export`)
    - Stream CSV response with `Content-Disposition: attachment; filename="costing-report.csv"`
    - _Requirements: 5.1–5.7_

- [x] 10. Data persistence — JSON export and import
  - [x] 10.1 Implement `DataExportService.export(venueId)` serialising all ingredients, recipes, ingredient lines, menu prices, and `target_food_cost_percentage` into a single JSON document
    - Use a versioned envelope `{ "version": 1, "exportedAt": "...", "venue": { ... } }` to support future schema evolution
    - _Requirements: 7.4_

  - [x] 10.2 Implement `DataImportService.import(venueId, json)` with schema validation; on success atomically replace all venue data within a transaction
    - Validate JSON against Jackson schema; on any schema violation throw `InvalidImportSchemaException` mapped to 400 without modifying data
    - On success: delete all existing ingredients and recipes for the venue, then insert imported data within one `@Transactional` boundary
    - _Requirements: 7.5, 7.6_

  - [x] 10.3 Write property test P18: JSON export/import round-trip preserves all data exactly
    - **Property 18: JSON Export/Import Round-Trip Preserves All Data Exactly**
    - **Validates: Requirements 7.4, 7.5, 7.7**
    - Generate arbitrary full venue state; export to JSON; import; compare every field of every entity for exact equality

  - [x] 10.4 Implement export/import controller endpoints (`GET /venues/:venueId/export`, `POST /venues/:venueId/import`) with Staff-write-block RBAC
    - _Requirements: 7.4, 7.5, 9.4_

- [x] 11. Checkpoint — core domain complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. User authentication (Cognito)
  - [x] 12.1 Implement `CognitoJwtFilter`: fetch and cache JWKS from Cognito JWKS URI, verify JWT signature and claims, populate `SecurityContext` with `CognitoAuthenticationToken`
    - Use `spring-security-oauth2-resource-server` with `NimbusJwtDecoder`
    - Extract `custom:org_id`, `custom:venue_roles`, `custom:tier` from claims; build `GrantedAuthority` list
    - _Requirements: 8.2, 8.3, 8.4_

  - [x] 12.2 Implement `AuthController` endpoints: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, password reset request and confirm
    - Register: call Cognito `SignUp` then `AdminConfirmSignUp` for auto-confirm in dev; in prod use email verification
    - Password reset: call Cognito `ForgotPassword` (request) and `ConfirmForgotPassword` (confirm); for unrecognised email, return generic 200 to avoid email enumeration (Requirement 8.8)
    - On password change: call Cognito `AdminUserGlobalSignOut` to invalidate all sessions
    - _Requirements: 8.1, 8.2, 8.7, 8.8, 8.9_

  - [x] 12.3 Implement OAuth endpoints (`GET /auth/oauth/google`, `/callback`, `GET /auth/oauth/apple`, `/callback`) delegating to Cognito hosted UI redirects
    - On first social login: Cognito creates new user; API creates a row in `users` table on first authenticated request
    - If social email matches existing user: Cognito links provider; no duplicate `users` row created
    - _Requirements: 8.3, 8.4, 8.5, 8.6_


- [x] 13. Role-based access control (RBAC)
  - [x] 13.1 Implement `VenueScopeFilter`: extract `venueId` from request path, verify it belongs to the `org_id` in the JWT; return 403 on mismatch
    - _Requirements: 9.1, 10.3_

  - [x] 13.2 Implement `RbacAuthorizationManager` and `@PreAuthorize("hasVenueRole('MANAGER', #venueId)")` custom security expression
    - Build `GrantedAuthority` objects from `custom:venue_roles` JSON string in JWT claims
    - Evaluate role hierarchy: Admin implies Manager implies read
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 13.3 Implement `SubscriptionGateFilter` and `@RequiresTier("pro")` annotation; return HTTP 402 with `upgrade_prompt` payload for insufficient tier
    - Read `custom:tier` from `SecurityContext`; compare against annotation value
    - _Requirements: 11.3_

  - [x] 13.4 Write property test P19: RBAC correctly enforces permissions for all role/action combinations
    - **Property 19: RBAC Correctly Enforces Permissions for All Role/Action Combinations**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**
    - Generate all (role, action) pairs from the permission matrix; assert allow/deny result matches the matrix for every combination

  - [x] 13.5 Write property test P20: venue data is strictly isolated between venues
    - **Property 20: Venue Data Is Strictly Isolated Between Venues**
    - **Validates: Requirements 10.3**
    - Generate ingredient/recipe in Venue A; attempt GET/PATCH/DELETE via a token scoped to Venue B only; assert 403 on every attempt

  - [x] 13.6 Implement user management endpoints (`GET /organisations/:orgId/users`, `POST /organisations/:orgId/invitations`, `PATCH /:userId/role`, `DELETE /:userId`)
    - Role change: update Cognito custom attribute `custom:venue_roles` immediately; active sessions pick up new role on next request (JWT re-issued on next refresh)
    - Remove user: call Cognito `AdminDisableUser` + `AdminUserGlobalSignOut`
    - Block sole-Admin removal: count admins; throw `SoleAdminRemovalException` mapped to 409
    - _Requirements: 9.6, 9.7, 9.8, 9.9, 9.10_

- [x] 14. Multi-venue management
  - [x] 14.1 Implement `VenueService`: create, rename, delete venue; enforce Free tier 2-venue limit
    - On delete: soft-delete (`deleted_at = now()`), then cascade-delete all ingredients, recipes, and `user_venue_roles` in a transaction; require explicit confirmation flag in request body
    - Free tier: count non-deleted venues in org before create; if ≥ 2, throw `TierLimitExceededException`
    - _Requirements: 10.1, 10.2, 10.8_

  - [x] 14.2 Implement `OrganisationController` endpoints for venue CRUD and cross-venue summary report
    - Cross-venue summary: aggregate per venue — total recipe count, avg food cost %, recipe count exceeding threshold; only for venues in the requesting Admin's org
    - Venue selector: `GET /organisations/:orgId/venues` returns all venues the user has access to
    - _Requirements: 10.3, 10.4, 10.5, 10.9, 10.10, 10.11_

- [x] 15. Subscription tier management (Stripe)
  - [x] 15.1 Implement `SubscriptionService`: upgrade, downgrade scheduling, history; enforce conflict check before downgrade
    - Upgrade: create or update Stripe subscription via Stripe Java SDK; on success update `subscriptions.tier` and Cognito `custom:tier`
    - Downgrade: validate no tier-limit conflicts; if clean, set `pending_downgrade_tier` and schedule for `current_period_end`; if conflicts exist, return 409 listing excess venues/recipes
    - _Requirements: 11.4, 11.5, 11.6_

  - [x] 15.2 Implement `WebhookController.handleStripeWebhook(POST /webhooks/stripe)`: handle `payment_succeeded`, `payment_failed`, `invoice.payment_failed`, `customer.subscription.deleted`
    - Verify Stripe webhook signature using `stripe-signature` header and KMS-stored webhook secret
    - `payment_failed`: set `payment_failed_at`, send email via SES, display in-app banner
    - After 7 days unpaid: downgrade to Free, preserve all data, restrict paid features
    - _Requirements: 11.7, 11.8_

  - [x] 15.3 Implement `SubscriptionController` endpoints (`GET /organisations/:orgId/subscription`, upgrade, downgrade, history)
    - _Requirements: 11.1–11.9_

- [x] 16. Square POS integration
  - [x] 16.1 Implement Square OAuth flow: `GET /venues/:venueId/square/connect` (redirect) and `GET /venues/:venueId/square/callback` (token exchange, encrypted storage)
    - Exchange code for access/refresh tokens via Square OAuth API
    - Encrypt tokens with KMS-managed key before storing in `square_connections`
    - _Requirements: 12.1_

  - [x] 16.2 Implement `SquareSyncWorker`: scheduled (EventBridge every 24 h) and on-demand (SQS message); token refresh logic; catalog fetch; case-insensitive name matching; price update; unmatched item logging
    - Check token expiry; refresh proactively if within 24 h of expiry
    - Match Square item names to recipes using `lower(square_item_name) = lower(recipe_name)` exact match
    - Update `recipes.menu_selling_price` for matched items; upsert `square_unmatched_items` for non-matched
    - _Requirements: 12.2, 12.3, 12.4_

  - [x] 16.3 Write property test P21: Square name matching correctly identifies matches and non-matches
    - **Property 21: Square POS Name Matching Correctly Identifies Matches and Non-Matches**
    - **Validates: Requirements 12.3**
    - Generate arbitrary Square item names and recipe libraries; assert exact case-insensitive match is returned when a match exists; assert no false positives or missed true matches

  - [x] 16.4 Implement disconnect endpoint (`DELETE /venues/:venueId/square/connection`) and unmatched-item management endpoints (`GET /venues/:venueId/square/unmatched`, `PATCH /:id`)
    - Disconnect: delete tokens, update `sync_status = 'idle'`, stop future scheduled syncs; retain previously synced prices
    - _Requirements: 12.5, 12.4_

- [x] 17. Invoice OCR pipeline
  - [x] 17.1 Implement invoice upload endpoint (`POST /venues/:venueId/invoices`): validate file type (PDF, JPEG, PNG) and size (≤ 10 MB), upload to S3, create `invoices` record (status: `pending`), enqueue `OCR_PROCESS` SQS message
    - Return `{ invoiceId, status: "processing" }` immediately; do not wait for Textract
    - _Requirements: 12.6, 12.7_

  - [x] 17.2 Implement `OcrProcessingWorker`: call Textract `AnalyzeDocument` (TABLES feature), parse table blocks into `invoice_line_items`, set confidence scores, flag `is_low_confidence` for score < 0.80, update invoice status to `review`
    - Retry Textract call up to 3 times with exponential backoff on transient errors
    - On all-retry failure: set status to `failed`, publish in-app notification
    - _Requirements: 12.7, 12.9_

  - [x] 17.3 Implement invoice review and confirm endpoints (`GET /venues/:venueId/invoices/:id`, `PATCH /:id/lines/:lineId`, `POST /:id/confirm`)
    - Confirm: for each line, do case-insensitive name match against `ingredients`; update purchase price/quantity if matched; create new ingredient if no match; require all low-confidence fields to be explicitly confirmed before allowing confirm
    - _Requirements: 12.7, 12.8, 12.9, 12.10_

- [x] 18. AI insights pipeline
  - [x] 18.1 Implement `AiInsightsWorker`: check Pro+ tier and ≥ 30 days sales data; build Bedrock prompt; call `InvokeModel`; validate JSON response against schema; upsert `ai_insights`
    - Triggered by EventBridge (24 h sweep) and SQS message after Square sync or invoice confirm
    - Never write to `recipes`, `ingredients`, or `recipe_ingredient_lines`
    - On malformed Bedrock response: log and discard; mark insights as `stale`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.8_

  - [x] 18.2 Implement `InsightController` endpoints (`GET /venues/:venueId/insights`, `PATCH /:id/status`)
    - Status update: accept `actioned` or `dismissed`; dismissed insights are excluded from future active queries unless new data produces a materially different recommendation
    - If insufficient data (< 30 days or < 10 transactions), return informational message with estimated availability date
    - _Requirements: 13.5, 13.6, 13.7_

- [x] 19. React frontend scaffold and shared components
  - [x] 19.1 Scaffold React (TypeScript) + Vite app; configure Zustand store slices and React Query client; set up routing with React Router
    - Create feature directory structure: `features/{ingredients,recipes,reports,venues,insights,invoices,square,auth,account}`
    - Configure Axios instance with `Authorization` header injection from Zustand auth slice and `X-Venue-ID` header from venue slice
    - _Requirements: 7.2_

  - [x] 19.2 Implement shared UI components: `CostBadge` (cost display with missing-price placeholder), `ThresholdIndicator` (colour-coded badge: red if exceeding, green if passing), `UomSelect` (grouped UOM dropdown), `UpgradeModal` (triggered on 402 response)
    - `ThresholdIndicator` must be visually distinguishable for exceeding vs passing states (Requirement 4.7, 4.8)
    - _Requirements: 3.5, 4.7, 4.8_

  - [x] 19.3 Implement `useSubscriptionGate` hook and `useCostPropagation` hook (SSE listener that calls React Query `invalidateQueries` on `COST_UPDATED` events)
    - _Requirements: 3.3, 11.3_

- [x] 20. Frontend authentication screens
  - [x] 20.1 Implement Login, Register, password reset request, and password reset confirm pages using Cognito hosted UI redirect or direct API calls
    - Display validation errors inline; on 402 show `UpgradeModal`
    - _Requirements: 8.1, 8.2, 8.7, 8.8_

  - [x] 20.2 Implement Google and Apple social login buttons using Cognito hosted UI OAuth redirect
    - _Requirements: 8.3, 8.4, 8.5, 8.6_

- [x] 21. Frontend ingredient management screens
  - [x] 21.1 Implement Ingredient Library page: search bar (debounced, partial-match), ingredient list table, inline create/edit form, delete with confirmation dialog listing affected recipes
    - _Requirements: 1.1, 1.6, 1.7, 1.8, 1.9_

- [x] 22. Frontend recipe management screens
  - [x] 22.1 Implement Recipe Builder page: ingredient line editor (ingredient picker, quantity input, UOM select, incompatible-UOM error inline), sub-recipe picker with circular-reference error, portion count input, name validation
    - Display cost breakdown table: each line's name, qty, uom, unit cost, line cost; total batch cost; food cost per portion; missing-price warnings
    - Show `ThresholdIndicator` and food cost percentage badge
    - _Requirements: 2.1–2.12, 3.1–3.7, 4.1–4.8_

  - [x] 22.2 Implement duplicate recipe flow and recipe search/list page
    - _Requirements: 2.6, 2.9_

- [x] 23. Frontend recipe costing report and CSV export
  - [x] 23.1 Implement Recipe Costing Report page: sortable columns (click to toggle asc/desc), threshold filter toggle, empty-filter message, CSV export button
    - _Requirements: 5.1–5.7_

- [x] 24. Frontend multi-venue management screens
  - [x] 24.1 Implement venue selector in application header (always visible when authenticated), venue creation/rename/delete pages, cross-venue summary report page
    - Free tier upgrade prompt on attempt to create third venue
    - _Requirements: 10.1–10.11_

- [x] 25. Frontend subscription management screens
  - [x] 25.1 Implement account settings page: current tier badge, billing renewal date, upgrade/downgrade flows (Stripe payment element), subscription history list, in-app payment-failed banner
    - _Requirements: 11.1–11.9_

- [x] 26. Frontend Pro/Pro+ feature screens
  - [x] 26.1 Implement Square POS connection page (OAuth redirect button, sync status, unmatched item review list) and invoice upload page (file picker, progress indicator, review table with low-confidence highlighting, confirm flow)
    - _Requirements: 12.1–12.10_

  - [x] 26.2 Implement AI Insights dashboard: insight cards with title, explanation, supporting data, recommended action; actioned/dismissed controls; insufficient-data message with estimated date
    - _Requirements: 13.1–13.8_

- [x] 27. Checkpoint — full stack wired
  - Ensure all tests pass, ask the user if questions arise.

- [x] 28. Integration tests
  - [x] 28.1 Write Testcontainers integration tests for ingredient and recipe CRUD, cost propagation, and data export/import using PostgreSQL and LocalStack SQS
    - Cover: create ingredient → SQS message sent → worker recalculates → recipe updated within 2 s
    - Cover: export then import; assert round-trip equality on all fields
    - _Requirements: 1.1–1.10, 2.1–2.12, 3.1–3.4, 7.4–7.7_

  - [x] 28.2 Write integration tests for authentication flows using WireMock for Cognito JWKS endpoint; test JWT validation, password reset, session invalidation, and social login account linking
    - _Requirements: 8.1–8.10_

  - [x] 28.3 Write integration tests for RBAC filter chain: Admin, Manager, Staff tokens against all restricted endpoints; verify venue scope isolation
    - _Requirements: 9.1–9.10, 10.3_

  - [x] 28.4 Write integration tests for Square sync worker using WireMock for Square API; test matched price update, unmatched item logging, token refresh
    - _Requirements: 12.1–12.5_

  - [x] 28.5 Write integration tests for OCR pipeline using LocalStack S3, WireMock for Textract; test review flow and low-confidence field flagging
    - _Requirements: 12.6–12.10_

  - [x] 28.6 Write integration tests for AI insights worker using WireMock for Bedrock; test insight upsert, Pro+ tier guard, and autonomy constraint (no recipe/ingredient modification)
    - _Requirements: 13.1–13.8_

  - [x] 28.7 Write integration tests for Stripe webhook handler: payment success, failure, 7-day downgrade, subscription deletion
    - _Requirements: 11.4–11.8_

- [x] 29. Frontend E2E tests (Playwright)
  - [x] 29.1 Write Playwright E2E tests for critical user journeys against the staging environment: register → login → create ingredient → create recipe → view cost breakdown → view report → export CSV → logout
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 7.4_

  - [x] 29.2 Write Playwright E2E tests for social login (Google), venue switching, and subscription upgrade prompt display
    - _Requirements: 8.3, 10.9, 11.3_

- [x] 30. CI/CD pipeline (GitHub Actions)
  - [x] 30.1 Implement GitHub Actions workflow `ci.yml`: on push/PR — run `./gradlew test` (all modules), run Vitest, build Docker images for `api` and `workers`, push to ECR, run `cdk diff`
    - Use GitHub OIDC + AWS IAM role for keyless ECR and CDK access
    - _Requirements: all_

  - [x] 30.2 Implement GitHub Actions workflow `deploy.yml`: on merge to `main` — `cdk deploy --app "npx ts-node bin/app.ts" --require-approval never` to staging; run Playwright E2E; if pass, deploy to prod
    - _Requirements: all_

- [x] 31. Observability wiring
  - [x] 31.1 Add structured JSON logging to all Spring Boot services using Logback + `logstash-logback-encoder`; add correlation ID (`X-Request-ID`) propagation through MDC; enable AWS X-Ray SDK tracing on all outbound HTTP and SQS calls
    - _Requirements: 3.3_

  - [x] 31.2 Expose Spring Boot Actuator metrics (`/actuator/prometheus`); configure Kubernetes `ServiceMonitor` or CloudWatch agent to scrape and publish to CloudWatch custom namespace
    - _Requirements: 3.3_

- [x] 32. Final checkpoint — all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use jqwik on the Spring Boot backend; minimum 1000 tries, 5000 for financial calculation properties (P1, P2, P9, P11)
- Integration tests use Testcontainers (PostgreSQL, Redis) + LocalStack (SQS, S3, Textract) + WireMock (Square, Stripe, Bedrock, Cognito)
- E2E tests use Playwright against a deployed staging environment
- The CDK `infra/` directory is a separate TypeScript project; CDK tests use the `assertions` library
- Cost propagation SLA is ≤ 2 seconds end-to-end (SQS + worker + Redis pub/sub + SSE push + React Query invalidation)
- The AI pipeline is read-only with respect to `recipes` and `ingredients`; all changes require explicit user confirmation


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["1.1", "2.1"]
    },
    {
      "id": 1,
      "tasks": ["1.2", "1.3", "1.4", "1.5", "1.6", "1.7", "2.2"]
    },
    {
      "id": 2,
      "tasks": ["1.8", "1.9", "1.10", "1.11", "2.3", "2.4"]
    },
    {
      "id": 3,
      "tasks": ["3.1"]
    },
    {
      "id": 4,
      "tasks": ["3.2", "3.3"]
    },
    {
      "id": 5,
      "tasks": ["4.1", "5.1", "7.1"]
    },
    {
      "id": 6,
      "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "5.2", "7.2", "7.3"]
    },
    {
      "id": 7,
      "tasks": ["4.7", "5.3", "5.4", "5.5", "6.1", "8.3"]
    },
    {
      "id": 8,
      "tasks": ["4.8", "5.6", "6.2", "6.3", "8.1", "8.4"]
    },
    {
      "id": 9,
      "tasks": ["6.4", "8.2", "8.5", "9.1", "10.1"]
    },
    {
      "id": 10,
      "tasks": ["6.5", "6.6", "9.2", "9.3", "9.4", "10.2", "12.1"]
    },
    {
      "id": 11,
      "tasks": ["9.5", "9.6", "10.3", "10.4", "12.2", "12.3"]
    },
    {
      "id": 12,
      "tasks": ["13.1", "13.2", "13.3"]
    },
    {
      "id": 13,
      "tasks": ["13.4", "13.5", "13.6", "14.1"]
    },
    {
      "id": 14,
      "tasks": ["14.2", "15.1"]
    },
    {
      "id": 15,
      "tasks": ["15.2", "16.1", "19.1"]
    },
    {
      "id": 16,
      "tasks": ["15.3", "16.2", "19.2", "19.3"]
    },
    {
      "id": 17,
      "tasks": ["16.3", "16.4", "17.1", "20.1", "20.2"]
    },
    {
      "id": 18,
      "tasks": ["17.2", "21.1", "22.1"]
    },
    {
      "id": 19,
      "tasks": ["17.3", "18.1", "22.2", "23.1"]
    },
    {
      "id": 20,
      "tasks": ["18.2", "24.1", "25.1", "26.1", "26.2"]
    },
    {
      "id": 21,
      "tasks": ["30.1", "31.1", "31.2"]
    },
    {
      "id": 22,
      "tasks": ["28.1", "28.2", "28.3", "28.4", "28.5", "28.6", "28.7"]
    },
    {
      "id": 23,
      "tasks": ["29.1", "29.2", "30.2"]
    }
  ]
}
```
