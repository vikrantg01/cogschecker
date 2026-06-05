-- V3__create_pro_proplus_tables.sql
-- Creates tables for Pro and Pro+ tier features (invoice upload/OCR, Square integration, AI insights)
-- Requirements: 12.6 (Invoice Upload), 12.10 (Invoice History), 13.1 (AI Insights)

-- Create invoices table (Pro/Pro+)
CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    s3_key VARCHAR(1024) NOT NULL,
    uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
    upload_date TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'review', 'confirmed', 'failed')),
    extracted_item_count INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for invoices
CREATE INDEX idx_invoices_venue_id ON invoices(venue_id);
CREATE INDEX idx_invoices_uploaded_by ON invoices(uploaded_by);
CREATE INDEX idx_invoices_processing_status ON invoices(processing_status);
CREATE INDEX idx_invoices_upload_date ON invoices(upload_date DESC);

-- Create invoice_line_items table
CREATE TABLE invoice_line_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    extracted_name VARCHAR(255),
    extracted_quantity NUMERIC(10,4),
    extracted_unit VARCHAR(50),
    extracted_price NUMERIC(10,2),
    confidence_score NUMERIC(4,3) CHECK (confidence_score >= 0 AND confidence_score <= 1),
    is_low_confidence BOOLEAN NOT NULL DEFAULT false,
    matched_ingredient_id UUID REFERENCES ingredients(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'dismissed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for invoice_line_items
CREATE INDEX idx_invoice_line_items_invoice_id ON invoice_line_items(invoice_id);
CREATE INDEX idx_invoice_line_items_matched_ingredient_id ON invoice_line_items(matched_ingredient_id);
CREATE INDEX idx_invoice_line_items_status ON invoice_line_items(status);

-- Create square_connections table (Pro/Pro+)
CREATE TABLE square_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL UNIQUE REFERENCES venues(id) ON DELETE CASCADE,
    square_merchant_id VARCHAR(255) NOT NULL,
    access_token_encrypted BYTEA NOT NULL,
    refresh_token_encrypted BYTEA NOT NULL,
    token_expires_at TIMESTAMPTZ NOT NULL,
    last_synced_at TIMESTAMPTZ,
    sync_status VARCHAR(20) NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'error')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index for square_connections
CREATE INDEX idx_square_connections_venue_id ON square_connections(venue_id);
CREATE INDEX idx_square_connections_last_synced_at ON square_connections(last_synced_at);

-- Create square_unmatched_items table
CREATE TABLE square_unmatched_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    square_item_name VARCHAR(255) NOT NULL,
    square_item_price NUMERIC(10,2),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'mapped', 'dismissed')),
    mapped_recipe_id UUID REFERENCES recipes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for square_unmatched_items
CREATE INDEX idx_square_unmatched_items_venue_id ON square_unmatched_items(venue_id);
CREATE INDEX idx_square_unmatched_items_status ON square_unmatched_items(status);
CREATE INDEX idx_square_unmatched_items_mapped_recipe_id ON square_unmatched_items(mapped_recipe_id);

-- Create ai_insights table (Pro+)
CREATE TABLE ai_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    insight_type VARCHAR(50) NOT NULL CHECK (insight_type IN ('recipe_profitability', 'supplier_cost')),
    title VARCHAR(255) NOT NULL,
    explanation TEXT,
    supporting_data JSONB,
    recommended_action TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'actioned', 'dismissed')),
    generated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for ai_insights
CREATE INDEX idx_ai_insights_venue_id ON ai_insights(venue_id);
CREATE INDEX idx_ai_insights_insight_type ON ai_insights(insight_type);
CREATE INDEX idx_ai_insights_status ON ai_insights(status);
CREATE INDEX idx_ai_insights_generated_at ON ai_insights(generated_at DESC);

-- Create triggers to automatically update updated_at for all new tables
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoice_line_items_updated_at BEFORE UPDATE ON invoice_line_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_square_connections_updated_at BEFORE UPDATE ON square_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_square_unmatched_items_updated_at BEFORE UPDATE ON square_unmatched_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_ai_insights_updated_at BEFORE UPDATE ON ai_insights
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE invoices IS 'Supplier invoice uploads for automated ingredient pricing (Pro/Pro+ tier)';
COMMENT ON TABLE invoice_line_items IS 'OCR-extracted line items from uploaded supplier invoices';
COMMENT ON TABLE square_connections IS 'Square POS OAuth connection details per venue (Pro/Pro+ tier)';
COMMENT ON TABLE square_unmatched_items IS 'Square menu items that could not be automatically matched to recipes';
COMMENT ON TABLE ai_insights IS 'AI-generated profitability and supplier cost insights (Pro+ tier)';
