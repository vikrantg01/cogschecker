-- V4__create_subscription_history_table.sql
-- Creates subscription_history table for tracking tier changes and payment events
-- Requirement 11.9

-- Create subscription_history table
CREATE TABLE subscription_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN (
        'CREATED', 'UPGRADED', 'DOWNGRADED', 'DOWNGRADE_SCHEDULED', 
        'DOWNGRADE_CANCELLED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'PAYMENT_RECOVERED'
    )),
    from_tier VARCHAR(20) CHECK (from_tier IN ('free', 'pro', 'pro_plus')),
    to_tier VARCHAR(20) CHECK (to_tier IN ('free', 'pro', 'pro_plus')),
    stripe_event_id VARCHAR(255),
    description VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for subscription_history
CREATE INDEX idx_subscription_history_organisation_id ON subscription_history(organisation_id);
CREATE INDEX idx_subscription_history_created_at ON subscription_history(created_at DESC);
CREATE INDEX idx_subscription_history_event_type ON subscription_history(event_type);

-- Add comment for documentation
COMMENT ON TABLE subscription_history IS 'History of subscription tier changes and payment events for organisations';
