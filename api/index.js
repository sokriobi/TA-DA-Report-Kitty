const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const XLSX = require('xlsx');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SAMPLE_USERS_PATH = path.join(__dirname, '..', 'public', 'data', 'users.sample.json');
const SAMPLE_REPORT_PATH = path.join(__dirname, '..', 'public', 'data', 'day-report.sample.json');

loadEnv(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT || 5500);
const LOGIN_API_URL = process.env.LOGIN_API_URL || 'https://kitty.report.sokrio.com/api/v1/login';
const USER_BULK_API_URL = process.env.USER_BULK_API_URL || 'https://kitty.report.sokrio.com/api/v1/user-bulk-download?&download';
const DAY_REPORT_API_URL = process.env.DAY_REPORT_API_URL || 'https://kitty.report.sokrio.com/api/v3/daily-attendance?territory_id=2&roles=9,3,4,6,7&download';
const DEFAULT_IDENTIFIER = process.env.DEFAULT_IDENTIFIER || 'super@kitty.com';
const DEFAULT_PASSWORD = process.env.DEFAULT_PASSWORD || 'password123';

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

function sendJson(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(data));
}

function sendText(res, code, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' });
  res.end(text);
}

function serveStatic(req, res, pathname) {
  const cleanPath = pathname === '/' ? '/login.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, path.normalize(cleanPath).replace(/^([.][.][/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, 'Not found');
    const ext = path.extname(filePath).toLowerCase();
    const type = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    }[ext] || 'application/octet-stream';
    sendText(res, 200, data, type);
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function requestJson(targetUrl, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    const req = transport.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          status: res.statusCode || 500,
          headers: res.headers,
          buffer,
          text: buffer.toString('utf8')
        });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseUserPayload(buffer, contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('application/json')) {
    const json = JSON.parse(buffer.toString('utf8'));
    const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    return normalizeUsers(rows);
  }
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return normalizeUsers(rows);
  } catch (e) {
    return null;
  }
}

function normalizeUsers(rows) {
  return rows.map((row) => ({
    employee_id: String(row['Employee ID'] ?? row.employee_id ?? row.employee_code ?? row.id ?? '').trim(),
    employee_name: String(row['Employee Name'] ?? row.employee_name ?? row.name ?? '').trim(),
    role: normalizeRole(String(row['Roles'] ?? row.roles ?? row.role ?? '').trim()),
    assigned_area: String(row['Assigned Area'] ?? row.assigned_area ?? '').trim(),
    status: String(row['Status'] ?? row.status ?? '').trim()
  })).filter(row => row.employee_id && row.employee_name && row.role);
}

function normalizeRole(role) {
  const r = String(role || '').trim().toUpperCase();
  if (r === 'TSO') return 'TSM';
  if (['TSM', 'ZSM', 'ADSM', 'DSM'].includes(r)) return r;
  return '';
}

