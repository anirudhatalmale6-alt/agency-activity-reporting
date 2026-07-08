const form = document.getElementById('reportForm');
const msg = document.getElementById('msg');
const submitBtn = document.getElementById('submitBtn');
const termsBox = document.getElementById('termsBox');
const termsCheck = document.getElementById('termsCheck');
const termsAcceptLabel = document.getElementById('termsAcceptLabel');
const mediaInput = document.getElementById('mediaInput');
const dropzone = document.getElementById('dropzone');
const filePreview = document.getElementById('filePreview');
const geoBtn = document.getElementById('geoBtn');
const geoStatus = document.getElementById('geoStatus');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');

// Prefill observed time with "now".
(function () {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  document.getElementById('observed_at').value = d.toISOString().slice(0, 16);
})();

fetch('/api/equipment-options').then(r => r.json()).then(options => {
  document.getElementById('equipmentChecks').innerHTML = options.map(o => `
    <label class="check"><input type="checkbox" name="equipment" value="${o}" /> <span>${o}</span></label>`).join('');
});

// Force read: acceptance unlocks only after scrolling the terms to the bottom.
function checkScrolled() {
  if (termsBox.scrollTop + termsBox.clientHeight >= termsBox.scrollHeight - 8) {
    termsCheck.disabled = false;
    termsAcceptLabel.classList.remove('disabled');
    termsBox.removeEventListener('scroll', checkScrolled);
  }
}
termsBox.addEventListener('scroll', checkScrolled);
if (termsBox.scrollHeight <= termsBox.clientHeight + 8) checkScrolled();
termsCheck.addEventListener('change', () => { submitBtn.disabled = !termsCheck.checked; });

dropzone.addEventListener('click', () => mediaInput.click());
mediaInput.addEventListener('change', () => {
  if (mediaInput.files.length) {
    const f = mediaInput.files[0];
    filePreview.textContent = `Selected: ${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
  }
});

geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) { geoStatus.textContent = 'Geolocation not supported.'; return; }
  geoStatus.textContent = 'Getting location...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById('device_lat').value = pos.coords.latitude;
      document.getElementById('device_lng').value = pos.coords.longitude;
      geoStatus.textContent = `Location captured (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}).`;
      geoStatus.classList.add('ok');
    },
    () => { geoStatus.textContent = 'Could not get location. You can still type the address above.'; }
  );
});

function show(type, text) {
  msg.className = `msg show ${type}`;
  msg.textContent = text;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Resumable chunked upload for large files (up to a 15-min video).
async function uploadFile(file) {
  const init = await (await fetch('/api/uploads/init', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, mime: file.type, size: file.size }),
  })).json();
  if (!init.uploadId) throw new Error(init.error || 'Upload could not start.');

  const chunkSize = init.chunkSize || 5 * 1024 * 1024;
  progressWrap.style.display = 'block';
  for (let start = 0; start < file.size; start += chunkSize) {
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
    const r = await fetch(`/api/uploads/${init.uploadId}/chunk`, { method: 'POST', body: chunk });
    if (!r.ok) throw new Error('Upload failed mid-way. Please retry.');
    progressBar.style.width = `${Math.min(100, Math.round(((start + chunkSize) / file.size) * 100))}%`;
  }
  const done = await (await fetch(`/api/uploads/${init.uploadId}/complete`, { method: 'POST' })).json();
  if (!done.ok) throw new Error(done.error || 'Upload could not be finalized.');
  progressBar.style.width = '100%';
  return { uploadId: init.uploadId, sha256: done.sha256 };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!termsCheck.checked) { show('error', 'Please accept the terms and conditions.'); return; }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  try {
    let uploadId = null;
    if (mediaInput.files.length) {
      submitBtn.textContent = 'Uploading file...';
      const up = await uploadFile(mediaInput.files[0]);
      uploadId = up.uploadId;
    }

    const equipment = Array.from(form.querySelectorAll('input[name=equipment]:checked')).map(c => c.value);
    const payload = {
      size: form.size.value, activity: form.activity.value, location_text: form.location_text.value,
      unit: form.unit.value, observed_at: form.observed_at.value, equipment,
      equipment_other: form.equipment_other.value,
      device_lat: document.getElementById('device_lat').value || null,
      device_lng: document.getElementById('device_lng').value || null,
      uploadId, terms_accepted: true,
    };
    submitBtn.textContent = 'Saving report...';
    const res = await fetch('/api/reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed.');
    show('success', `Thank you. Your report was submitted${data.geolocated ? ' and placed on the map' : ''} and is pending review.`);
    form.reset();
    filePreview.textContent = ''; mediaInput.value = '';
    progressWrap.style.display = 'none'; progressBar.style.width = '0%';
    termsCheck.checked = false; submitBtn.disabled = true;
  } catch (err) {
    show('error', err.message);
    submitBtn.disabled = false;
  } finally {
    submitBtn.textContent = 'Submit Report';
  }
});
