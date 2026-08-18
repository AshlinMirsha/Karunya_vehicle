/**
 * reports.js
 * Attendance report module — Date Range Report & Student Wise Report.
 * Reuses existing Supabase RPCs. No schema changes.
 */

import { supabase } from '../supabase/client.js';
import { showToast } from '../components/toast.js';

// ─── Shared Utilities ──────────────────────────────────────────────────────

const escHtml = (str) =>
  String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Convert a raw attendance status to the report display token.
 * PRESENT → 'P', anything else (ABSENT, null) → 'AB'.
 */
const toToken = (status) => (status === 'PRESENT' ? 'P' : 'AB');

/** Format YYYY-MM-DD → "01-Aug" — uses local Date constructor to avoid UTC shift. */
const fmtShort = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

/** Format YYYY-MM-DD → "01-Aug-2026" — uses local Date constructor to avoid UTC shift. */
const fmtLong = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/** Pad a number to 2 digits. */
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Generate every YYYY-MM-DD string from start to end (inclusive).
 * Uses local Date parts — NOT toISOString() — to avoid UTC/IST timezone shift.
 * Root-cause note: new Date('YYYY-MM-DDT00:00:00') in IST (UTC+5:30) is
 * 18:30 of the PREVIOUS UTC day, so toISOString().slice(0,10) would return
 * yesterday's date. Using getFullYear/getMonth/getDate reads local calendar.
 */
