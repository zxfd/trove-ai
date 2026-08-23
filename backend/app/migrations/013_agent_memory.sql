CREATE TABLE IF NOT EXISTS agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
    title VARCHAR(200), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_user ON agent_sessions (user_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS agent_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL, content TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_session ON agent_messages (session_id, created_at);
CREATE TABLE IF NOT EXISTS user_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, kind VARCHAR(20) NOT NULL DEFAULT 'fact',
    content TEXT NOT NULL, source VARCHAR(40) DEFAULT 'agent', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_memory_user ON user_memory (user_id);
