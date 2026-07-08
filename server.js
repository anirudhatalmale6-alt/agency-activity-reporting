const express = require('express');
const multer = require('multer');
const exifr = require('exifr');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// Store the raw upload untouched so ALL original metadata is preserved (AC 1a).
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB placeholder, tune to hosting
});

// Pull GPS + full technical metadata out of an uploaded photo/video.
async function extractMetadata(filePath, mime) {
  const result = { gps: null, exif: null };
  try {
    if (mime && mime.startsWith('image/')) {
      const full = await exifr.parse(filePath, { gps: true, translateValues: true });
      if (full) {
        result.exif = full;
        if (typeof full.latitude === 'number' && typeof full.longitude === 'number') {
          result.gps = { lat: full.latitude, lng: full.longitude };
        }
      }
    }
    // NOTE: video GPS (QuickTime/MP4 location atom) can be added with a
    // dedicated parser once we confirm the video formats in use.
  } catch (e) {
    // A file with no readable metadata is fine - we just store what we have.
  }
  return result;
}

const EQUIPMENT_OPTIONS = [
  'Flexicuffs', 'Dogs', 'Batons', 'LRAD sound cannon',
  'Armored vehicles', 'Firearms', 'Tear gas / chemical agents', 'Drones',
];

// --- Submit a report -------------------------------------------------------
app.post('/api/reports', upload.single('media'), async (req, res) => {
  try {
    const b = req.body;

    if (b.terms_accepted !== 'true' && b.terms_accepted !== 'on' && b.terms_accepted !== '1') {
      return res.status(400).json({ error: 'You must read and accept the terms and conditions.' });
    }

    // Equipment: checkbox array + optional free text.
    let equipment = [];
    if (Array.isArray(b.equipment)) equipment = b.equipment;
    else if (typeof b.equipment === 'string' && b.equipment) equipment = [b.equipment];
    if (b.equipment_other && b.equipment_other.trim()) equipment.push(b.equipment_other.trim());

    let lat = null, lng = null, source = null;
    let metadata = null;

    if (req.file) {
      const meta = await extractMetadata(req.file.path, req.file.mimetype);
      metadata = JSON.stringify(meta.exif || {});
      if (meta.gps) { lat = meta.gps.lat; lng = meta.gps.lng; source = 'photo_exif'; }
    }

    // Fall back to device GPS captured in the browser, then manual entry.
    if (lat == null && b.device_lat && b.device_lng) {
      lat = parseFloat(b.device_lat); lng = parseFloat(b.device_lng); source = 'device_gps';
    }
    if (lat == null && b.manual_lat && b.manual_lng) {
      lat = parseFloat(b.manual_lat); lng = parseFloat(b.manual_lng); source = 'manual';
    }

    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO reports (
        created_at, size, activity, location_text, unit, observed_at, equipment,
        latitude, longitude, location_source,
        file_name, file_original, file_mime, file_size_bytes, media_metadata,
        terms_accepted, terms_accepted_at, status
      ) VALUES (
        @created_at, @size, @activity, @location_text, @unit, @observed_at, @equipment,
        @latitude, @longitude, @location_source,
        @file_name, @file_original, @file_mime, @file_size_bytes, @media_metadata,
        1, @terms_accepted_at, 'pending'
      )
    `);
    const info = stmt.run({
      created_at: now,
      size: b.size || null,
      activity: b.activity || null,
      location_text: b.location_text || null,
      unit: b.unit || null,
      observed_at: b.observed_at || null,
      equipment: equipment.join(', ') || null,
      latitude: lat,
      longitude: lng,
      location_source: source,
      file_name: req.file ? req.file.filename : null,
      file_original: req.file ? req.file.originalname : null,
      file_mime: req.file ? req.file.mimetype : null,
      file_size_bytes: req.file ? req.file.size : null,
      media_metadata: metadata,
      terms_accepted_at: now,
    });

    res.json({ ok: true, id: info.lastInsertRowid, geolocated: lat != null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong saving your report.' });
  }
});

// --- Admin: list reports ---------------------------------------------------
app.get('/api/reports', (req, res) => {
  const rows = db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all();
  res.json(rows);
});

// --- Admin: moderate -------------------------------------------------------
app.post('/api/reports/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

// --- Admin: CSV export (Access / Power BI ready, AC 2b) ---------------------
app.get('/api/export.csv', (req, res) => {
  const rows = db.prepare('SELECT * FROM reports ORDER BY id').all();
  const cols = [
    'id', 'created_at', 'size', 'activity', 'location_text', 'unit', 'observed_at',
    'equipment', 'latitude', 'longitude', 'location_source', 'file_original',
    'file_mime', 'file_size_bytes', 'terms_accepted', 'status',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const csv = [cols.join(',')]
    .concat(rows.map((r) => cols.map((c) => esc(r[c])).join(',')))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="agency_reports.csv"');
  res.send(csv);
});

// --- Heat map data (approved reports with coordinates) ----------------------
app.get('/api/heatmap.json', (req, res) => {
  const rows = db.prepare(`
    SELECT latitude, longitude, activity, unit, observed_at
    FROM reports
    WHERE status = 'approved' AND latitude IS NOT NULL AND longitude IS NOT NULL
  `).all();
  res.json(rows);
});

app.get('/api/equipment-options', (req, res) => res.json(EQUIPMENT_OPTIONS));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