function formatDate(val) {
  if (!val) return '';
  let d;
  if (val instanceof Date) {
    d = val;
  } else {
    // Try to detect DD/MM/YYYY format explicitly first
    const match = String(val).match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (match) {
      // Create date using local components to avoid interpretation issues
      d = new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
    } else {
      d = new Date(val);
    }
  }

  if (isNaN(d.getTime())) return '';

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeReportRows(rows) {
  return rows.map((row) => ({
    date: formatDate(row.date ?? row.Date ?? row.report_date ?? ''),
    employee_code: String(row.user_code ?? row.employee_code ?? row['Employee Code'] ?? row.employee_id ?? row.employee?.employee_id ?? '').trim(),
    employee_name: String(row.user_name ?? row.employee_name ?? row.Name ?? row.name ?? row.employee?.name ?? '').trim(),
    day_in_time: String(row.checkin_at ?? row.day_in_time ?? row.in_time ?? row['Day in Time'] ?? row['Day in Time '] ?? '').trim(),
    day_out_time: String(row.checkout_at ?? row.day_out_time ?? row.out_time ?? row['Day Out Time'] ?? row['Day Out Time '] ?? '').trim(),
    working_hours: String(row.working_hours ?? row.total_working_hours ?? row['Working Hours'] ?? '').trim()
  })).filter(row => row.employee_code && row.date && row.date.length === 10);
}

function filterByDate(rows, fromDate, toDate) {
  return rows.filter(row => {
    const d = row.date;
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function handleApi(req, res, pathname, query) {
  if (pathname === '/api/config') {
    return sendJson(res, 200, {
      ok: true,
      defaults: {
        identifier: DEFAULT_IDENTIFIER,
        password: DEFAULT_PASSWORD ? 'password123' : ''
      },
      endpoints: {
        login: LOGIN_API_URL,
        users: USER_BULK_API_URL,
        dayReportConfigured: Boolean(DAY_REPORT_API_URL)
      }
    });
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      console.log(`[LOGIN] Attempt for: ${body.identifier}`);
      const payload = JSON.stringify({
        identifier: body.identifier || DEFAULT_IDENTIFIER,
        password: body.password || DEFAULT_PASSWORD
      });
      const upstream = await requestJson(LOGIN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, payload);
      const json = JSON.parse(upstream.text || '{}');
      console.log(`[LOGIN] Upstream status: ${upstream.status}`);
      return sendJson(res, upstream.status, json);
    } catch (err) {
      console.error(`[LOGIN] Error: ${err.message}`);
      return sendJson(res, 500, { ok: false, message: 'Login failed', error: String(err.message || err) });
    }
  }

  if (pathname === '/api/users' && req.method === 'GET') {
    try {
      const token = req.headers.authorization || '';
      const upstream = await requestJson(USER_BULK_API_URL, {
        headers: token ? { Authorization: token } : {}
      });
      const parsed = parseUserPayload(upstream.buffer, upstream.headers['content-type']);
      if (parsed && parsed.length) {
        const jamalUser = parsed.filter(u => u.employee_name.toLowerCase().includes('jamal'));
        console.log(`Debug: Found ${jamalUser.length} Jamal(s) in User List.`);
        jamalUser.forEach(u => console.log(`- User List: ${u.employee_name} | ID: ${u.employee_id} | Role: ${u.role}`));
        return sendJson(res, 200, { ok: true, source: 'live', rows: parsed });
      }
      const sample = readJson(SAMPLE_USERS_PATH);
      return sendJson(res, 200, { ok: true, source: 'sample', rows: normalizeUsers(sample) });
    } catch (err) {
      const sample = readJson(SAMPLE_USERS_PATH);
      return sendJson(res, 200, { ok: true, source: 'sample', rows: normalizeUsers(sample), fallbackReason: String(err.message || err) });
    }
  }

  if (pathname === '/api/day-report' && req.method === 'GET') {
    const fromDate = String(query.from_date || '');
    const toDate = String(query.to_date || '');
    console.log(`[DATA] Request received. Range: ${fromDate} to ${toDate}`);
    
    try {
      if (DAY_REPORT_API_URL) {
        console.log(`[DATA] Using Live API: ${new URL(DAY_REPORT_API_URL).hostname}`);
        const target = new URL(DAY_REPORT_API_URL);

        if (target.pathname.includes('/daily-attendance')) {
          if (fromDate && toDate) {
            target.searchParams.set('range', `${fromDate},${toDate}`);
          }
        } else {
          if (fromDate) target.searchParams.set('from_date', fromDate);
          if (toDate) target.searchParams.set('to_date', toDate);
        }

        const token = req.headers.authorization || '';
        
        // Fetch first to see what we get (JSON or Excel)
        const firstRes = await requestJson(target.toString(), {
          headers: { 'Accept': 'application/json, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ...(token ? { Authorization: token } : {}) }
        });

        const contentType = String(firstRes.headers['content-type'] || '').toLowerCase();
        let allRows = [];

        if (contentType.includes('application/json')) {
          const firstPageJson = JSON.parse(firstRes.text || '{}');
          const extract = (json) => {
            return Array.isArray(json?.dailyAttendance) ? json.dailyAttendance :
              Array.isArray(json?.data) ? json.data :
                Array.isArray(json) ? json : [];
          };

          allRows = extract(firstPageJson);
          const lastPage = firstPageJson.last_page || 1;

          if (lastPage > 1) {
            console.log(`JSON Paged API. Total pages: ${lastPage}. Fetching remaining...`);
            const promises = [];
            for (let p = 2; p <= lastPage; p++) {
              const pUrl = new URL(target.toString());
              pUrl.searchParams.set('page', p);
              pUrl.searchParams.set('per_page', 100);
              promises.push(requestJson(pUrl.toString(), {
                headers: { 'Accept': 'application/json', ...(token ? { Authorization: token } : {}) }
              }).then(r => extract(JSON.parse(r.text || '{}'))));
            }
            const results = await Promise.all(promises);
            results.forEach(rows => { allRows = allRows.concat(rows); });
          }
        } else {
          // Assume Excel
          console.log('[DATA] Received Binary/Excel payload. Parsing...');
          const wb = XLSX.read(firstRes.buffer, { type: 'buffer', cellDates: true });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          let rows = XLSX.utils.sheet_to_json(sheet, { defval: '', header: 1 }); // Read as array of arrays first
          
          // Find the header row (the row that contains "Date" and "Employee")
          let headerIdx = rows.findIndex(r => 
            Array.isArray(r) && 
            r.some(cell => String(cell).toLowerCase().includes('date')) &&
            r.some(cell => String(cell).toLowerCase().includes('employee'))
          );
          
          if (headerIdx === -1) headerIdx = 0; // Fallback to first row
          
          console.log(`[DATA] Detected Header at Row: ${headerIdx + 1}`);
          
          // Re-parse with the correct header row
          allRows = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerIdx, cellDates: true });
          console.log(`[DATA] Excel parsed. Total rows: ${allRows.length}`);
          if (allRows.length > 0) {
            console.log('[DEBUG] Real Headers Found:', Object.keys(allRows[0]));
          }
        }

        const normalized = normalizeReportRows(allRows);
        return sendJson(res, 200, { ok: true, source: 'live', rows: normalized });
      } else {
        console.warn('[DATA] DAY_REPORT_API_URL is NOT set in Environment Variables.');
      }
      
      console.log('Using sample report data (fallback)...');
      const sample = readJson(SAMPLE_REPORT_PATH);
      const rows = Array.isArray(sample?.data) ? sample.data : Array.isArray(sample) ? sample : [];
      let normalized = normalizeReportRows(rows);
      if (fromDate || toDate) {
        normalized = filterByDate(normalized, fromDate, toDate);
      }
      return sendJson(res, 200, { ok: true, source: 'sample', rows: normalized });
    } catch (err) {
      console.error('CRITICAL: Fetch Failed!', err);
      return sendJson(res, 500, { ok: false, message: 'Fetch failed', error: String(err.message || err) });
    }
  }

  return sendJson(res, 404, { ok: false, message: 'API route not found' });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    return handleApi(req, res, pathname, parsed.query || {});
  }

  return serveStatic(req, res, pathname);
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Kitty TA/DA running at http://localhost:${PORT}/login.html`);
  });
}

module.exports = server;
