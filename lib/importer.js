const ExcelJS = require('exceljs');

// Flexible header matching so admins can import from Access/Excel/Power BI exports
// without renaming columns first.
const FIELD_ALIASES = {
  size: ['size', 's'],
  activity: ['activity', 'a', 'description'],
  location_text: ['location', 'location_text', 'l', 'address'],
  unit: ['unit', 'u', 'affiliation'],
  observed_at: ['observed_at', 'time', 't', 'datetime', 'observed', 'date'],
  equipment: ['equipment', 'e', 'gear'],
  latitude: ['latitude', 'lat', 'y'],
  longitude: ['longitude', 'lng', 'long', 'lon', 'x'],
};

function buildHeaderMap(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const key = String(h || '').trim().toLowerCase();
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(key)) map[field] = idx;
    }
  });
  return map;
}

function rowToRecord(cells, headerMap) {
  const get = (f) => (headerMap[f] != null ? cells[headerMap[f]] : null);
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const rec = {
    size: get('size'), activity: get('activity'), location_text: get('location_text'),
    unit: get('unit'), observed_at: get('observed_at'), equipment: get('equipment'),
    latitude: num(get('latitude')), longitude: num(get('longitude')),
  };
  // Trim strings, coerce empty to null.
  for (const k of ['size', 'activity', 'location_text', 'unit', 'equipment']) {
    if (rec[k] != null) { rec[k] = String(rec[k]).trim() || null; }
  }
  if (rec.observed_at != null && rec.observed_at !== '') {
    const d = new Date(rec.observed_at);
    rec.observed_at = isNaN(d.getTime()) ? null : d.toISOString();
  } else rec.observed_at = null;
  return rec;
}

// Very small CSV parser (handles quoted fields and embedded commas/newlines).
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

async function parseXLSX(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  const rows = [];
  ws.eachRow((r) => {
    // ExcelJS values are 1-indexed with a leading null; drop it.
    const vals = Array.isArray(r.values) ? r.values.slice(1) : [];
    rows.push(vals.map(v => (v == null ? '' : (v.text != null ? v.text : v))));
  });
  return rows;
}

// Returns { records, skipped, headerMap } from a CSV or XLSX buffer.
async function parseImport(buffer, format) {
  let rows;
  if (format === 'xlsx') rows = await parseXLSX(buffer);
  else rows = parseCSV(buffer.toString('utf8'));
  if (!rows.length) return { records: [], skipped: 0, headerMap: {} };

  const headerMap = buildHeaderMap(rows[0]);
  const records = [];
  let skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const rec = rowToRecord(rows[i], headerMap);
    // Require at least an activity or a location to be a meaningful report.
    if (!rec.activity && !rec.location_text && rec.latitude == null) { skipped++; continue; }
    records.push(rec);
  }
  return { records, skipped, headerMap };
}

module.exports = { parseImport };
