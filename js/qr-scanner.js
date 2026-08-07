import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';
import { rememberProtectedRedirect } from './auth.js';

const QR_TOKEN_PATTERN = /^[0-9a-f]{64}$/i;
let activeStream = null;
let scanFrame = null;
let scanGeneration = 0;
let isCameraStarting = false;
let isDecoding = false;
let isSubmitting = false;
let studentProfile = null;

const setCameraButton = (isScanning) => {
  const button = document.getElementById('btn-start-camera');
  if (!button) return;
  button.disabled = isCameraStarting;
  button.innerHTML = isCameraStarting
    ? '<i class="fa-solid fa-spinner fa-spin me-2"></i>Starting camera…'
    : isScanning
      ? '<i class="fa-solid fa-stop me-2"></i>Stop camera'
      : '<i class="fa-solid fa-camera me-2"></i>Scan QR with camera';
};

const stopCamera = () => {
  scanGeneration += 1;
  if (scanFrame) cancelAnimationFrame(scanFrame);
  scanFrame = null;
  activeStream?.getTracks().forEach((track) => track.stop());
  activeStream = null;
  isDecoding = false;
  const preview = document.getElementById('qr-camera-preview');
  if (preview) {
    preview.srcObject = null;
    preview.classList.add('d-none');
    preview.parentElement?.classList.remove('is-scanning');
  }
  setCameraButton(false);
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
  showCheckinConfirmation();
  return true;
};

const startDecoder = (video, generation) => {
  let detector = null;
  try { if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
  catch { detector = null; }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const scheduleNextScan = () => {
    if (generation === scanGeneration && activeStream) scanFrame = requestAnimationFrame(scan);
  };
  const scan = async () => {
    if (generation !== scanGeneration || !activeStream) return;
    if (isDecoding || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return scheduleNextScan();
    isDecoding = true;
    try {
      if (detector) {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue && useDetectedValue(codes[0].rawValue)) return;
      } else if (window.jsQR && context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const result = window.jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
        if (result?.data && useDetectedValue(result.data)) return;
      }
    } catch { /* A dropped video frame is safe to ignore. */ }
    finally { isDecoding = false; }
    scheduleNextScan();
  };
  scan();
};

const requestCamera = async () => {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not support camera scanning.');
  const generation = ++scanGeneration;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  if (generation !== scanGeneration) {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  activeStream = stream;
  const preview = document.getElementById('qr-camera-preview');
  preview.srcObject = activeStream;
  preview.classList.remove('d-none');
  preview.parentElement?.classList.add('is-scanning');
  await preview.play();
  document.getElementById('camera-status').textContent = 'Camera is active. Point it at the attendance QR code.';
  setCameraButton(true);
  startDecoder(preview, generation);
};

const setSubmitButton = (isLoading) => {
  const button = document.getElementById('btn-submit-checkin');
  button.disabled = isLoading;
  button.innerHTML = isLoading
    ? '<i class="fa-solid fa-spinner fa-spin me-2"></i>Verifying attendance…'
    : '<i class="fa-solid fa-check me-2"></i>Mark attendance';
};

const showCheckinSuccess = () => {
  document.getElementById('checkin-success-name').textContent = studentProfile?.full_name || 'Karunya Student';
  const dialog = document.getElementById('checkin-success-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
};

const closeDialog = (id) => {
  const dialog = document.getElementById(id);
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
};

const showDialog = (id) => {
  const dialog = document.getElementById(id);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
};

const showCheckinConfirmation = () => {
  const token = extractToken(document.getElementById('input-token').value);
  if (!token) return showToast('Scan a valid attendance QR code before confirming.', 'danger');
  document.getElementById('checkin-confirm-name').textContent = studentProfile?.full_name || 'Karunya Student';
  showDialog('checkin-confirm-dialog');
};

const attendanceErrorMessage = async (error) => {
  const response = error?.context;
  if (response && typeof response.clone === 'function') {
    const body = await response.clone().json().catch(() => null);
    if (typeof body?.message === 'string') return body.message;
  }
  return 'Attendance could not be verified. Please try again.';
};

const markAttendance = () => {
  if (isSubmitting) return;
  const input = document.getElementById('input-token');
  const token = extractToken(input.value);
  if (!token) return showToast('Scan a valid attendance QR code before confirming.', 'danger');
  input.value = token;
  closeDialog('checkin-confirm-dialog');
  isSubmitting = true;
  setSubmitButton(true);
  navigator.geolocation.getCurrentPosition(async (position) => {
    try {
      const { data, error } = await supabase.functions.invoke('attendance-api', { body: { action: 'mark-attendance', token, latitude: position.coords.latitude, longitude: position.coords.longitude } });
      if (error) return showToast(await attendanceErrorMessage(error), 'danger');
      showCheckinSuccess();
      showToast(data?.message ?? 'Attendance marked.', 'success');
    } catch (error) {
      showToast(await attendanceErrorMessage(error), 'danger');
    } finally {
      isSubmitting = false;
      setSubmitButton(false);
    }
  }, () => {
    isSubmitting = false;
    setSubmitButton(false);
    showToast('Location permission is required to mark attendance.', 'danger');
  }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
};

export async function initCheckinPage() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { rememberProtectedRedirect(); return location.replace('/'); }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { rememberProtectedRedirect(); return location.replace('/'); }
  const { data: profile } = await supabase.from('profiles').select('full_name,register_number').eq('id', user.id).maybeSingle();
  studentProfile = profile ?? { full_name: user.user_metadata?.full_name || user.email?.split('@')[0], register_number: null };
  renderNavbar(user, 'Check-in');
  document.body.classList.add('role-authorized');
  const token = new URLSearchParams(location.search).get('token');
  if (token && QR_TOKEN_PATTERN.test(token)) document.getElementById('input-token').value = token;
  document.getElementById('btn-start-camera').addEventListener('click', async () => {
    if (isCameraStarting) return;
    if (activeStream) return stopCamera();
    isCameraStarting = true;
    setCameraButton(false);
    try { await requestCamera(); }
    catch (error) {
      stopCamera();
      document.getElementById('camera-status').textContent = 'Camera could not start. Allow camera permission, then try again.';
      showToast(error instanceof Error ? error.message : 'Camera could not start.', 'danger');
    } finally {
      isCameraStarting = false;
      setCameraButton(Boolean(activeStream));
    }
  });
  document.getElementById('btn-submit-checkin').addEventListener('click', showCheckinConfirmation);
  document.getElementById('btn-cancel-checkin').addEventListener('click', () => closeDialog('checkin-confirm-dialog'));
  document.getElementById('btn-confirm-checkin').addEventListener('click', markAttendance);
  document.getElementById('btn-close-checkin-success').addEventListener('click', () => {
    closeDialog('checkin-success-dialog');
  });
  if (token && QR_TOKEN_PATTERN.test(token)) showCheckinConfirmation();
  window.addEventListener('pagehide', stopCamera, { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCheckinPage, { once: true });
} else {
  initCheckinPage();
}
