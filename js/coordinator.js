import { initOperationsDashboard } from './operations-dashboard.js';

export const initCoordinatorDashboard = () => initOperationsDashboard('coordinator');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCoordinatorDashboard, { once: true });
} else {
  initCoordinatorDashboard();
}
