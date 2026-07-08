const { Pool } = require('pg');

// Connection is driven by env vars so the same code runs locally and on Hetzner.
const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'appuser',
  password: process.env.PGPASSWORD || undefined,
  database: process.env.PGDATABASE || 'agency_reports',
});

// Schema. Designed for chain-of-custody: reports are append-first, every admin
// action is written to audit_log, and uploaded files carry a SHA-256 integrity
// hash captured at ingest.
const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'reviewer',   -- reviewer | admin
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- SALUTE fields
  size              TEXT,
  activity          TEXT,
  location_text     TEXT,
  unit              TEXT,
  observed_at       TIMESTAMPTZ,
  equipment         TEXT,

  -- geocoordinates that drive the heat map / Power BI
  latitude          DOUBLE PRECISION,
  longitude         DOUBLE PRECISION,
  location_source   TEXT,        -- photo_exif | video_meta | device_gps | manual

  -- media + integrity (chain of custody)
  file_name         TEXT,
  file_original     TEXT,
  file_mime         TEXT,
  file_size_bytes   BIGINT,
  file_sha256       TEXT,        -- integrity hash captured at ingest
  media_metadata    JSONB,       -- full EXIF / ffprobe technical metadata

  -- submission provenance
  submitter_ip      TEXT,
  submitter_agent   TEXT,

  -- compliance
  terms_accepted    BOOLEAN NOT NULL DEFAULT FALSE,
  terms_accepted_at TIMESTAMPTZ,

  -- moderation (latest state; full history lives in audit_log)
  status            TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  reviewed_by       UUID REFERENCES admins(id),
  reviewed_at       TIMESTAMPTZ
);

-- Immutable evidence trail: one row per admin action on stored data.
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  admin_id       UUID,
  admin_username TEXT,           -- snapshot, survives even if the admin is removed
  action         TEXT NOT NULL,  -- login | logout | view | approve | reject | edit | export | ...
  entity_type    TEXT,           -- report | admin | ...
  entity_id      TEXT,
  changes        JSONB,          -- { field: { from, to } } or arbitrary detail
  ip             TEXT
);

-- Block UPDATE/DELETE on the audit log so it cannot be tampered with.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_change ON audit_log;
CREATE TRIGGER audit_log_no_change
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
`;

async function init() {
  await pool.query(SCHEMA);
}

module.exports = { pool, init };
