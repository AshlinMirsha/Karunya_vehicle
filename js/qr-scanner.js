import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';

const QR_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
let activeStream = null;
let scanFrame = null;

const stopCamera = () => {
  if (scanFrame) cancelAnimationFrame(scanFrame);
  scanFrame = null;
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = null;
  const preview = document.getElementById('qr-camera-preview');
  if (preview) { preview.srcObject = null; preview.classList.add('d-none'); }
  const button = document.getElementById('btn-start-camera');
  if (button) button.innerHTML = '<i class="fa-solid fa-camera me-2"></i>Scan QR with camera';
};

const extractToken = (value) => {
  const trimmed = String(value ?? '').trim();
  if (QR_TOKEN_PATTERN.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const token = url.searchParams.get('token');
    return token && QR_TOKEN_PATTERN.test(token) ? token : null;
  } catch { return null; }
};

const useDetectedValue = (value) => {
  const token = extractToken(value);
  if (!token) return false;
  document.getElementById('input-token').value = token;
  stopCamera();
  document.getElementById('camera-status').textContent = 'QR code captured. Verify your location to complete check-in.';
  showToast('QR code captured successfully.', 'success');
  return true;
};

const startDecoder = (video) => {
  let detector = null;
  try { if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
  catch { detector = null; }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const scan = async () => {
    if (!activeStream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) { scanFrame = requestAnimationFrame(scan); return; }
    try {
      if (detector) {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue && useDetectedValue(codes[0].rawValue)) return;
      } else if (window.jsQR && context) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const result = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
        if (result?.data && useDetectedValue(result.data)) return;
      }
    } catch { /* A dropped video frame is safe to ignore. */ }
    scanFrame = requestAnimationFrame(scan);
  };
  scan();
};

const requestCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera scanning.');
  activeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  const preview = document.getElementById('qr-camera-preview');
  preview.srcObject = activeStream; preview.classList.remove('d-none'); await preview.play();
  document.getElementById('camera-status').textContent = 'Camera is active. Point it at the attendance QR code.';
  document.getElementById('btn-start-camera').innerHTML = '<i class="fa-solid fa-stop me-2"></i>Stop camera';
  startDecoder(preview);
};

const submitAttendance = () => {
  const token = document.getElementById('input-token').value.trim();
  if (!extractToken(token)) return showToast('Scan a valid attendance QR code before confirming.', 'danger');
  if (!window.confirm('Confirm check-in? Your current location will be verified before attendance is recorded.')) return;
  navigator.geolocation.getCurrentPosition(async (position) => {
  const button = document.getElementById('btn-submit-checkin');
  button.disabled = true; button.textContent = 'Verifying attendance…';
  const { data, error } = await supabase.functions.invoke('attendance-api', { body: { action: 'mark-attendance', token: document.getElementById('input-token').value.trim(), latitude: position.coords.latitude, longitude: position.coords.longitude } });
  button.disabled = false; button.innerHTML = '<i class="fa-solid fa-check me-2"></i>Mark attendance';
  if (error) return showToast('Attendance could not be verified.', 'danger');
  showToast(data?.message ?? 'Attendance marked.', 'success');
  }, () => showToast('Location permission is required to mark attendance.', 'danger'), { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
};

export async function initCheckinPage() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return location.replace('/');
  renderNavbar(user, 'Check-in');
  const token = new URLSearchParams(location.search).get('token');
  if (token && QR_TOKEN_PATTERN.test(token)) document.getElementById('input-token').value = token;
  document.getElementById('btn-start-camera').addEventListener('click', async () => {
    if (activeStream) return stopCamera();
    try { await requestCamera(); }
    catch (error) { stopCamera(); document.getElementById('camera-status').textContent = 'Camera could not start. Allow camera permission, then try again.'; showToast(error instanceof Error ? error.message : 'Camera could not start.', 'danger'); }
  });
  document.getElementById('btn-submit-checkin').addEventListener('click', submitAttendance);
  window.addEventListener('pagehide', stopCamera, { once: true });
}
