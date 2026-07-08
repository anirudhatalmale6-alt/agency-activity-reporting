const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { pool, init } = require('./db');
const audit = require('./lib/audit');
const media = require('./lib/media');
const { seedFirstAdmin, verifyLogin, requireAuth, requireRole } = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const TMP_DIR = path.join(__dirname, 'uploads', '.tmp');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

const EQUIPMENT_OPTIONS = [
  'Flexicuffs', 'Dogs', 'Batons', 'LRAD sound cannon',
  'Armored vehicles', 'Firearms', 'Tear gas / chemical agents', 'Drones',
];
const MAX_FILE_BYTES = 3 * 1024 * 1024 * 1024; // 3GB ceiling (covers 15-min video)

// In-flight chunked uploads: uploadId -> { tmpPath, filename, mime, received, done, fileInfo }
const uploads = new Map();

// ===================== AUTH =====================
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = await verifyLogin(username || '', password || '');
  if (!admin) {
    await audit.record({ req, action: 'login_failed', entityType: 'admin', changes: { username } });
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  req.session.admin = admin;
  await audit.record({ req, action: 'login', entityType: 'admin', entityId: admin.id });
  res.json({ ok: true, admin });
});

app.post('/api/logout', requireAuth, async (req, res) => {
  await audit.record({ req, action: 'logout', entityType: 'admin', entityId: req.session.admin.id });
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ admin: (req.session && req.session.admin) || null });
});

// ===================== CHUNKED UPLOAD (public) =====================
// Robust for 15-min videos on flaky mobile connections.
app.post('/api/uploads/init', (req, res) => {
  const { filename, mime, size } = req.body;
  if (size && size > MAX_FILE_BYTES) {
    return res.status(413).json({ error: 'File exceeds the maximum allowed size.' });
  }
  const uploadId = uuidv4();
  const tmpPath = path.join(TMP_DIR, uploadId);
  fs.writeFileSync(tmpPath, Buffer.alloc(0));
  uploads.set(uploadId, { tmpPath, filename: filename || 'upload', mime: mime || 'application/octet-stream', received: 0, done: false });
  res.json({ uploadId, chunkSize: 5 * 1024 * 1024 });
});

app.post('/api/uploads/:id/chunk', express.raw({ type: '*/*', limit: '20mb' }), (req, res) => {
  const u = uploads.get(req.params.id);
  if (!u || u.done) return res.status(404).json({ error: 'Unknown upload session.' });
  u.received += req.body.length;
  if (u.received > MAX_FILE_BYTES) {
    uploads.delete(req.params.id);
    try { fs.unlinkSync(u.tmpPath); } catch {}
    return res.status(413).json({ error: 'File exceeds the maximum allowed size.' });
  }
  fs.appendFileSync(u.tmpPath, req.body);
  res.json({ ok: true, received: u.received });
});

app.post('/api/uploads/:id/complete', async (req, res) => {
  const u = uploads.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Unknown upload session.' });
  try {
    const ext = path.extname(u.filename);
    const finalName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    const finalPath = path.join(UPLOAD_DIR, finalName);
    fs.renameSync(u.tmpPath, finalPath);
    // Integrity hash + full metadata + best-effort GPS, computed once at ingest.
    const info = await media.inspectMedia(finalPath, u.mime);
    // Make the stored original read-only (write-once evidence).
    try { fs.chmodSync(finalPath, 0o444); } catch {}
    u.done = true;
    u.fileInfo = {
      file_name: finalName,
      file_original: u.filename,
      file_mime: u.mime,
      file_size_bytes: fs.statSync(finalPath).size,
      file_sha256: info.sha256,
      media_metadata: info.metadata,
      gps: info.gps,
      location_source: info.source,
    };
    res.json({ ok: true, sha256: info.sha256, geolocated: !!info.gps });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not finalize upload.' });
  }
});

