const crypto = require('crypto');
const fs = require('fs');
const { execFile } = require('child_process');
const exifr = require('exifr');

// SHA-256 of a file, streamed so large videos don't load into memory.
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('error', reject);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
  });
}

// Run ffprobe and return the full parsed metadata (format + streams).
function ffprobe(filePath) {
  return new Promise((resolve) => {
    execFile(
      'ffprobe',
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null);
        try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
      }
    );
  });
}

// Pull a GPS pair out of ffprobe's format tags (e.g. QuickTime/MP4
// "com.apple.quicktime.location.ISO6709" or "location": "+40.7557-073.8831/").
function gpsFromFfprobe(meta) {
  try {
    const tags = (meta && meta.format && meta.format.tags) || {};
    const raw = tags['location'] || tags['com.apple.quicktime.location.ISO6709'] ||
                tags['location-eng'] || null;
    if (!raw) return null;
    const m = raw.match(/([+-]\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)/);
    if (!m) return null;
    return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
  } catch { return null; }
}

// Extract integrity hash + full technical metadata + best-effort GPS for any
// uploaded photo or video. The original file itself is never modified.
async function inspectMedia(filePath, mime) {
  const out = { sha256: null, metadata: {}, gps: null, source: null };
  out.sha256 = await sha256File(filePath);

  if (mime && mime.startsWith('image/')) {
    try {
      const exif = await exifr.parse(filePath, { gps: true, translateValues: true });
      if (exif) {
        out.metadata = exif;
        if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number') {
          out.gps = { lat: exif.latitude, lng: exif.longitude };
          out.source = 'photo_exif';
        }
      }
    } catch { /* no readable EXIF is fine */ }
  } else if (mime && mime.startsWith('video/')) {
    const meta = await ffprobe(filePath);
    if (meta) {
      out.metadata = meta;
      const g = gpsFromFfprobe(meta);
      if (g) { out.gps = g; out.source = 'video_meta'; }
    }
  }
  return out;
}

module.exports = { sha256File, ffprobe, inspectMedia };
