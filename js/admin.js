import { initOperationsDashboard } from './operations-dashboard.js';

export const initAdminDashboard = () => initOperationsDashboard('admin');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAdminDashboard, { once: true });
} else {
  initAdminDashboard();
}
