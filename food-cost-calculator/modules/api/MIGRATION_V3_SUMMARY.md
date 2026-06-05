# V3 Migration Summary: Pro/Pro+ Tables

## Overview
Migration `V3__create_pro_proplus_tables.sql` creates five tables for Pro and Pro+ tier features, supporting invoice upload/OCR, Square POS integration, and AI-driven insights.

## Requirements Addressed
- **12.6**: Invoice Upload (Pro/Pro+)
- **12.10**: Invoice History (Pro/Pro+)
- **13.1**: AI Insights (Pro+)

## Tables Created

### 1. `invoices`
Stores uploaded supplier invoice metadata for automated ingredient pricing.

**Key columns:**
- `id` (UUID, PK)
- `venue_id` (FK → venues)
- `file_name`, `s3_key` (file storage references)
- `uploaded_by` (FK → users)
- `processing_status` (enum: pending, processing, review, confirmed, failed)
- `extracted_item_count`

**Indexes:**
- `idx_invoices_venue_id`
- `idx_invoices_uploaded_by`
- `idx_invoices_processing_status`
- `idx_invoices_upload_date`

### 2. `invoice_line_items`
Stores OCR-extracted line items from uploaded invoices with confidence scores.

**Key columns:**
- `id` (UUID, PK)
- `invoice_id` (FK → invoices, ON DELETE CASCADE)
- `extracted_name`, `extracted_quantity`, `extracted_unit`, `extracted_price`
- `confidence_score` (NUMERIC(4,3), range 0.000–1.000)
- `is_low_confidence` (BOOLEAN)
- `matched_ingredient_id` (FK → ingredients)
- `status` (enum: pending, confirmed, dismissed)

**Indexes:**
- `idx_invoice_line_items_invoice_id`
- `idx_invoice_line_items_matched_ingredient_id`
- `idx_invoice_line_items_status`

### 3. `square_connections`
Stores Square POS OAuth credentials per venue (encrypted at rest).

**Key columns:**
- `id` (UUID, PK)
- `venue_id` (UNIQUE, FK → venues)
- `square_merchant_id`
- `access_token_encrypted`, `refresh_token_encrypted` (BYTEA)
- `token_expires_at`
- `last_synced_at`
- `sync_status` (enum: idle, syncing, error)

**Constraints:**
- UNIQUE constraint on `venue_id` (one Square connection per venue)

**Indexes:**
- `idx_square_connections_venue_id`
- `idx_square_connections_last_synced_at`

### 4. `square_unmatched_items`
Tracks Square menu items that couldn't be automatically matched to recipes.

**Key columns:**
- `id` (UUID, PK)
- `venue_id` (FK → venues)
- `square_item_name`, `square_item_price`
- `status` (enum: pending, mapped, dismissed)
- `mapped_recipe_id` (FK → recipes, nullable)

**Indexes:**
- `idx_square_unmatched_items_venue_id`
- `idx_square_unmatched_items_status`
- `idx_square_unmatched_items_mapped_recipe_id`

### 5. `ai_insights`
Stores AI-generated profitability and supplier cost insights (Pro+ tier).

**Key columns:**
- `id` (UUID, PK)
- `venue_id` (FK → venues)
- `insight_type` (enum: recipe_profitability, supplier_cost)
- `title`, `explanation`, `recommended_action`
- `supporting_data` (JSONB) — structured data backing the insight
- `status` (enum: active, actioned, dismissed)
- `generated_at`

**Indexes:**
- `idx_ai_insights_venue_id`
- `idx_ai_insights_insight_type`
- `idx_ai_insights_status`
- `idx_ai_insights_generated_at`

## Key Design Decisions

### Foreign Key Cascade Behavior
- **ON DELETE CASCADE**: Used for parent-child relationships where child data should be removed with parent (e.g., `invoice_line_items` → `invoices`, all tables → `venues`)
- **ON DELETE SET NULL**: Used for soft references that should preserve history (e.g., `invoices.uploaded_by` → `users`)
- **ON DELETE RESTRICT**: Used for dependencies that require explicit handling (e.g., `invoice_line_items.matched_ingredient_id` → `ingredients`)

### Security
- OAuth tokens (`access_token_encrypted`, `refresh_token_encrypted`) stored as BYTEA for envelope encryption with AWS KMS
- Tokens never logged or exposed in API responses

### Performance
- Indexes on all foreign key columns for join performance
- Composite indexes for common query patterns (e.g., `venue_id + status`)
- DESC index on `upload_date` and `generated_at` for time-ordered queries

### Data Integrity
- CHECK constraints for enum-like fields (processing_status, insight_type, etc.)
- NOT NULL constraints on critical fields
- UNIQUE constraint on `square_connections.venue_id` (one connection per venue)

## Triggers
All tables include `updated_at` triggers that automatically update the timestamp on row modification, reusing the `update_updated_at_column()` function created in V1.

## Testing
Migration structure validated via `V3MigrationTest.java`:
- 12 tests covering table structure, indexes, foreign keys, constraints, and triggers
- Tests validate file content without executing SQL (full execution tested in integration tests with real PostgreSQL)
- All tests passing ✅

## Migration Order
This migration depends on:
- **V1** (core tables: `organisations`, `venues`, `users`)
- **V2** (ingredient/recipe tables: `ingredients`, `recipes`)

Foreign key references enforce proper migration order automatically.

## Next Steps
After this migration is applied:
1. Create JPA entities for all five tables
2. Implement service layer for invoice upload and OCR processing
3. Implement Square OAuth flow and sync worker
4. Implement AI insights generation worker (Pro+ tier)
