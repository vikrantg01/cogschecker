-- V1__create_core_tables.sql
-- Creates core tables for organisations, subscriptions, users, venues, and system configuration
-- Requirements: 8.1 (User Authentication), 9.1 (RBAC), 10.1 (Multi-Venue Management), 11.1 (Subscription Tiers)

-- Create organisations table
CREATE TABLE organisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create subscriptions table
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL UNIQUE REFERENCES organisations(id) ON DELETE CASCADE,
    tier VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'pro_plus')),
    stripe_customer_id VARCHAR(255),
    stripe_subscription_id VARCHAR(255),
    current_period_end TIMESTAMPTZ,
    pending_downgrade_tier VARCHAR(20) CHECK (pending_downgrade_tier IN ('free', 'pro', 'pro_plus')),
    payment_failed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on organisation_id for subscriptions
CREATE INDEX idx_subscriptions_organisation_id ON subscriptions(organisation_id);

-- Create users table
CREATE TABLE users (
    id UUID PRIMARY KEY,  -- Matches Cognito user ID
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create index on email for users
CREATE INDEX idx_users_email ON users(email);

-- Create venues table
CREATE TABLE venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for venues
CREATE INDEX idx_venues_organisation_id ON venues(organisation_id);
CREATE INDEX idx_venues_deleted_at ON venues(deleted_at);

-- Add function-based unique index for case-insensitive venue name uniqueness per organisation
CREATE UNIQUE INDEX idx_venues_organisation_name_unique ON venues(organisation_id, LOWER(name)) WHERE deleted_at IS NULL;

-- Create user_organisation_roles table
CREATE TABLE user_organisation_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organisation_id UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    is_admin BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, organisation_id)
);

-- Create indexes for user_organisation_roles
CREATE INDEX idx_user_organisation_roles_user_id ON user_organisation_roles(user_id);
CREATE INDEX idx_user_organisation_roles_organisation_id ON user_organisation_roles(organisation_id);

-- Create user_venue_roles table
CREATE TABLE user_venue_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'manager', 'staff')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, venue_id)
);

-- Create indexes for user_venue_roles
CREATE INDEX idx_user_venue_roles_user_id ON user_venue_roles(user_id);
CREATE INDEX idx_user_venue_roles_venue_id ON user_venue_roles(venue_id);

-- Create system_config table
CREATE TABLE system_config (
    venue_id UUID PRIMARY KEY REFERENCES venues(id) ON DELETE CASCADE,
    target_food_cost_percentage NUMERIC(5,1) NOT NULL DEFAULT 30.0 CHECK (target_food_cost_percentage >= 1 AND target_food_cost_percentage <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at for all tables
CREATE TRIGGER update_organisations_updated_at BEFORE UPDATE ON organisations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_venues_updated_at BEFORE UPDATE ON venues
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_organisation_roles_updated_at BEFORE UPDATE ON user_organisation_roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_venue_roles_updated_at BEFORE UPDATE ON user_venue_roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE organisations IS 'Top-level accounts that own one or more venues';
COMMENT ON TABLE subscriptions IS 'Subscription tier and billing information for organisations';
COMMENT ON TABLE users IS 'User accounts (matches Cognito user IDs)';
COMMENT ON TABLE venues IS 'Physical cafe or restaurant locations belonging to organisations';
COMMENT ON TABLE user_organisation_roles IS 'Organisation-level admin role assignments';
COMMENT ON TABLE user_venue_roles IS 'Venue-specific role assignments (admin, manager, staff)';
COMMENT ON TABLE system_config IS 'Venue-specific configuration settings including target food cost percentage';