// ===================== SUBMIT REPORT (public) =====================
app.post('/api/reports', async (req, res) => {
  try {
    const b = req.body;
    if (b.terms_accepted !== true && b.terms_accepted !== 'true') {
      return res.status(400).json({ error: 'You must read and accept the terms and conditions.' });
    }

    let equipment = [];
    if (Array.isArray(b.equipment)) equipment = b.equipment.slice();
    else if (typeof b.equipment === 'string' && b.equipment) equipment = [b.equipment];
    if (b.equipment_other && String(b.equipment_other).trim()) equipment.push(String(b.equipment_other).trim());

    // Media (optional) comes from a completed chunked upload.
    let fi = null;
    if (b.uploadId) {
      const u = uploads.get(b.uploadId);
      if (u && u.done && u.fileInfo) { fi = u.fileInfo; uploads.delete(b.uploadId); }
    }

    // Location priority: media GPS -> device GPS -> manual.
    let lat = null, lng = null, source = null;
    if (fi && fi.gps) { lat = fi.gps.lat; lng = fi.gps.lng; source = fi.location_source; }
    if (lat == null && b.device_lat && b.device_lng) { lat = parseFloat(b.device_lat); lng = parseFloat(b.device_lng); source = 'device_gps'; }
    if (lat == null && b.manual_lat && b.manual_lng) { lat = parseFloat(b.manual_lat); lng = parseFloat(b.manual_lng); source = 'manual'; }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
    const { rows } = await pool.query(
      `INSERT INTO reports (
        size, activity, location_text, unit, observed_at, equipment,
        latitude, longitude, location_source,
        file_name, file_original, file_mime, file_size_bytes, file_sha256, media_metadata,
        submitter_ip, submitter_agent, terms_accepted, terms_accepted_at, status
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,TRUE,now(),'pending'
      ) RETURNING id`,
      [
        b.size || null, b.activity || null, b.location_text || null, b.unit || null,
        b.observed_at || null, equipment.join(', ') || null,
        lat, lng, source,
        fi ? fi.file_name : null, fi ? fi.file_original : null, fi ? fi.file_mime : null,
        fi ? fi.file_size_bytes : null, fi ? fi.file_sha256 : null,
        fi ? JSON.stringify(fi.media_metadata || {}) : null,
        ip, req.headers['user-agent'] || null,
      ]
    );
    res.json({ ok: true, id: rows[0].id, geolocated: lat != null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong saving your report.' });
  }
});

app.get('/api/equipment-options', (req, res) => res.json(EQUIPMENT_OPTIONS));

// ===================== ADMIN (protected + audited) =====================
app.get('/api/reports', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM reports ORDER BY created_at DESC');
  await audit.record({ req, action: 'view', entityType: 'report', changes: { count: rows.length } });
  res.json(rows);
});

app.post('/api/reports/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const cur = await pool.query('SELECT status FROM reports WHERE id = $1', [req.params.id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'Report not found.' });
  const before = cur.rows[0].status;
  await pool.query(
    'UPDATE reports SET status = $1, reviewed_by = $2, reviewed_at = now() WHERE id = $3',
    [status, req.session.admin.id, req.params.id]
  );
  await audit.record({
    req, action: status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'edit',
    entityType: 'report', entityId: req.params.id, changes: { status: { from: before, to: status } },
  });
  res.json({ ok: true });
});

