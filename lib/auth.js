const bcrypt = require('bcryptjs');
const { pool } = require('../db');

// Seed a first admin account so the system is usable on a fresh install.
// Password comes from ADMIN_PASSWORD (falls back to a clearly-temporary value
// that must be changed before going live).
async function seedFirstAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM admins');
  if (rows[0].n > 0) return;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe!123';
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO admins (username, display_name, password_hash, role)
     VALUES ($1, $2, $3, 'admin')`,
    [username, 'System Administrator', hash]
  );
  console.log(`[auth] Seeded first admin "${username}". Change the password after first login.`);
}

async function verifyLogin(username, password) {
  const { rows } = await pool.query(
    'SELECT * FROM admins WHERE username = $1 AND active = TRUE',
    [username]
  );
  if (!rows.length) return null;
  const ok = await bcrypt.compare(password, rows[0].password_hash);
  if (!ok) return null;
  return { id: rows[0].id, username: rows[0].username, display_name: rows[0].display_name, role: rows[0].role };
}

// Route guards.
function requireAuth(req, res, next) {
  if (req.session && req.session.admin) return next();
  return res.status(401).json({ error: 'Authentication required.' });
}
function requireRole(role) {
  return (req, res, next) => {
    if (req.session && req.session.admin && req.session.admin.role === role) return next();
    return res.status(403).json({ error: 'Insufficient permissions.' });
  };
}

module.exports = { seedFirstAdmin, verifyLogin, requireAuth, requireRole };
