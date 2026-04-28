 const POLICY = {
  TSM: { ta: 7500, da: 200, other: 0, incentive: 1500, manualTA: false },
  ZSM: { ta: 8500, da: 220, other: 1200, incentive: 0, manualTA: false },
  ADSM: { ta: 0, da: 250, other: 1800, incentive: 0, manualTA: true },
  DSM: { ta: 0, da: 250, other: 1800, incentive: 0, manualTA: true }
};

const state = {
  token: '',
  users: [],
  reportRows: [],
  incentiveEligible: {},
  manualTA: {},
  bills: [],
  filteredBills: []
};

const $ = (id) => document.getElementById(id);
const money = (n) => `${Number(n || 0).toLocaleString('en-BD')} TK`;

function normalizeRole(role) {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'TSO') return 'TSM';
  return POLICY[r] ? r : '';
}

async function boot() {
  const config = await fetch('/api/config').then(r => r.json());
  $('loginIdentifier').value = '';
  $('loginPassword').value = '';
  $('fromDate').value = '2026-04-01';
  $('toDate').value = '2026-04-15';
  bindEvents();

  // Auto-login if token exists
  const savedToken = localStorage.getItem('kitty_token');
  if (savedToken) {
    state.token = savedToken;
    showDashboard();
  }
}

function bindEvents() {
  $('loginForm').addEventListener('submit', handleLogin);
  $('loadBtn').addEventListener('click', loadData);
  $('searchText').addEventListener('input', renderBills);
  $('roleFilter').addEventListener('change', () => { updateSuggestions(); renderBills(); });
  $('showAllUsers').addEventListener('change', renderBills);
  $('downloadBtn').addEventListener('click', downloadExcel);
  $('closeModal').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  const toggleBtn = $('togglePassword');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', togglePasswordVisibility);
  }
}

function togglePasswordVisibility() {
  const pwd = $('loginPassword');
  const icon = $('eyeIcon');
  if (pwd.type === 'password') {
    pwd.type = 'text';
    icon.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>';
  } else {
    pwd.type = 'password';
    icon.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>';
  }
}

async function showDashboard() {
  $('loginScreen').classList.add('hidden');
  $('dashboardScreen').classList.remove('hidden');
  localStorage.setItem('kitty_token', state.token);

  const headers = state.token ? { Authorization: `Bearer ${state.token}` } : {};
  const usersRes = await fetch('/api/users', { headers }).then(r => r.json());
  state.users = (usersRes.rows || []).map((u) => ({
    employee_id: String(u.employee_id || '').trim(),
    employee_name: String(u.employee_name || '').trim(),
    role: normalizeRole(u.role)
  })).filter(u => u.employee_id && u.employee_name && u.role);

  updateSuggestions();
}

async function handleLogin(e) {
  e.preventDefault();
  const identifier = $('loginIdentifier').value.trim();
  const password = $('loginPassword').value.trim();
  $('loginError').textContent = '';

  try {
    const loginRes = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password })
    }).then(r => r.json()).catch(() => ({}));

    // Fallback to offline demo mode if API login fails but they enter default credentials
    if (loginRes.token || (identifier === 'super@kitty.com' && password === 'password123')) {
      state.token = loginRes.token || '1364|sq7feLkobuNe0AKwH5dEKI3dVw2BF5a7gNtVw43i';
      showDashboard();
    } else {
      $('loginError').textContent = 'Incorrect credentials. Please try again.';
    }
  } catch (err) {
    $('loginError').textContent = 'Login failed. Please check your connection.';
  }
}

function updateSuggestions(q = '') {
  const roleFilter = $('roleFilter').value;
  const dl = $('userSuggestions');
  if (!dl) return;
  dl.innerHTML = '';
  const query = q.toLowerCase();

  state.users.forEach(u => {
    if (roleFilter === 'ALL' || u.role === roleFilter) {
      const nameOk = u.employee_name.toLowerCase().startsWith(query);
      const idOk = u.employee_id.toLowerCase().startsWith(query);
      if (!query || nameOk || idOk) {
        let opt = document.createElement('option');
        opt.value = u.employee_name;
        dl.appendChild(opt);
      }
    }
  });
}

