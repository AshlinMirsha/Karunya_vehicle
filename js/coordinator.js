import { supabase } from '../supabase/client.js';
import { renderNavbar } from '../components/navbar.js';
import { showToast } from '../components/toast.js';

const addBusOption = (select, bus) => {
  const option = document.createElement('option');
  option.value = bus.id;
  option.textContent = `Bus ${bus.bus_number} - ${bus.route}`;
  select.append(option);
};

export async function initCoordinatorDashboard() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return location.replace('/');
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!['admin', 'coordinator'].includes(profile?.role)) return location.replace('/student');
  renderNavbar(user, 'Coordinator');

  const { data: buses, error } = await supabase.from('buses').select('id,bus_number,route');
  const select = document.getElementById('select-bus');
  select.replaceChildren();
  if (error || !buses?.length) {
    showToast('No buses are available for QR generation.', 'danger');
    return;
  }
  buses.forEach((bus) => addBusOption(select, bus));

  document.getElementById('btn-generate-qr').onclick = async () => {
    const sessionType = document.getElementById('select-session').value;
    const { data, error: invokeError } = await supabase.functions.invoke('attendance-api', {
      body: { action: 'create-session', busId: select.value, sessionType },
    });
    if (invokeError || !data?.token || !data?.expiresAt) return showToast('QR session could not be created.', 'danger');
    const checkinUrl = `${location.origin}/checkin?token=${encodeURIComponent(data.token)}`;
    const display = document.getElementById('qr-code-display');
    display.replaceChildren();
    new window.QRCode(display, { text: checkinUrl, width: 220, height: 220 });
    document.getElementById('qr-url-text').textContent = `Expires ${new Date(data.expiresAt).toLocaleTimeString('en-IN')}`;
    showToast('QR session created.', 'success');
  };
}