// Edit report text fields (audited with before/after per field).
app.patch('/api/reports/:id', requireAuth, async (req, res) => {
  const editable = ['size', 'activity', 'location_text', 'unit', 'equipment'];
  const cur = await pool.query('SELECT * FROM reports WHERE id = $1', [req.params.id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'Report not found.' });
  const before = cur.rows[0];
  const sets = [], vals = [], changes = {};
  let i = 1;
  for (const f of editable) {
    if (f in req.body && req.body[f] !== before[f]) {
      sets.push(`${f} = $${i++}`); vals.push(req.body[f]);
      changes[f] = { from: before[f], to: req.body[f] };
    }
  }
  if (!sets.length) return res.json({ ok: true, unchanged: true });
  vals.push(req.params.id);
  await pool.query(`UPDATE reports SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  await audit.record({ req, action: 'edit', entityType: 'report', entityId: req.params.id, changes });
  res.json({ ok: true, changes });
});

app.get('/api/audit', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY at DESC LIMIT 500');
  res.json(rows);
});

// Admin user management (admin role only).
app.get('/api/admins', requireAuth, requireRole('admin'), async (req, res) => {
  const { rows } = await pool.query('SELECT id, username, display_name, role, active, created_at FROM admins ORDER BY created_at');
  res.json(rows);
});
app.post('/api/admins', requireAuth, requireRole('admin'), async (req, res) => {
  const bcrypt = require('bcryptjs');
  const { username, display_name, password, role } = req.body;
  if (!username || !password || !display_name) return res.status(400).json({ error: 'username, display_name and password are required.' });
  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO admins (username, display_name, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id`,
      [username, display_name, hash, role === 'admin' ? 'admin' : 'reviewer']
    );
    await audit.record({ req, action: 'create_admin', entityType: 'admin', entityId: rows[0].id, changes: { username, role } });
    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    res.status(400).json({ error: 'Username already exists.' });
  }
});

// Bulk import from CSV / Excel (admin, audited). Original brief: file uploads (CSV, Excel).
app.post('/api/import', requireAuth, express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const importer = require('./lib/importer');
  const format = (req.query.format || 'csv').toLowerCase();
  const markApproved = req.query.status === 'approved';
  try {
    const { records, skipped, headerMap } = await importer.parseImport(req.body, format);
    if (!records.length) {
      return res.status(400).json({ error: 'No valid rows found. Check the column headers.', headerMap });
    }
    const status = markApproved ? 'approved' : 'pending';
    let inserted = 0;
    for (const r of records) {
      const src = (r.latitude != null && r.longitude != null) ? 'import' : null;
      await pool.query(
        `INSERT INTO reports (size, activity, location_text, unit, observed_at, equipment,
          latitude, longitude, location_source, terms_accepted, status, reviewed_by, reviewed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11,$12)`,
        [r.size, r.activity, r.location_text, r.unit, r.observed_at, r.equipment,
         r.latitude, r.longitude, src, status,
         markApproved ? req.session.admin.id : null, markApproved ? new Date() : null]
      );
      inserted++;
    }
    await audit.record({ req, action: 'import', entityType: 'report',
      changes: { format, inserted, skipped, markedApproved: markApproved, mappedColumns: Object.keys(headerMap) } });
    res.json({ ok: true, inserted, skipped, mappedColumns: Object.keys(headerMap) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Import failed. Make sure the file is a valid CSV or Excel file.' });
  }
});

// CSV export (Access / Power BI ready) - audited.
app.get('/api/export.csv', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM reports ORDER BY id');
  const cols = ['id', 'created_at', 'size', 'activity', 'location_text', 'unit', 'observed_at',
    'equipment', 'latitude', 'longitude', 'location_source', 'file_original', 'file_mime',
    'file_size_bytes', 'file_sha256', 'status', 'reviewed_at'];
  const esc = (v) => { if (v == null) return ''; const s = String(v).replace(/"/g, '""'); return /[",\n]/.test(s) ? `"${s}"` : s; };
  const csv = [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\n');
  await audit.record({ req, action: 'export', entityType: 'report', changes: { format: 'csv', count: rows.length } });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="agency_reports.csv"');
  res.send(csv);
});

// ===================== HEAT MAP (public, approved only) =====================
app.get('/api/heatmap.json', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT latitude, longitude, activity, unit, observed_at FROM reports
     WHERE status = 'approved' AND latitude IS NOT NULL AND longitude IS NOT NULL`
  );
  res.json(rows);
});

// ===================== START =====================
(async () => {
  await init();
  // A read-only view Power BI connects to (approved reports for public display).
  await pool.query(`
    CREATE OR REPLACE VIEW powerbi_heatmap AS
      SELECT id, created_at, activity, unit, equipment, observed_at,
             latitude, longitude, location_text, status
      FROM reports WHERE status = 'approved' AND latitude IS NOT NULL;
  `);
  await seedFirstAdmin();
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
})();
