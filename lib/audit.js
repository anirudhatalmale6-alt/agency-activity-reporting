const { pool } = require('../db');

// Append one immutable entry to the evidence trail. Called on every admin
// action that touches stored data (view, approve, reject, edit, export...).
async function record({ req, action, entityType = null, entityId = null, changes = null }) {
  const admin = req && req.session && req.session.admin;
  const ip = req ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress || null) : null;
  await pool.query(
    `INSERT INTO audit_log (admin_id, admin_username, action, entity_type, entity_id, changes, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      admin ? admin.id : null,
      admin ? admin.username : null,
      action,
      entityType,
      entityId != null ? String(entityId) : null,
      changes ? JSON.stringify(changes) : null,
      ip,
    ]
  );
}

module.exports = { record };
