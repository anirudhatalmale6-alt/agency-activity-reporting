const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'reports.db'));
db.pragma('journal_mode = WAL');

// One report = one consolidated row (User Story 2, AC 2a).
// Text fields, checkbox selections, file references and extracted media
// metadata all live on the same row so it exports cleanly to CSV/Access/Power BI.
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at        TEXT NOT NULL,

    -- SALUTE fields
    size              TEXT,
    activity          TEXT,
    location_text     TEXT,
    unit              TEXT,
    observed_at       TEXT,
    equipment         TEXT,        -- comma-joined checkbox selections + free text

    -- geocoordinates that drive the heat map
    latitude          REAL,
    longitude         REAL,
    location_source   TEXT,        -- 'photo_exif' | 'device_gps' | 'manual'

    -- media
    file_name         TEXT,
    file_original     TEXT,
    file_mime         TEXT,
    file_size_bytes   INTEGER,

    -- preserved media metadata (full EXIF/technical JSON, AC 1a)
    media_metadata    TEXT,

    -- compliance
    terms_accepted    INTEGER NOT NULL DEFAULT 0,
    terms_accepted_at TEXT,

    -- moderation
    status            TEXT NOT NULL DEFAULT 'pending'  -- pending | approved | rejected
  );
`);

module.exports = db;
