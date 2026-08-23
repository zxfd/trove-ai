CREATE TABLE IF NOT EXISTS channel_bindings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), channel VARCHAR(30) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, external_user_id VARCHAR(200) NOT NULL,
    external_tenant_id VARCHAR(200), display_name VARCHAR(200), agent_session_id VARCHAR(100), pending_action TEXT, is_active BOOLEAN DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), unbound_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_binding_external_active ON channel_bindings(channel, external_user_id) WHERE is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_binding_user_active ON channel_bindings(channel, user_id) WHERE is_active = TRUE;
CREATE TABLE IF NOT EXISTS channel_bind_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), channel VARCHAR(30) NOT NULL,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_channel_bind_codes_user ON channel_bind_codes(channel, user_id);
CREATE TABLE IF NOT EXISTS channel_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), channel VARCHAR(30) NOT NULL,
    event_id VARCHAR(200) NOT NULL UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW()
);
