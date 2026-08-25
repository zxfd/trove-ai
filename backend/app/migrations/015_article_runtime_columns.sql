-- Add article columns present in ORM but missing from old init migrations.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS mindmap_data JSONB;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS fetch_status VARCHAR(20) NOT NULL DEFAULT 'completed';