const dateRange = (start, end) => {
  const dates = [];
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const cur = new Date(sy, sm - 1, sd);   // local midnight — no UTC conversion
  const last = new Date(ey, em - 1, ed);
  while (cur <= last) {
    // Bus does not operate on Sundays (getDay() === 0) — skip them
    if (cur.getDay() !== 0) {
      dates.push(`${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

/** IST-aware ISO strings for the RPC. */
const istFrom = (dateStr) => (dateStr ? `${dateStr}T00:00:00.000+05:30` : null);
const istTo = (dateStr) => (dateStr ? `${dateStr}T23:59:59.999+05:30` : null);

/** Inject or update a <style> tag that controls print orientation. */
let _orientEl = null;
const setPrintOrientation = (orientation /* 'landscape' | 'portrait' */) => {
  if (!_orientEl) {
    _orientEl = document.createElement('style');
    _orientEl.id = 'rpt-page-orientation';
    document.head.appendChild(_orientEl);
  }
  _orientEl.textContent =
    `@media print { @page { size: A4 ${orientation}; margin: 10mm; } }`;
};

/** Load SheetJS once, then return the XLSX global. */
const loadXLSX = () =>
  new Promise((resolve) => {
    if (window.XLSX) { resolve(window.XLSX); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });

// ─── Public Init ───────────────────────────────────────────────────────────

/**
 * Called from initOperationsDashboard() once the profile is known.
 * Wires up the Reports section UI that is already present in the HTML.
 */
export async function initReports(profile) {
  const section = document.getElementById('reports-section');
  if (!section) return; // section not in this page

  await _populateStudentSelect(profile);
  _wireTabButtons();
  _wireDateRangeReport(profile);
  _wireStudentWiseReport(profile);
}

// ─── Student Selector ──────────────────────────────────────────────────────

async function _populateStudentSelect(profile) {
  const sel = document.getElementById('rpt-student-select');
  if (!sel) return;

  sel.innerHTML = '<option value="">Loading students…</option>';

  try {
    const { data: students, error } = await supabase.rpc('authorized_student_records');
    if (error) throw error;

    const active = (students ?? []).filter(
      (s) => s.register_number && s.status !== 'awaiting first sign-in',
    );

    sel.innerHTML = '<option value="">— Select Student —</option>';
    active.forEach((s) => {
      const opt = document.createElement('option');
      opt.value = s.register_number;
      opt.dataset.name = s.full_name || '';
      opt.dataset.bus = s.bus_number || '';
      opt.textContent = `${s.register_number} — ${s.full_name || s.email}`;
      sel.appendChild(opt);
    });
  } catch (err) {
    sel.innerHTML = '<option value="">Failed to load students</option>';
    console.error('Report student select error:', err);
  }
}

// ─── Tab Navigation ────────────────────────────────────────────────────────

function _wireTabButtons() {
  const tabBtns = document.querySelectorAll('[data-rpt-tab]');
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.rptTab;
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('[data-rpt-pane]').forEach((pane) => {
        pane.hidden = pane.dataset.rptPane !== target;
      });
    });
  });
}

// ─── Feature 1: Date Range Report ─────────────────────────────────────────

function _wireDateRangeReport(profile) {
  const btn = document.getElementById('rpt-dr-generate');
  const pdfBtn = document.getElementById('rpt-dr-pdf');
  const xlsBtn = document.getElementById('rpt-dr-excel');
  if (!btn) return;

  btn.addEventListener('click', () => _runDateRangeReport(profile));
  pdfBtn?.addEventListener('click', () => {
    setPrintOrientation('landscape');
    document.body.classList.add('printing-report');
    // Ensure pane is visible (not hidden) so CSS shows it
    document.querySelector('[data-rpt-pane="date-range"]')?.removeAttribute('hidden');
    window.print();
    // Remove the class once the print dialog closes
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-report');
    }, { once: true });
  });
  xlsBtn?.addEventListener('click', () => _exportDateRangeExcel());
}

async function _runDateRangeReport(profile) {
  const startDate = document.getElementById('rpt-dr-start')?.value;
  const endDate = document.getElementById('rpt-dr-end')?.value;
  const busSelEl = document.getElementById('rpt-dr-bus');
  const busId = busSelEl?.value || null;
  const preview = document.getElementById('rpt-dr-preview');

  // --- Validation ---
  if (!startDate || !endDate) {
    return showToast('Please select both Start Date and End Date.', 'warning');
  }
  if (startDate > endDate) {
    return showToast('Start date cannot be after end date.', 'warning');
  }
  const days = (new Date(endDate) - new Date(startDate)) / 86400000;
  if (days > 183) {
    return showToast('Date range cannot exceed 6 months. Please narrow the range.', 'warning');
  }

  preview.innerHTML =
    '<p class="text-muted text-center py-4">⏳ Fetching attendance data…</p>';
  document.getElementById('rpt-dr-actions')?.setAttribute('hidden', '');

  try {
    // Fetch all students visible to the caller
    const { data: students, error: studErr } = await supabase.rpc('authorized_student_records');
    if (studErr) throw studErr;

    let active = (students ?? []).filter(
      (s) => s.register_number && s.status !== 'awaiting first sign-in',
    );
    // If a bus filter is selected, narrow to that bus
    if (busId && busSelEl) {
      const busLabel = busSelEl.options[busSelEl.selectedIndex]?.text || '';
      const busNum = busLabel.match(/Bus\s+(\S+)/i)?.[1] || '';
      if (busNum) active = active.filter((s) => s.bus_number === busNum);
    }

    // Fetch history for the date range
    const { data: history, error: histErr } = await supabase.rpc('authorized_attendance_history', {
      p_bus_id: busId || null,
      p_date_from: istFrom(startDate),
      p_date_to: istTo(endDate),
      p_status: null,
      p_search: null,
      p_day_type: null,
    });
    if (histErr) throw histErr;

    // Build lookup: "REG|YYYY-MM-DD" → history row
    const lookup = new Map();
    (history ?? []).forEach((row) => {
      if (row.register_number && row.session_date) {
        lookup.set(`${row.register_number}|${String(row.session_date).slice(0, 10)}`, row);
      }
    });

    // Store data for Excel export
    preview._reportData = { students: active, dates: dateRange(startDate, endDate), lookup, startDate, endDate };

    _renderDateRangeTable(preview, active, dateRange(startDate, endDate), lookup, startDate, endDate);
    document.getElementById('rpt-dr-actions')?.removeAttribute('hidden');

  } catch (err) {
    console.error('Date range report error:', err);
    preview.innerHTML =
      `<p class="text-danger text-center py-3">❌ Failed: ${escHtml(err.message || 'Unknown error')}</p>`;
    showToast('Report generation failed.', 'danger');
  }
}

function _renderDateRangeTable(container, students, dates, lookup, startDate, endDate) {
  if (!students.length) {
    container.innerHTML = '<p class="text-muted text-center py-3">No active students found.</p>';
    return;
  }

  const DATES_PER_PAGE = 15;
  const periodLabel = `Period: ${fmtLong(startDate)} to ${fmtLong(endDate)}`;

  /**
   * Build one table block for a slice of dates.
   * The header is repeated on every chunk so every printed page is self-contained.
   */
  const buildChunk = (chunkDates, isFirst) => {
    const headerCells = chunkDates
      .map((d) => `<th colspan="2" class="text-center rpt-date-group">${fmtShort(d)}</th>`)
      .join('');

    const subHeaders = chunkDates
      .flatMap(() => [
        '<th class="text-center rpt-sub">Mor</th>',
        '<th class="text-center rpt-sub">Eve</th>',
      ])
      .join('');

    const bodyRows = students
      .map((st) => {
        const dateCells = chunkDates
          .flatMap((d) => {
            const row = lookup.get(`${st.register_number}|${d}`);
            const mor = toToken(row?.morning_status ?? null);
            const eve = toToken(row?.evening_status ?? null);
            return [
              `<td class="text-center ${mor === 'P' ? 'rpt-p' : 'rpt-ab'}">${mor}</td>`,
              `<td class="text-center ${eve === 'P' ? 'rpt-p' : 'rpt-ab'}">${eve}</td>`,
            ];
          })
          .join('');

        return `<tr>
          <td class="rpt-name">${escHtml(st.full_name || '—')}</td>
          <td class="rpt-reg">${escHtml(st.register_number || '—')}</td>
          <td class="rpt-bp">—</td>
          ${dateCells}
        </tr>`;
      })
      .join('');

    return `
      <div class="rpt-page-chunk${isFirst ? '' : ' rpt-page-break'}">
        <div class="rpt-print-header mb-3">
          <h3 class="mb-0">Karunya Institute of Technology and Sciences</h3>
          <p class="mb-0 fw-semibold">Official Bus Attendance Report — Date Range</p>
          <p class="mb-0 text-muted small">${periodLabel}</p>
        </div>
        <div class="table-responsive rpt-scroll">
          <table class="table table-bordered rpt-table">
            <thead>
              <tr class="rpt-header-row">
                <th rowspan="2" class="rpt-fixed-col">Name</th>
                <th rowspan="2" class="rpt-fixed-col">Reg No</th>
                <th rowspan="2" class="rpt-fixed-col">Boarding Point</th>
                ${headerCells}
              </tr>
              <tr class="rpt-sub-row">${subHeaders}</tr>
            </thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>
      </div>
    `;
  };

  // Split dates into chunks of DATES_PER_PAGE
  const chunks = [];
  for (let i = 0; i < dates.length; i += DATES_PER_PAGE) {
    chunks.push(dates.slice(i, i + DATES_PER_PAGE));
  }

  container.innerHTML = chunks
    .map((chunk, idx) => buildChunk(chunk, idx === 0))
    .join('');
}

async function _exportDateRangeExcel() {
  const preview = document.getElementById('rpt-dr-preview');
  const reportData = preview?._reportData;
  if (!reportData) {
    return showToast('Please generate the report first.', 'warning');
  }
  const { students, dates, lookup, startDate, endDate } = reportData;

  const XLSX = await loadXLSX();
  if (!XLSX) {
    return showToast('Excel library could not be loaded.', 'danger');
  }

  // Build header rows
  const header1 = ['Name', 'Reg No', 'Boarding Point'];
  const header2 = ['', '', ''];
  dates.forEach((d) => {
    header1.push(fmtShort(d), '');
    header2.push('Morning', 'Evening');
  });

  const rows = [
    [`Karunya Institute of Technology and Sciences`],
    [`Date Range Report: ${fmtLong(startDate)} to ${fmtLong(endDate)}`],
    [],
    header1,
    header2,
  ];

  students.forEach((st) => {
    const row = [st.full_name || '—', st.register_number || '—', '—'];
    dates.forEach((d) => {
      const hist = lookup.get(`${st.register_number}|${d}`);
      row.push(toToken(hist?.morning_status ?? null));
      row.push(toToken(hist?.evening_status ?? null));
    });
    rows.push(row);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Merge date header cells across 2 columns
  ws['!merges'] = [];
  // Title merges
  ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: header1.length - 1 } });
  ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: header1.length - 1 } });
  dates.forEach((_, i) => {
    const col = 3 + i * 2;
    ws['!merges'].push({ s: { r: 3, c: col }, e: { r: 3, c: col + 1 } });
  });

  const colWidths = [{ wch: 28 }, { wch: 16 }, { wch: 18 }];
  dates.forEach(() => { colWidths.push({ wch: 9 }, { wch: 9 }); });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'Date Range Report');
  XLSX.writeFile(wb, `Karunya_DateRange_Report_${startDate}_to_${endDate}.xlsx`);
  showToast('Excel report downloaded.', 'success');
}

// ─── Feature 2: Student Wise Report ───────────────────────────────────────

function _wireStudentWiseReport(profile) {
  const btn = document.getElementById('rpt-sw-generate');
  const pdfBtn = document.getElementById('rpt-sw-pdf');
  const xlsBtn = document.getElementById('rpt-sw-excel');
  if (!btn) return;

  btn.addEventListener('click', () => _runStudentWiseReport(profile));
  pdfBtn?.addEventListener('click', () => {
    setPrintOrientation('landscape');
    document.body.classList.add('printing-report');
    // Ensure pane is visible
    document.querySelector('[data-rpt-pane="student-wise"]')?.removeAttribute('hidden');
    window.print();
    window.addEventListener('afterprint', () => {
      document.body.classList.remove('printing-report');
      // Restore hidden state based on which tab is active
      const activeTab = document.querySelector('.rpt-tab-btn.active');
      const activePane = activeTab?.dataset?.rptTab;
      document.querySelectorAll('[data-rpt-pane]').forEach(p => {
        if (p.dataset.rptPane !== activePane) p.setAttribute('hidden', '');
        else p.removeAttribute('hidden');
      });
    }, { once: true });
  });
  xlsBtn?.addEventListener('click', () => _exportStudentWiseExcel());
}

async function _runStudentWiseReport(profile) {
  const selEl = document.getElementById('rpt-student-select');
  const studentReg = selEl?.value?.trim();
  const studentName = selEl?.options[selEl.selectedIndex]?.dataset?.name || studentReg;
  const startDate = document.getElementById('rpt-sw-start')?.value;
  const endDate = document.getElementById('rpt-sw-end')?.value;
  const preview = document.getElementById('rpt-sw-preview');

  // --- Validation ---
  if (!studentReg) {
    return showToast('Please select a student.', 'warning');
  }
  if (!startDate || !endDate) {
    return showToast('Please select both Start Date and End Date.', 'warning');
  }
  if (startDate > endDate) {
    return showToast('Start date cannot be after end date.', 'warning');
  }

  preview.innerHTML =
    '<p class="text-muted text-center py-4">⏳ Fetching student attendance…</p>';
  document.getElementById('rpt-sw-actions')?.setAttribute('hidden', '');

  try {
    const busId = profile?.role === 'coordinator' ? profile.bus_id : null;

    const { data: history, error } = await supabase.rpc('authorized_attendance_history', {
      p_bus_id: busId,
      p_date_from: istFrom(startDate),
      p_date_to: istTo(endDate),
      p_status: null,
      p_search: studentReg,
      p_day_type: null,
    });
    if (error) throw error;

    // Filter strictly to this student's register number, excluding Sundays
    const rows = (history ?? []).filter((r) => {
      if (r.register_number?.toUpperCase() !== studentReg.toUpperCase()) return false;
      // Bus does not operate on Sundays — exclude any Sunday sessions
      const [y, mo, d] = String(r.session_date).slice(0, 10).split('-').map(Number);
      return new Date(y, mo - 1, d).getDay() !== 0;
    });

    // Sort ascending by date
    rows.sort((a, b) => String(a.session_date).localeCompare(String(b.session_date)));

    // Store for Excel export
    preview._reportData = { rows, studentReg, studentName, startDate, endDate };

    _renderStudentWiseTable(preview, rows, { studentReg, studentName, startDate, endDate });
    document.getElementById('rpt-sw-actions')?.removeAttribute('hidden');

  } catch (err) {
    console.error('Student wise report error:', err);
    preview.innerHTML =
      `<p class="text-danger text-center py-3">❌ Failed: ${escHtml(err.message || 'Unknown error')}</p>`;
    showToast('Report generation failed.', 'danger');
  }
}

function _renderStudentWiseTable(container, rows, { studentReg, studentName, startDate, endDate }) {

  // ── Monthly percentage calculation ───────────────────────────────────────
  // Only count dates where a session actually existed (status !== null).
  // Morning % and Evening % are calculated INDEPENDENTLY.
  const monthly = {}; // 'YYYY-MM' → { mPres, mTotal, ePres, eTotal }
  rows.forEach((row) => {
    const mk = String(row.session_date).slice(0, 7);
    if (!monthly[mk]) monthly[mk] = { mPres: 0, mTotal: 0, ePres: 0, eTotal: 0 };
    const m = monthly[mk];
    if (row.morning_status !== null && row.morning_status !== undefined) {
      m.mTotal++;
      if (row.morning_status === 'PRESENT') m.mPres++;
    }
    if (row.evening_status !== null && row.evening_status !== undefined) {
      m.eTotal++;
      if (row.evening_status === 'PRESENT') m.ePres++;
    }
  });

  // ── Date-wise rows ────────────────────────────────────────────────────────
  const dateRows = rows.length
    ? rows
      .map((row) => {
        const dateStr = String(row.session_date).slice(0, 10);
        const mor = toToken(row.morning_status);
        const eve = toToken(row.evening_status);
        return `<tr>
            <td>${fmtLong(dateStr)}</td>
            <td class="text-center fw-bold ${mor === 'P' ? 'rpt-p' : 'rpt-ab'}">${mor}</td>
            <td class="text-center fw-bold ${eve === 'P' ? 'rpt-p' : 'rpt-ab'}">${eve}</td>
          </tr>`;
      })
      .join('')
    : '<tr><td colspan="3" class="text-center text-muted py-3">No attendance sessions found in this period.</td></tr>';

  // ── Monthly summary rows ──────────────────────────────────────────────────
  const monthRows = Object.entries(monthly).length
    ? Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mk, m]) => {
        const mPct = m.mTotal > 0 ? ((m.mPres / m.mTotal) * 100).toFixed(2) + '%' : '—';
        const ePct = m.eTotal > 0 ? ((m.ePres / m.eTotal) * 100).toFixed(2) + '%' : '—';
        const label = new Date(mk + '-01').toLocaleDateString('en-IN', {
          month: 'long',
          year: 'numeric',
        });
        return `<tr>
            <td>${label}</td>
            <td class="text-end fw-bold">${mPct}</td>
            <td class="text-end fw-bold">${ePct}</td>
          </tr>`;
      })
      .join('')
    : '<tr><td colspan="3" class="text-center text-muted">No sessions in this period.</td></tr>';

  container.innerHTML = `
    <div class="rpt-print-header mb-3">
      <h3 class="mb-0">Karunya Institute of Technology and Sciences</h3>
      <p class="mb-0 fw-semibold">Student Attendance Report</p>
    </div>

    <div class="row g-3 mb-4">
      <!-- Student info -->
      <div class="col-md-5">
        <table class="table table-sm table-bordered rpt-table rpt-info-table">
          <thead>
            <tr><th colspan="2" class="text-center rpt-table-caption">Student Details</th></tr>
          </thead>
          <tbody>
            <tr><th>Name</th><td>${escHtml(studentName || studentReg)}</td></tr>
            <tr><th>Register No.</th><td>${escHtml(studentReg)}</td></tr>
            <tr><th>Period</th><td>${fmtLong(startDate)} – ${fmtLong(endDate)}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Monthly % -->
      <div class="col-md-7">
        <table class="table table-sm table-bordered rpt-table">
          <thead>
            <tr><th colspan="3" class="text-center rpt-table-caption">Attendance %</th></tr>
            <tr>
              <th>Month</th>
              <th class="text-end">Morning %</th>
              <th class="text-end">Evening %</th>
            </tr>
          </thead>
          <tbody>${monthRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Date-wise table -->
    <table class="table table-bordered rpt-table" id="rpt-sw-table">
      <thead>
        <tr><th colspan="3" class="text-center rpt-table-caption">Date-wise Attendance</th></tr>
        <tr>
          <th>Date</th>
          <th class="text-center">Morning</th>
          <th class="text-center">Evening</th>
        </tr>
      </thead>
      <tbody>${dateRows}</tbody>
    </table>
  `;
}

async function _exportStudentWiseExcel() {
  const preview = document.getElementById('rpt-sw-preview');
  const reportData = preview?._reportData;
  if (!reportData) {
    return showToast('Please generate the report first.', 'warning');
  }
  const { rows, studentReg, studentName, startDate, endDate } = reportData;

  const XLSX = await loadXLSX();
  if (!XLSX) return showToast('Excel library could not be loaded.', 'danger');

  // ── Sheet 1: Date-wise attendance ─────────────────────────────────────────
  const detailRows = [
    [`Student Attendance Report — ${studentName || studentReg} (${studentReg})`],
    [`Period: ${fmtLong(startDate)} to ${fmtLong(endDate)}`],
    [],
    ['Date', 'Morning', 'Evening'],
    ...rows.map((r) => {
      const dateStr = String(r.session_date).slice(0, 10);
      return [fmtLong(dateStr), toToken(r.morning_status), toToken(r.evening_status)];
    }),
  ];

  if (!rows.length) {
    detailRows.push(['No attendance sessions found in this period.']);
  }

  // ── Sheet 2: Monthly summary ──────────────────────────────────────────────
  const monthly = {};
  rows.forEach((row) => {
    const mk = String(row.session_date).slice(0, 7);
    if (!monthly[mk]) monthly[mk] = { mPres: 0, mTotal: 0, ePres: 0, eTotal: 0 };
    const m = monthly[mk];
    if (row.morning_status !== null && row.morning_status !== undefined) {
      m.mTotal++;
      if (row.morning_status === 'PRESENT') m.mPres++;
    }
    if (row.evening_status !== null && row.evening_status !== undefined) {
      m.eTotal++;
      if (row.evening_status === 'PRESENT') m.ePres++;
    }
  });

  const summaryRows = [
    ['Month', 'Morning %', 'Evening %'],
    ...Object.entries(monthly)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mk, m]) => {
        const mPct = m.mTotal > 0 ? `${((m.mPres / m.mTotal) * 100).toFixed(2)}%` : '—';
        const ePct = m.eTotal > 0 ? `${((m.ePres / m.eTotal) * 100).toFixed(2)}%` : '—';
        const label = new Date(mk + '-01').toLocaleDateString('en-IN', {
          month: 'long',
          year: 'numeric',
        });
        return [label, mPct, ePct];
      }),
  ];

  const wb = XLSX.utils.book_new();
  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsDetail['!cols'] = [{ wch: 18 }, { wch: 12 }, { wch: 12 }];
  wsSummary['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Attendance');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Monthly Summary');
  XLSX.writeFile(wb, `Karunya_Student_Report_${studentReg}_${startDate}_to_${endDate}.xlsx`);
  showToast('Excel report downloaded.', 'success');
}