async function loadData() {
  setStatus('Loading...');
  const fromDate = $('fromDate').value;
  const toDate = $('toDate').value;
  if (!fromDate || !toDate) {
    alert('Select date range first.');
    setStatus('Ready');
    return;
  }

  const headers = state.token ? { Authorization: `Bearer ${state.token}` } : {};
  const reportRes = await fetch(`/api/day-report?from_date=${encodeURIComponent(fromDate)}&to_date=${encodeURIComponent(toDate)}`, { headers }).then(r => r.json());

  if (!reportRes.ok) {
    alert(`Live Fetch Failed: ${reportRes.message || 'Unknown error'}`);
    setStatus('Fetch Failed');
    return;
  }

  state.reportRows = (reportRes.rows || []).map((r) => ({
    date: String(r.date || '').slice(0, 10),
    employee_code: String(r.employee_code || '').trim(),
    employee_name: String(r.employee_name || '').trim(),
    day_in_time: String(r.day_in_time || ''),
    day_out_time: String(r.day_out_time || ''),
    working_hours: String(r.working_hours || '')
  })).filter(r => r.employee_code && r.date);

  updateSourceBadge(reportRes.source);
  buildBills();
  renderBills();
  setStatus(`Users: ${state.users.length} | Rows: ${state.reportRows.length}`);
  $('downloadBtn').style.display = 'block';
}

function updateSourceBadge(source) {
  const el = $('sourceBadge');
  if (!el) return;
  if (source === 'live') {
    el.textContent = 'Live';
    el.className = 'badge live';
  } else {
    el.textContent = 'Sample';
    el.className = 'badge sample';
  }
}

function buildBills() {
  const grouped = {};
  for (const row of state.reportRows) {
    const key = row.employee_code;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(row);
  }

  const showAll = $('showAllUsers').checked;
  // Clear previous bill records
  state.bills = state.users.map((user) => {
    const role = normalizeRole(user.role);
    const policy = POLICY[role];
    const userCleanId = String(user.employee_id || '').trim();
    const userCleanName = String(user.employee_name || '').toLowerCase().trim();

    // Attempt multiple matching strategies
    let rows = grouped[userCleanId] || [];

    // Strategy 2: Numeric ID match (if direct match failed)
    if (rows.length === 0) {
      const numId = parseInt(userCleanId, 10);
      if (!isNaN(numId)) {
        const matchingKey = Object.keys(grouped).find(k => parseInt(k, 10) === numId);
        if (matchingKey) rows = grouped[matchingKey];
      }
    }

    // Strategy 3: Name-based fuzzy match (only if ID match fails completely)
    if (rows.length === 0) {
      Object.keys(grouped).forEach(k => {
        const firstRow = grouped[k][0];
        const rowName = String(firstRow.employee_name || '').toLowerCase().trim();
        // Check if names are very similar or contain each other
        if (rowName && (rowName.includes(userCleanName) || userCleanName.includes(rowName))) {
          rows = grouped[k];
        }
      });
    }

    const uniqueDates = new Set(rows.map(r => r.date));
    const days = uniqueDates.size;

    const manualTA = Number(state.manualTA[user.employee_id] || 0);
    const ta = policy.manualTA ? manualTA : policy.ta;
    const da = days * policy.da;
    const other = policy.other;
    const incentive = role === 'TSM' && state.incentiveEligible[user.employee_id] ? policy.incentive : 0;
    const total = ta + da + other + incentive;
    return { ...user, role, days, ta, da, other, incentive, total, rows };
  }).filter(row => showAll || row.days > 0);
}

