import { supabase } from '../supabase/client.js';

const uniqueIds = (values) => [...new Set(values.filter(Boolean))];

export async function loadAttendanceDetails(attendanceRecords) {
  const sessionIds = uniqueIds(attendanceRecords.map((record) => record.session_id));
  if (!sessionIds.length) return { records: attendanceRecords, error: null };

  const { data: sessions, error: sessionsError } = await supabase
    .from('attendance_sessions')
    .select('id,session_type,bus_id')
    .in('id', sessionIds);
  if (sessionsError) return { records: attendanceRecords, error: sessionsError };

  const busIds = uniqueIds((sessions ?? []).map((session) => session.bus_id));
  const { data: buses, error: busesError } = busIds.length
    ? await supabase.from('buses').select('id,bus_number').in('id', busIds)
    : { data: [], error: null };
  if (busesError) return { records: attendanceRecords, error: busesError };

  const sessionsById = new Map((sessions ?? []).map((session) => [session.id, session]));
  const busesById = new Map((buses ?? []).map((bus) => [bus.id, bus]));
  return {
    records: attendanceRecords.map((record) => {
      const session = sessionsById.get(record.session_id);
      return { ...record, session, bus: session ? busesById.get(session.bus_id) : null };
    }),
    error: null,
  };
}
