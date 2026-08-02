const TOAST_LIFETIME_MS = 4500;
const toastStyle = (type) => ({ success: 'bg-success', danger: 'bg-danger', warning: 'bg-warning text-dark' }[type] ?? 'bg-primary');

export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast align-items-center text-white ${toastStyle(type)} border-0 show shadow-lg mb-2`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  const body = document.createElement('div');
  body.className = 'toast-body font-monospace fs-6';
  body.textContent = String(message);
  toast.append(body);
  container.append(toast);
  setTimeout(() => toast.remove(), TOAST_LIFETIME_MS);
}