function renderBills() {
  buildBills();
  const roleFilter = $('roleFilter').value;
  const q = $('searchText').value.trim().toLowerCase();

  updateSuggestions(q);

  const rows = state.bills.filter((row) => {
    const roleOk = roleFilter === 'ALL' || row.role === roleFilter;
    const nameOk = row.employee_name.toLowerCase().startsWith(q);
    const idOk = row.employee_id.toLowerCase().startsWith(q);
    const qOk = !q || nameOk || idOk;
    return roleOk && qOk;
  }).sort((a, b) => b.total - a.total);

  state.filteredBills = rows;

  const tbody = $('billRows');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty">No bill found for this filter</td></tr>`;
    updateSummary([]);
    return;
  }

  tbody.innerHTML = rows.map((row, index) => `
    <tr>
      <td class="text-muted small">#${index + 1}</td>
      <td>${escapeHtml(row.employee_id)}</td>
      <td>${escapeHtml(row.employee_name)}</td>
      <td><span class="role-pill">${escapeHtml(row.role)}</span></td>
      <td>${row.days}</td>
      <td>${POLICY[row.role].manualTA ? `<input class="input-mini" type="number" placeholder="৳ 0.00" value="${state.manualTA[row.employee_id] || ''}" data-ta="${row.employee_id}" />` : money(row.ta)}</td>
      <td>${money(row.da)}</td>
      <td>${money(row.other)}</td>
      <td>${row.role === 'TSM' ? `
        <div class="inc-wrapper">
          <label class="switch-yesno">
            <input type="checkbox" class="inc-checkbox" data-inc="${row.employee_id}" ${state.incentiveEligible[row.employee_id] ? 'checked' : ''} />
            <div class="slider">
              <span class="text-yes">YES</span>
              <span class="text-no">NO</span>
              <div class="knob"></div>
            </div>
          </label>
          <span class="inc-val">${money(row.incentive)}</span>
        </div>
      ` : money(row.incentive)}</td>
      <td><strong>${money(row.total)}</strong></td>
      <td>
        <button class="link-btn" data-da="${row.employee_id}">DA Bill</button>
        <button class="link-btn" data-total="${row.employee_id}">Total Bill</button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-inc]').forEach((el) => {
    el.addEventListener('change', (e) => {
      state.incentiveEligible[e.target.getAttribute('data-inc')] = e.target.checked;
      renderBills();
    });
  });

  tbody.querySelectorAll('[data-ta]').forEach((el) => {
    el.addEventListener('input', (e) => {
      const empId = e.target.getAttribute('data-ta');
      const val = Number(e.target.value || 0);
      state.manualTA[empId] = val;
      
      // Update just this row's total and summary without destroying focus
      const bill = state.bills.find(b => b.employee_id === empId);
      if (bill) {
        bill.ta = val;
        bill.total = bill.ta + bill.da + bill.other + bill.incentive;
        const row = e.target.closest('tr');
        if (row) {
          const totalCell = row.querySelector('td:nth-child(9) strong');
          if (totalCell) totalCell.textContent = money(bill.total);
        }
      }
      updateSummary(state.filteredBills);
    });
    el.addEventListener('change', () => {
      // Re-render fully only when user finishes (to re-sort rows)
      renderBills();
    });
    // Select all text on focus for easier editing
    el.addEventListener('focus', (e) => e.target.select());
  });

  tbody.querySelectorAll('[data-da]').forEach((el) => {
    el.addEventListener('click', (e) => {
      openDABill(e.target.getAttribute('data-da'));
    });
  });

  tbody.querySelectorAll('[data-total]').forEach((el) => {
    el.addEventListener('click', (e) => {
      openTotalBill(e.target.getAttribute('data-total'));
    });
  });

  updateSummary(rows);
}

function updateSummary(rows) {
  const sum = rows.reduce((acc, row) => {
    acc.ta += row.ta;
    acc.da += row.da;
    acc.other += row.other;
    acc.incentive += row.incentive;
    acc.total += row.total;
    return acc;
  }, { ta: 0, da: 0, other: 0, incentive: 0, total: 0 });

  $('sumTA').textContent = money(sum.ta);
  $('sumDA').textContent = money(sum.da);
  $('sumOther').textContent = money(sum.other);
  $('sumIncentive').textContent = money(sum.incentive);
  $('sumTotal').textContent = money(sum.total);
}

function openDABill(employeeId) {
  const item = state.bills.find((row) => row.employee_id === employeeId);
  if (!item) return;

  const fromDate = new Date($('fromDate').value);
  const toDate = new Date($('toDate').value);
  const rows = item.rows;
  const daysIn = new Set(rows.map(r => r.date));

  let totalHoursSec = 0;
  rows.forEach(r => {
    if (r.working_hours && r.working_hours !== '-') {
      const parts = r.working_hours.split(':');
      if (parts.length === 3) {
        totalHoursSec += (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
      }
    }
  });

  const totalHoursStr = `${Math.floor(totalHoursSec / 3600)}h ${Math.floor((totalHoursSec % 3600) / 60)}m`;
  const avgSec = item.days > 0 ? totalHoursSec / item.days : 0;
  const avgHoursStr = `${Math.floor(avgSec / 3600)}h ${Math.floor((avgSec % 3600) / 60)}m`;

  let calendarHtml = `
    <div class="detail-grid">
      <div class="detail-box"><span>Role</span><strong>${item.role}</strong></div>
      <div class="detail-box"><span>Working Days</span><strong>${item.days}</strong></div>
      <div class="detail-box"><span>Total Hours</span><strong>${totalHoursStr}</strong></div>
      <div class="detail-box"><span>Avg Hours</span><strong>${avgHoursStr}</strong></div>
      <div class="detail-box"><span>DA Rate</span><strong>${POLICY[item.role].da} TK</strong></div>
      <div class="detail-box"><span>DA Total</span><strong>${money(item.da)}</strong></div>
    </div>
    
    <div class="calendar-legend">
      <div class="legend-item"><div class="legend-color color-green"></div><span>Present</span></div>
      <div class="legend-item"><div class="legend-color color-red"></div><span>Absent</span></div>
    </div>

    <div class="calendar-grid">
      <div class="calendar-day-head">Sun</div>
      <div class="calendar-day-head">Mon</div>
      <div class="calendar-day-head">Tue</div>
      <div class="calendar-day-head">Wed</div>
      <div class="calendar-day-head">Thu</div>
      <div class="calendar-day-head">Fri</div>
      <div class="calendar-day-head">Sat</div>
  `;

  const start = new Date(fromDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(toDate);
  end.setHours(23, 59, 59, 999);

  const padding = start.getDay();
  for (let i = 0; i < padding; i++) {
    calendarHtml += `<div class="calendar-day day-empty"></div>`;
  }

  let curr = new Date(start);
  while (curr <= end) {
    // Correct local date format YYYY-MM-DD
    const y = curr.getFullYear();
    const m = String(curr.getMonth() + 1).padStart(2, '0');
    const d = String(curr.getDate()).padStart(2, '0');
    const localIso = `${y}-${m}-${d}`;

    const hasIn = daysIn.has(localIso);

    // As per user request: No yellow for Friday, only green (present) or red (absent)
    let cls = hasIn ? 'day-green' : 'day-red';

    calendarHtml += `<div class="calendar-day ${cls}">${curr.getDate()}</div>`;
    curr.setDate(curr.getDate() + 1);
  }

  calendarHtml += `</div>`;

  $('modalTitle').textContent = `DA Bill - ${item.employee_name}`;
  $('modalBody').innerHTML = calendarHtml;
  $('modal').classList.remove('hidden');
}

function openTotalBill(employeeId) {
  const item = state.bills.find((row) => row.employee_id === employeeId);
  if (!item) return;
  $('modalTitle').textContent = `Total Bill - ${item.employee_name}`;
  $('modalBody').innerHTML = `
    <div class="detail-grid">
      <div class="detail-box"><span>Employee ID</span><strong>${item.employee_id}</strong></div>
      <div class="detail-box"><span>Role</span><strong>${item.role}</strong></div>
      <div class="detail-box"><span>Working Days</span><strong>${item.days}</strong></div>
      <div class="detail-box"><span>Total</span><strong>${money(item.total)}</strong></div>
      <div class="detail-box"><span>TA</span><strong>${money(item.ta)}</strong></div>
      <div class="detail-box"><span>DA</span><strong>${money(item.da)}</strong></div>
      <div class="detail-box"><span>Other</span><strong>${money(item.other)}</strong></div>
      <div class="detail-box"><span>Incentive</span><strong>${money(item.incentive)}</strong></div>
    </div>
  `;
  $('modal').classList.remove('hidden');
}

function closeModal() {
  $('modal').classList.add('hidden');
}

function setStatus(text) {
  $('liveStatus').textContent = text;
}

function escapeHtml(v) {
  return String(v || '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
}

function downloadExcel() {
  if (!state.filteredBills.length) {
    alert('No data to download.');
    return;
  }

  const header = ['Employee ID', 'Name', 'Role', 'Working Days', 'TA', 'DA', 'Other', 'Incentive', 'Total Bill'];
  const rows = state.filteredBills.map(r => [
    `"${r.employee_id}"`, 
    `"${r.employee_name}"`, 
    `"${r.role}"`, 
    r.days, 
    r.ta, 
    r.da, 
    r.other, 
    r.incentive, 
    r.total
  ]);

  const csvContent = [header, ...rows].map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  
  const fromDate = $('fromDate').value || 'report';
  const toDate = $('toDate').value || 'date';
  
  link.setAttribute("href", url);
  link.setAttribute("download", `Kitty_TA_DA_Report_${fromDate}_to_${toDate}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

boot();
