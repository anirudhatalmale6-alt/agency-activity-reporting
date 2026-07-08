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

// Prefill observed time with "now".
(function () {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  document.getElementById('observed_at').value = d.toISOString().slice(0, 16);
})();

// Build equipment checkboxes from the server list.
fetch('/api/equipment-options').then(r => r.json()).then(options => {
  const box = document.getElementById('equipmentChecks');
  box.innerHTML = options.map(o => `
    <label class="check">
      <input type="checkbox" name="equipment" value="${o}" /> <span>${o}</span>
    </label>`).join('');
});

// Force read: only enable acceptance once the terms are scrolled to the bottom.
function checkScrolled() {
  if (termsBox.scrollTop + termsBox.clientHeight >= termsBox.scrollHeight - 8) {
    termsCheck.disabled = false;
    termsAcceptLabel.classList.remove('disabled');
    termsBox.removeEventListener('scroll', checkScrolled);
  }
}
termsBox.addEventListener('scroll', checkScrolled);
// In case the terms fit without scrolling.
if (termsBox.scrollHeight <= termsBox.clientHeight + 8) checkScrolled();

termsCheck.addEventListener('change', () => {
  submitBtn.disabled = !termsCheck.checked;
});

// File selection.
dropzone.addEventListener('click', () => mediaInput.click());
mediaInput.addEventListener('change', () => {
  if (mediaInput.files.length) {
    const f = mediaInput.files[0];
    filePreview.textContent = `Selected: ${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
  }
});

// Device geolocation fallback.
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

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!termsCheck.checked) { show('error', 'Please accept the terms and conditions.'); return; }

  const fd = new FormData(form);
  fd.set('terms_accepted', 'true');
  if (mediaInput.files.length) fd.append('media', mediaInput.files[0]);

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  try {
    const res = await fetch('/api/reports', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Submission failed.');
    show('success', `Thank you. Your report was submitted${data.geolocated ? ' and placed on the map' : ''} and is pending review.`);
    form.reset();
    filePreview.textContent = '';
    mediaInput.value = '';
    termsCheck.checked = false;
    submitBtn.disabled = true;
  } catch (err) {
    show('error', err.message);
    submitBtn.disabled = false;
  } finally {
    submitBtn.textContent = 'Submit Report';
  }
});
