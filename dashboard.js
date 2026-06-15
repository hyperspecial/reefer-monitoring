/**
 * Reefer Monitoring System — Fleet Dashboard with Persistent Alert History
 * Persistence: atomic JSON file (reefer_alerts.json) — survives restarts.
 * API:  GET /api/fleet          — live fleet snapshot
 *       GET /api/alerts         — full history (?page=N&limit=N&container=ID)
 */

const http       = require('http');
const fs         = require('fs');
const path       = require('path');
const EventEmitter = require('events');

// ─── Fleet Definition ─────────────────────────────────────────────────────────

const FLEET_CFG = [
    { id: 'MSC-IOT-101', cargo: 'Fresh Produce',   icon: '🥦', tempMin: 2,  tempMax: 6,  threshold: 5.5, intervalMs: 2000 },
    { id: 'MSC-IOT-202', cargo: 'Dairy',            icon: '🧀', tempMin: 1,  tempMax: 6,  threshold: 5.0, intervalMs: 2500 },
    { id: 'MSC-IOT-303', cargo: 'Frozen Seafood',   icon: '🐟', tempMin: -2, tempMax: 3,  threshold: 2.0, intervalMs: 3000 },
    { id: 'MSC-IOT-404', cargo: 'Pharmaceuticals',  icon: '💊', tempMin: 3,  tempMax: 8,  threshold: 6.0, intervalMs: 2000 },
    { id: 'MSC-IOT-505', cargo: 'Beverages',        icon: '🍺', tempMin: 4,  tempMax: 9,  threshold: 7.5, intervalMs: 3500 },
    { id: 'MSC-IOT-606', cargo: 'Meat & Poultry',   icon: '🥩', tempMin: -1, tempMax: 4,  threshold: 3.5, intervalMs: 2800 },
];

// ─── Persistent Alert Store ────────────────────────────────────────────────────
// Alerts are written atomically to reefer_alerts.json (max 1000 records).
// On restart the full history is loaded back into memory.

const ALERTS_FILE = path.join(__dirname, 'reefer_alerts.json');
const MAX_STORED  = 1000;

function loadPersistedAlerts() {
    try {
        if (!fs.existsSync(ALERTS_FILE)) return { records: [], totalEver: 0 };
        const raw = fs.readFileSync(ALERTS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.warn('[DB] Could not load alert history:', e.message);
        return { records: [], totalEver: 0 };
    }
}

function persistAlert(entry) {
    try {
        db.records.unshift(entry);
        if (db.records.length > MAX_STORED) db.records.length = MAX_STORED;
        db.totalEver++;
        db.lastUpdated = new Date().toISOString();
        // atomic write: tmp → rename
        const tmp = ALERTS_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
        fs.renameSync(tmp, ALERTS_FILE);
    } catch (e) {
        console.warn('[DB] Could not persist alert:', e.message);
    }
}

// Load on startup
const db = loadPersistedAlerts();
const persistedCount = db.records.length;
console.log(`[DB] Loaded ${persistedCount} persisted alert(s) from history.`);

// ─── Reefer IoT Core ──────────────────────────────────────────────────────────

class ReeferIoT extends EventEmitter {
    constructor(cfg) {
        super();
        Object.assign(this, cfg);
        this.active = true;
    }
    sendTelemetry() {
        if (!this.active) return;
        const data = {
            id:          this.id,
            cargo:       this.cargo,
            icon:        this.icon,
            threshold:   this.threshold,
            timestamp:   new Date().toISOString(),
            temperature: parseFloat((Math.random() * (this.tempMax - this.tempMin) + this.tempMin).toFixed(2)),
            humidity:    parseFloat((Math.random() * 20 + 70).toFixed(2)),
            gps: {
                lat: parseFloat((Math.random() * 180 - 90).toFixed(4)),
                lng: parseFloat((Math.random() * 360 - 180).toFixed(4))
            }
        };
        this.emit('telemetry', data);
        return data;
    }
}

// ─── Runtime State ────────────────────────────────────────────────────────────

const sseClients   = new Set();
const liveAlerts   = [];       // last 40 alerts for SSE/init (in-memory ring)
let   totalReadings = 0;
let   totalAlerts   = db.totalEver;  // seed from persisted count

const containerState = {};
for (const cfg of FLEET_CFG) {
    containerState[cfg.id] = {
        id: cfg.id, cargo: cfg.cargo, icon: cfg.icon,
        threshold: cfg.threshold, status: 'waiting',
        temperature: null, humidity: null, gps: null,
        timestamp: null,
        history: [],
        alertCount: 0,
        min: Infinity, max: -Infinity, sum: 0, count: 0,
        prevTemp: null
    };
}

// Pre-fill per-container alertCounts from persisted records
for (const r of db.records) {
    if (containerState[r.id]) containerState[r.id].alertCount++;
}
// Seed live ring from last 40 persisted records
liveAlerts.push(...db.records.slice(0, 40));

// ─── SSE Broadcast ────────────────────────────────────────────────────────────

function broadcast(obj) {
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of sseClients) {
        try { res.write(line); } catch (_) { sseClients.delete(res); }
    }
}

// ─── Monitoring Logic ─────────────────────────────────────────────────────────

const monitoringCenter = new EventEmitter();

monitoringCenter.on('alert', ({ id, msg, cargo, icon }) => {
    totalAlerts++;
    containerState[id].alertCount++;
    const entry = { time: new Date().toISOString(), id, cargo, icon, msg };
    // persist to file first
    persistAlert(entry);
    // update live ring
    liveAlerts.unshift(entry);
    if (liveAlerts.length > 40) liveAlerts.pop();
    broadcast({ type: 'alert', payload: { ...entry, totalAlerts } });
});

function startContainer(cfg) {
    const reefer = new ReeferIoT(cfg);
    reefer.on('telemetry', (data) => {
        totalReadings++;
        const hot  = data.temperature > data.threshold;
        const cs   = containerState[data.id];
        const prev = cs.temperature;

        cs.prevTemp    = prev;
        cs.temperature = data.temperature;
        cs.humidity    = data.humidity;
        cs.gps         = data.gps;
        cs.timestamp   = data.timestamp;
        cs.status      = hot ? 'critical' : 'ok';
        cs.history.push(data.temperature);
        if (cs.history.length > 30) cs.history.shift();
        cs.count++;
        cs.sum += data.temperature;
        if (data.temperature < cs.min) cs.min = data.temperature;
        if (data.temperature > cs.max) cs.max = data.temperature;

        const avg   = parseFloat((cs.sum / cs.count).toFixed(2));
        const trend = prev === null ? 'flat'
                    : data.temperature > prev + 0.15 ? 'up'
                    : data.temperature < prev - 0.15 ? 'down'
                    : 'flat';

        broadcast({
            type: 'telemetry',
            payload: {
                ...data, trend,
                history:    cs.history,
                alertCount: cs.alertCount,
                min:        parseFloat(cs.min.toFixed(2)),
                max:        parseFloat(cs.max.toFixed(2)),
                avg,        totalReadings
            }
        });

        if (hot) {
            monitoringCenter.emit('alert', {
                id: data.id, cargo: data.cargo, icon: data.icon,
                msg: `[${data.id}] ${data.cargo} — ${data.temperature}°C exceeds ${data.threshold}°C threshold`
            });
        }
    });

    setInterval(() => reefer.sendTelemetry(), cfg.intervalMs);
    reefer.sendTelemetry();
}

for (const cfg of FLEET_CFG) startContainer(cfg);

// ─── Init payload ─────────────────────────────────────────────────────────────

function buildInitPayload() {
    return {
        type: 'init',
        payload: {
            fleet: FLEET_CFG.map(c => ({ id: c.id, cargo: c.cargo, icon: c.icon, threshold: c.threshold })),
            state:  containerState,
            alerts: liveAlerts.slice(0, 40),
            totalReadings,
            totalAlerts,
            totalEverPersisted: db.totalEver
        }
    };
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Fleet Reefer Monitor</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg:      #0d1117;
  --surface: #161b22;
  --raised:  #1c2330;
  --border:  #30363d;
  --text:    #e6edf3;
  --muted:   #8b949e;
  --blue:    #58a6ff;
  --green:   #3fb950;
  --red:     #f85149;
  --orange:  #e3b341;
  --purple:  #bc8cff;
  --teal:    #39d353;
}
html, body { height: 100%; }
body {
  background: var(--bg); color: var(--text);
  font-family: 'Segoe UI', system-ui, sans-serif;
  min-height: 100vh; padding: 20px; display: flex; flex-direction: column; gap: 18px;
}

/* ── Header ── */
header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
.header-left { display:flex; align-items:center; gap:12px; }
header h1 { font-size:1.3rem; font-weight:700; letter-spacing:-.01em; }
.live-badge {
  display:inline-flex; align-items:center; gap:6px; font-size:0.72rem;
  background:#1a2e1a; color:var(--green); border:1px solid #2d4a2d;
  border-radius:20px; padding:3px 11px; white-space:nowrap;
}
.live-dot { width:7px; height:7px; border-radius:50%; background:var(--green); animation:blink 1.4s infinite; }
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:.25} }
.filter-bar { display:flex; gap:8px; }
.filter-btn {
  font-size:0.75rem; padding:5px 14px; border-radius:20px; border:1px solid var(--border);
  background:transparent; color:var(--muted); cursor:pointer; transition:all .15s; font-family:inherit;
}
.filter-btn:hover { border-color:var(--blue); color:var(--blue); }
.filter-btn.active          { background:#1a2a3a; color:var(--blue);  border-color:var(--blue);  }
.filter-btn.active.f-ok     { background:#1a2e1a; color:var(--green); border-color:#2d4a2d; }
.filter-btn.active.f-crit   { background:#2e1a1a; color:var(--red);   border-color:#4a2d2d; }

/* ── Stats row ── */
.stats-row { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
@media(max-width:580px){ .stats-row { grid-template-columns:repeat(2,1fr); } }
.stat-card { background:var(--surface); border:1px solid var(--border); border-radius:10px; padding:16px 14px; }
.stat-card .lbl { font-size:0.68rem; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:6px; }
.stat-card .val { font-size:1.8rem; font-weight:700; line-height:1; }
.stat-card .sub { font-size:0.7rem; color:var(--muted); margin-top:4px; }

/* ── Panel ── */
.panel { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
.panel-hdr {
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:10px 16px; border-bottom:1px solid var(--border);
  font-size:0.75rem; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:.07em;
}
.panel-hdr span { font-weight:400; font-size:0.7rem; }

/* ── Fleet table ── */
.table-wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:0.8rem; }
thead th {
  background:#0d1117; color:var(--muted); font-weight:500; text-align:left; padding:8px 12px;
  font-size:0.68rem; text-transform:uppercase; letter-spacing:.05em; white-space:nowrap;
}
tbody tr { border-top:1px solid var(--border); cursor:pointer; transition:background .12s; }
tbody tr:hover  { background:var(--raised); }
tbody tr.active { background:#1a2540; border-left:3px solid var(--blue); }
tbody td { padding:9px 12px; vertical-align:middle; }
.id-cell    { font-family:monospace; color:var(--blue); font-size:0.78rem; white-space:nowrap; }
.cargo-cell { white-space:nowrap; }
.cargo-icon { margin-right:5px; }
.cargo-name { color:var(--muted); font-size:0.76rem; }
.temp-ok    { color:var(--green); font-weight:700; }
.temp-hot   { color:var(--red);   font-weight:700; animation:tempflash .65s infinite alternate; }
@keyframes tempflash { from{opacity:1} to{opacity:.45} }
.hum-val    { color:var(--blue); }
.gps-cell   { color:var(--orange); font-size:0.72rem; white-space:nowrap; }
.ts-cell    { color:var(--muted);  font-size:0.72rem; white-space:nowrap; }
.trend      { font-size:0.9rem; }
.trend-up   { color:var(--red);   }
.trend-down { color:var(--teal);  }
.trend-flat { color:var(--muted); }
.pill {
  display:inline-block; padding:2px 9px; border-radius:12px;
  font-size:0.68rem; font-weight:700; text-transform:uppercase; letter-spacing:.06em; white-space:nowrap;
}
.pill-ok       { background:#1a2e1a; color:var(--green); border:1px solid #2d4a2d; }
.pill-critical { background:#2e1a1a; color:var(--red);   border:1px solid #4a2d2d; animation:tempflash .65s infinite alternate; }
.pill-waiting  { background:#1e202e; color:var(--muted); border:1px solid var(--border); }
.spark-cell svg { display:block; }

/* ── Detail Panel ── */
.detail-panel { background:var(--surface); border:1px solid var(--border); border-radius:10px; overflow:hidden; display:none; }
.detail-panel.open { display:block; }
.detail-hdr { display:flex; align-items:center; justify-content:space-between; padding:12px 16px; border-bottom:1px solid var(--border); }
.detail-title { display:flex; align-items:center; gap:10px; }
.detail-title .icon { font-size:1.4rem; }
.detail-title h2 { font-size:1rem; font-weight:700; }
.detail-title .sub { font-size:0.75rem; color:var(--muted); margin-top:1px; }
.close-btn {
  background:none; border:1px solid var(--border); color:var(--muted); border-radius:6px;
  padding:4px 10px; cursor:pointer; font-family:inherit; font-size:0.8rem; transition:all .15s;
}
.close-btn:hover { border-color:var(--red); color:var(--red); }
.detail-body { padding:16px; display:flex; flex-direction:column; gap:16px; }
.detail-stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
@media(max-width:520px){ .detail-stats { grid-template-columns:repeat(2,1fr); } }
.ds-card { background:var(--raised); border:1px solid var(--border); border-radius:8px; padding:12px 10px; }
.ds-card .lbl { font-size:0.65rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em; margin-bottom:4px; }
.ds-card .val { font-size:1.4rem; font-weight:700; }
.chart-wrap { background:var(--raised); border:1px solid var(--border); border-radius:8px; padding:14px 14px 8px; }
.chart-label { font-size:0.68rem; color:var(--muted); text-transform:uppercase; letter-spacing:.06em; margin-bottom:10px; }
#detail-chart { width:100%; display:block; }
.detail-meta { display:flex; gap:20px; flex-wrap:wrap; font-size:0.78rem; color:var(--muted); }
.detail-meta span { color:var(--text); }

/* ── Tabs ── */
.tab-bar {
  display:flex; border-bottom:1px solid var(--border); background:var(--surface);
}
.tab-btn {
  padding:9px 18px; font-size:0.75rem; font-weight:600; color:var(--muted);
  background:none; border:none; border-bottom:2px solid transparent;
  cursor:pointer; font-family:inherit; text-transform:uppercase; letter-spacing:.06em;
  transition:all .15s; white-space:nowrap;
}
.tab-btn:hover { color:var(--text); }
.tab-btn.active { color:var(--blue); border-bottom-color:var(--blue); }
.tab-pane { display:none; }
.tab-pane.active { display:block; }

/* ── Alerts list ── */
.alerts-scroll { max-height:280px; overflow-y:auto; }
.alert-item {
  display:flex; gap:10px; align-items:flex-start;
  padding:9px 14px; border-top:1px solid var(--border);
}
.alert-item:first-child { border-top:none; }
.alert-item .ai { flex-shrink:0; font-size:.9rem; margin-top:2px; }
.alert-item .ab { flex:1; min-width:0; }
.alert-item .at { font-family:monospace; font-size:.69rem; color:var(--blue); margin-bottom:2px; }
.alert-item .am { font-size:.78rem; word-break:break-word; }
.alert-item .as { font-size:.67rem; color:var(--muted); margin-top:2px; }
.no-alerts { color:var(--muted); padding:20px 16px; font-size:.8rem; }

/* ── History tab controls ── */
.history-toolbar {
  display:flex; align-items:center; gap:10px; padding:10px 14px;
  border-bottom:1px solid var(--border); flex-wrap:wrap;
}
.history-toolbar select, .history-toolbar input[type=date] {
  background:var(--raised); border:1px solid var(--border); color:var(--text);
  border-radius:6px; padding:5px 10px; font-size:0.75rem; font-family:inherit; cursor:pointer;
}
.history-toolbar select:focus, .history-toolbar input[type=date]:focus { outline:none; border-color:var(--blue); }
.btn-sm {
  padding:5px 14px; border-radius:6px; border:1px solid var(--border);
  background:transparent; color:var(--muted); font-family:inherit; font-size:0.75rem;
  cursor:pointer; transition:all .15s;
}
.btn-sm:hover { border-color:var(--blue); color:var(--blue); }
.btn-sm.primary { background:#1a2a3a; color:var(--blue); border-color:var(--blue); }
.hist-summary { margin-left:auto; font-size:0.72rem; color:var(--muted); }

.pagination { display:flex; align-items:center; gap:8px; padding:10px 14px; border-top:1px solid var(--border); }
.pagination .pg-info { font-size:0.72rem; color:var(--muted); margin-right:auto; }

/* ── Toast ── */
.toast {
  position:fixed; bottom:24px; right:24px; z-index:9999;
  background:#2e1a1a; border:1px solid #4a2d2d; color:var(--red);
  border-radius:10px; padding:12px 18px; font-size:.82rem;
  max-width:320px; box-shadow:0 4px 24px rgba(0,0,0,.5);
  animation:slideIn .25s ease; pointer-events:none;
}
@keyframes slideIn { from{transform:translateY(20px);opacity:0} to{transform:translateY(0);opacity:1} }

/* scrollbars */
::-webkit-scrollbar { width:5px; height:5px; }
::-webkit-scrollbar-track { background:transparent; }
::-webkit-scrollbar-thumb { background:var(--border); border-radius:3px; }
</style>
</head>
<body>

<header>
  <div class="header-left">
    <h1>🚢 Fleet Reefer Monitor</h1>
    <div class="live-badge"><div class="live-dot"></div>Live Stream</div>
  </div>
  <div class="filter-bar">
    <button class="filter-btn active"      onclick="setFilter('all',this)">All</button>
    <button class="filter-btn f-ok"        onclick="setFilter('ok',this)">✅ OK</button>
    <button class="filter-btn f-crit"      onclick="setFilter('critical',this)">🚨 Critical</button>
  </div>
</header>

<div class="stats-row">
  <div class="stat-card">
    <div class="lbl">Containers</div>
    <div class="val" id="s-fleet" style="color:var(--blue)">—</div>
    <div class="sub">in fleet</div>
  </div>
  <div class="stat-card">
    <div class="lbl">Critical Now</div>
    <div class="val" id="s-critical" style="color:var(--red)">0</div>
    <div class="sub">need attention</div>
  </div>
  <div class="stat-card">
    <div class="lbl">Total Readings</div>
    <div class="val" id="s-readings" style="color:var(--green)">0</div>
    <div class="sub">this session</div>
  </div>
  <div class="stat-card">
    <div class="lbl">All-Time Alerts</div>
    <div class="val" id="s-alerts" style="color:var(--orange)">0</div>
    <div class="sub" id="s-alerts-sub">persisted</div>
  </div>
</div>

<!-- Fleet table -->
<div class="panel">
  <div class="panel-hdr">Fleet Status <span id="fleet-sub"></span></div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Container ID</th><th>Cargo</th><th></th><th>Temp °C</th>
        <th>Threshold</th><th>Min / Max / Avg</th><th>Humidity %</th>
        <th>GPS</th><th>Last Seen</th><th>Status</th><th>Trend</th>
      </tr></thead>
      <tbody id="fleet-body"></tbody>
    </table>
  </div>
</div>

<!-- Detail panel -->
<div class="detail-panel" id="detail-panel">
  <div class="detail-hdr">
    <div class="detail-title">
      <span class="icon" id="dp-icon"></span>
      <div><h2 id="dp-id"></h2><div class="sub" id="dp-cargo"></div></div>
      <div id="dp-status" style="margin-left:8px"></div>
    </div>
    <button class="close-btn" onclick="closeDetail()">✕ Close</button>
  </div>
  <div class="detail-body">
    <div class="detail-stats">
      <div class="ds-card"><div class="lbl">Current Temp</div><div class="val" id="dp-temp">—</div></div>
      <div class="ds-card"><div class="lbl">Min / Max</div><div class="val" id="dp-minmax" style="font-size:.95rem;margin-top:4px">—</div></div>
      <div class="ds-card"><div class="lbl">Avg Temp</div><div class="val" id="dp-avg">—</div></div>
      <div class="ds-card"><div class="lbl">Alerts Fired</div><div class="val" id="dp-alerts" style="color:var(--red)">0</div></div>
    </div>
    <div class="chart-wrap">
      <div class="chart-label">Temperature History (last 30 readings) — dashed = threshold</div>
      <svg id="detail-chart" height="120"></svg>
    </div>
    <div class="detail-meta">
      Humidity: <span id="dp-hum">—</span> &nbsp;|&nbsp;
      GPS: <span id="dp-gps">—</span> &nbsp;|&nbsp;
      Last seen: <span id="dp-ts">—</span> &nbsp;|&nbsp;
      Threshold: <span id="dp-thresh">—</span>
    </div>
  </div>
</div>

<!-- Alerts + History (tabbed) -->
<div class="panel">
  <div class="tab-bar">
    <button class="tab-btn active" onclick="switchTab('live',this)">📡 Live Alerts</button>
    <button class="tab-btn"        onclick="switchTab('history',this)">🗄️ Alert History</button>
  </div>

  <!-- Live tab -->
  <div class="tab-pane active" id="tab-live">
    <div class="panel-hdr" style="border-top:none">Live Alerts <span id="alrt-sub"></span></div>
    <div class="alerts-scroll">
      <ul id="alerts-list" style="list-style:none">
        <li class="no-alerts">No alerts yet — all containers within thresholds.</li>
      </ul>
    </div>
  </div>

  <!-- History tab -->
  <div class="tab-pane" id="tab-history">
    <div class="history-toolbar">
      <select id="hist-container">
        <option value="">All Containers</option>
        <option value="MSC-IOT-101">MSC-IOT-101 🥦 Fresh Produce</option>
        <option value="MSC-IOT-202">MSC-IOT-202 🧀 Dairy</option>
        <option value="MSC-IOT-303">MSC-IOT-303 🐟 Frozen Seafood</option>
        <option value="MSC-IOT-404">MSC-IOT-404 💊 Pharmaceuticals</option>
        <option value="MSC-IOT-505">MSC-IOT-505 🍺 Beverages</option>
        <option value="MSC-IOT-606">MSC-IOT-606 🥩 Meat &amp; Poultry</option>
      </select>
      <select id="hist-limit">
        <option value="25">25 per page</option>
        <option value="50" selected>50 per page</option>
        <option value="100">100 per page</option>
      </select>
      <button class="btn-sm primary" onclick="loadHistory(1)">🔍 Search</button>
      <button class="btn-sm" onclick="exportCSV()">⬇️ Export CSV</button>
      <span class="hist-summary" id="hist-summary"></span>
    </div>
    <div class="alerts-scroll" id="hist-body-wrap">
      <ul id="hist-list" style="list-style:none">
        <li class="no-alerts">Click Search to load alert history.</li>
      </ul>
    </div>
    <div class="pagination" id="hist-pagination" style="display:none">
      <span class="pg-info" id="pg-info"></span>
      <button class="btn-sm" id="pg-prev" onclick="histPage(-1)">← Prev</button>
      <button class="btn-sm" id="pg-next" onclick="histPage(+1)">Next →</button>
    </div>
  </div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────
const fleet       = {};
const state       = {};
let totalReadings = 0;
let totalAlerts   = 0;
let activeFilter  = 'all';
let selectedId    = null;
let notifGranted  = false;
let histCurrentPage = 1;

// ── Notification permission ────────────────────────────────────────────────
if ('Notification' in window) {
  Notification.requestPermission().then(p => { notifGranted = p === 'granted'; });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(iso)   { return new Date(iso).toLocaleTimeString(); }
function fmtDate(iso)   { return new Date(iso).toLocaleString(); }
function key(id)        { return id.replace(/-/g,'_'); }

function showToast(msg, dur=4000) {
  const el = document.createElement('div');
  el.className   = 'toast';
  el.textContent = '🚨 ' + msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), dur);
}

// ── Tabs ───────────────────────────────────────────────────────────────────
function switchTab(name, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
  if (name === 'history') loadHistory(1);
}

// ── Sparkline SVG ──────────────────────────────────────────────────────────
function sparklineSVG(values, threshold, W=90, H=30) {
  if (!values || values.length < 2) return '<svg width="'+W+'" height="'+H+'"></svg>';
  const pad = 3;
  const allV = [...values, threshold];
  const lo = Math.min(...allV) - 0.3, hi = Math.max(...allV) + 0.3;
  const sx = i => pad + (i / (values.length-1)) * (W - 2*pad);
  const sy = v => H - pad - ((v - lo) / (hi - lo)) * (H - 2*pad);
  const pts = values.map((v,i) => sx(i)+','+sy(v)).join(' ');
  const ty  = sy(threshold).toFixed(1);
  const hot = values[values.length-1] > threshold;
  const col = hot ? '#f85149' : '#3fb950';
  const ap  = sx(0)+','+sy(values[0]) + ' ' + pts.split(' ').slice(1).join(' ') +
              ' ' + sx(values.length-1)+','+(H-pad) + ' ' + sx(0)+','+(H-pad);
  return \`<svg width="\${W}" height="\${H}" xmlns="http://www.w3.org/2000/svg">
    <polygon points="\${ap}" fill="\${col}" opacity=".12"/>
    <polyline points="\${pts}" fill="none" stroke="\${col}" stroke-width="1.6" stroke-linejoin="round"/>
    <line x1="\${pad}" y1="\${ty}" x2="\${W-pad}" y2="\${ty}" stroke="#e3b341" stroke-width="1" stroke-dasharray="3,2" opacity=".7"/>
    <circle cx="\${sx(values.length-1)}" cy="\${sy(values[values.length-1])}" r="2.2" fill="\${col}"/>
  </svg>\`;
}

// ── Full detail chart ──────────────────────────────────────────────────────
function renderDetailChart(values, threshold) {
  const svg = document.getElementById('detail-chart');
  const W   = svg.getBoundingClientRect().width || 500;
  const H   = 120;
  svg.setAttribute('viewBox', \`0 0 \${W} \${H}\`);
  if (!values || values.length < 2) { svg.innerHTML = ''; return; }
  const padL=40, padR=14, padT=12, padB=24;
  const lo = Math.min(...values, threshold) - 0.5;
  const hi = Math.max(...values, threshold) + 0.5;
  const sx = i => padL + (i/(values.length-1)) * (W - padL - padR);
  const sy = v => padT + (1 - (v-lo)/(hi-lo)) * (H - padT - padB);
  const pts = values.map((v,i) => sx(i)+','+sy(v)).join(' ');
  const ty  = sy(threshold).toFixed(1);
  const hot = values[values.length-1] > threshold;
  const col = hot ? '#f85149' : '#3fb950';
  let yTicks = '';
  for (let i=0; i<=4; i++) {
    const v = lo + (hi-lo)*(i/4), yy = sy(v).toFixed(1);
    yTicks += \`<line x1="\${padL-4}" y1="\${yy}" x2="\${W-padR}" y2="\${yy}" stroke="#30363d" stroke-width=".8"/>
               <text x="\${padL-7}" y="\${parseFloat(yy)+4}" text-anchor="end" font-size="9" fill="#8b949e">\${v.toFixed(1)}</text>\`;
  }
  const n = values.length - 1;
  const xLbls = [0, Math.floor(n/2), n].map(i =>
    \`<text x="\${sx(i)}" y="\${H-6}" text-anchor="middle" font-size="9" fill="#8b949e">\${i+1}</text>\`
  ).join('');
  const area = \`\${padL},\${H-padB} \` + pts + \` \${sx(n)},\${H-padB}\`;
  svg.innerHTML = \`
    <polygon points="\${area}" fill="\${col}" opacity=".1"/>
    \${yTicks}
    <line x1="\${padL}" y1="\${padT}" x2="\${padL}" y2="\${H-padB}" stroke="#30363d" stroke-width=".8"/>
    <line x1="\${padL}" y1="\${H-padB}" x2="\${W-padR}" y2="\${H-padB}" stroke="#30363d" stroke-width=".8"/>
    <line x1="\${padL}" y1="\${ty}" x2="\${W-padR}" y2="\${ty}" stroke="#e3b341" stroke-width="1.2" stroke-dasharray="5,3" opacity=".8"/>
    <text x="\${W-padR+2}" y="\${parseFloat(ty)+4}" font-size="8" fill="#e3b341">limit</text>
    <polyline points="\${pts}" fill="none" stroke="\${col}" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="\${sx(n)}" cy="\${sy(values[n])}" r="3.5" fill="\${col}"/>
    \${xLbls}
  \`;
}

// ── Fleet table ────────────────────────────────────────────────────────────
function buildRow(id) {
  const k = key(id), c = fleet[id] || {};
  const tr = document.createElement('tr');
  tr.id = 'row-'+k; tr.dataset.id = id; tr.dataset.status = 'waiting';
  tr.onclick = () => openDetail(id);
  tr.innerHTML =
    '<td class="id-cell">'+id+'</td>'+
    '<td class="cargo-cell"><span class="cargo-icon">'+(c.icon||'')+'</span><span class="cargo-name">'+(c.cargo||'')+'</span></td>'+
    '<td class="spark-cell" id="sp-'+k+'"></td>'+
    '<td id="t-'+k+'" class="temp-ok">—</td>'+
    '<td style="color:var(--muted)">'+(c.threshold||'')+'°C</td>'+
    '<td id="mm-'+k+'"><div style="color:var(--muted);font-size:.7rem">—</div></td>'+
    '<td class="hum-val" id="h-'+k+'">—</td>'+
    '<td class="gps-cell" id="g-'+k+'">—</td>'+
    '<td class="ts-cell"  id="ts-'+k+'">—</td>'+
    '<td id="st-'+k+'"><span class="pill pill-waiting">Waiting</span></td>'+
    '<td id="tr-'+k+'"><span class="trend trend-flat">—</span></td>';
  return tr;
}

function updateRow(data) {
  const k = key(data.id), hot = data.temperature > data.threshold;
  const get = id => document.getElementById(id+k);
  const tEl = get('t-'), mmEl = get('mm-'), hEl = get('h-');
  const gEl = get('g-'), tsEl = get('ts-'), stEl = get('st-');
  const trEl = get('tr-'), spEl = get('sp-');
  const row = document.getElementById('row-'+k);
  if (!tEl) return;
  tEl.textContent = data.temperature.toFixed(2);
  tEl.className   = hot ? 'temp-hot' : 'temp-ok';
  mmEl.innerHTML  = '<div style="color:var(--muted);font-size:.7rem">'+
    '<span style="color:var(--teal)">↓'+data.min+'</span> / '+
    '<span style="color:var(--red)">↑'+data.max+'</span> / '+
    '<span style="color:var(--blue)">~'+data.avg+'</span></div>';
  hEl.textContent  = data.humidity.toFixed(2);
  gEl.textContent  = data.gps.lat+', '+data.gps.lng;
  tsEl.textContent = fmtTime(data.timestamp);
  stEl.innerHTML   = hot ? '<span class="pill pill-critical">Critical</span>'
                         : '<span class="pill pill-ok">OK</span>';
  const tm = {up:'↑',down:'↓',flat:'—'}, tc = {up:'trend-up',down:'trend-down',flat:'trend-flat'};
  trEl.innerHTML = '<span class="trend '+tc[data.trend]+'">'+tm[data.trend]+'</span>';
  if (spEl) spEl.innerHTML = sparklineSVG(data.history, data.threshold);
  if (row)  row.dataset.status = hot ? 'critical' : 'ok';
}

function applyFilter() {
  document.querySelectorAll('#fleet-body tr').forEach(r => {
    const s = r.dataset.status || 'waiting';
    r.style.display = (activeFilter === 'all' || activeFilter === s) ? '' : 'none';
  });
}

function setFilter(f, btn) {
  activeFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyFilter();
}

// ── Detail panel ───────────────────────────────────────────────────────────
function openDetail(id) {
  selectedId = id;
  const dp = document.getElementById('detail-panel');
  dp.classList.add('open');
  dp.scrollIntoView({ behavior:'smooth', block:'nearest' });
  document.querySelectorAll('#fleet-body tr').forEach(r => r.classList.remove('active'));
  const row = document.getElementById('row-'+key(id));
  if (row) row.classList.add('active');
  const f = fleet[id] || {};
  document.getElementById('dp-icon').textContent  = f.icon || '';
  document.getElementById('dp-id').textContent    = id;
  document.getElementById('dp-cargo').textContent = f.cargo || '';
  updateDetailStats(state[id]);
}

function updateDetailStats(s) {
  if (!s || selectedId !== s.id) return;
  const f = fleet[s.id] || {};
  document.getElementById('dp-temp').textContent   = s.temperature !== null ? s.temperature.toFixed(2)+'°C' : '—';
  document.getElementById('dp-temp').style.color   = s.status === 'critical' ? 'var(--red)' : 'var(--green)';
  document.getElementById('dp-minmax').textContent = s.min !== undefined && s.max !== undefined
    ? s.min.toFixed(2)+'° / '+s.max.toFixed(2)+'°' : '—';
  document.getElementById('dp-avg').textContent    = s.avg !== undefined ? s.avg.toFixed(2)+'°C' : '—';
  document.getElementById('dp-alerts').textContent = s.alertCount || 0;
  document.getElementById('dp-hum').textContent    = s.humidity !== null ? s.humidity.toFixed(2)+'%' : '—';
  document.getElementById('dp-gps').textContent    = s.gps ? s.gps.lat+', '+s.gps.lng : '—';
  document.getElementById('dp-ts').textContent     = s.timestamp ? fmtTime(s.timestamp) : '—';
  document.getElementById('dp-thresh').textContent = f.threshold+'°C';
  document.getElementById('dp-status').innerHTML   = s.status === 'critical'
    ? '<span class="pill pill-critical">Critical</span>'
    : s.status === 'ok'
      ? '<span class="pill pill-ok">OK</span>'
      : '<span class="pill pill-waiting">Waiting</span>';
  renderDetailChart(s.history, f.threshold);
}

function closeDetail() {
  selectedId = null;
  document.getElementById('detail-panel').classList.remove('open');
  document.querySelectorAll('#fleet-body tr').forEach(r => r.classList.remove('active'));
}

// ── Live alerts ────────────────────────────────────────────────────────────
function alertItemHTML(a) {
  return '<li class="alert-item">'+
    '<span class="ai">🚨</span>'+
    '<div class="ab">'+
      '<div class="at">'+a.id+' — '+(a.icon||'')+' '+a.cargo+'</div>'+
      '<div class="am">'+a.msg+'</div>'+
      '<div class="as">'+fmtDate(a.time)+'</div>'+
    '</div></li>';
}

function prependAlert(a) {
  const list = document.getElementById('alerts-list');
  const ph   = list.querySelector('.no-alerts');
  if (ph) ph.remove();
  list.insertAdjacentHTML('afterbegin', alertItemHTML(a));
  while (list.children.length > 40) list.removeChild(list.lastChild);
}

// ── History tab ────────────────────────────────────────────────────────────
let histTotal = 0;

async function loadHistory(page) {
  histCurrentPage = page;
  const container = document.getElementById('hist-container').value;
  const limit     = parseInt(document.getElementById('hist-limit').value);
  let url = \`/api/alerts?page=\${page}&limit=\${limit}\`;
  if (container) url += '&container=' + encodeURIComponent(container);

  const list = document.getElementById('hist-list');
  list.innerHTML = '<li class="no-alerts" style="color:var(--muted)">Loading…</li>';

  try {
    const res  = await fetch(url);
    const data = await res.json();
    histTotal  = data.total;

    document.getElementById('hist-summary').textContent =
      data.total + ' record' + (data.total !== 1 ? 's' : '') + ' found';

    if (data.records.length === 0) {
      list.innerHTML = '<li class="no-alerts">No alerts found for this filter.</li>';
      document.getElementById('hist-pagination').style.display = 'none';
      return;
    }

    list.innerHTML = data.records.map(a => alertItemHTML(a)).join('');

    const totalPages = Math.ceil(data.total / limit);
    document.getElementById('pg-info').textContent =
      'Page '+page+' of '+totalPages+' ('+data.total+' total)';
    document.getElementById('pg-prev').disabled = page <= 1;
    document.getElementById('pg-next').disabled = page >= totalPages;
    document.getElementById('hist-pagination').style.display = 'flex';
  } catch (e) {
    list.innerHTML = '<li class="no-alerts" style="color:var(--red)">Failed to load history.</li>';
  }
}

function histPage(delta) {
  const limit = parseInt(document.getElementById('hist-limit').value);
  const total = Math.ceil(histTotal / limit);
  const next  = Math.max(1, Math.min(histCurrentPage + delta, total));
  loadHistory(next);
}

// ── CSV export ─────────────────────────────────────────────────────────────
async function exportCSV() {
  const container = document.getElementById('hist-container').value;
  let url = '/api/alerts?page=1&limit=1000';
  if (container) url += '&container=' + encodeURIComponent(container);
  const res  = await fetch(url);
  const data = await res.json();
  const rows = [['Time','Container ID','Cargo','Message']].concat(
    data.records.map(a => [a.time, a.id, a.cargo, '"'+a.msg.replace(/"/g,'""')+'"'])
  );
  const csv  = rows.map(r => r.join(',')).join('\\n');
  const blob = new Blob([csv], { type:'text/csv' });
  const link = document.createElement('a');
  link.href     = URL.createObjectURL(blob);
  link.download = 'reefer_alerts_'+(container||'all')+'.csv';
  link.click();
}

// ── SSE ────────────────────────────────────────────────────────────────────
function handleInit(payload) {
  totalReadings = payload.totalReadings;
  totalAlerts   = payload.totalAlerts;

  document.getElementById('s-fleet').textContent    = payload.fleet.length;
  document.getElementById('s-readings').textContent = totalReadings;
  document.getElementById('s-alerts').textContent   = totalAlerts;
  if (payload.totalEverPersisted > 0) {
    document.getElementById('s-alerts-sub').textContent =
      payload.totalEverPersisted + ' all-time';
  }

  payload.fleet.forEach(f => { fleet[f.id] = f; });
  const tbody = document.getElementById('fleet-body');
  tbody.innerHTML = '';
  payload.fleet.forEach(f => tbody.appendChild(buildRow(f.id)));

  Object.values(payload.state).forEach(s => {
    if (!s.temperature) return;
    const avg = s.count ? parseFloat((s.sum / s.count).toFixed(2)) : null;
    state[s.id] = { ...s, avg };
    updateRow({ ...s, avg, trend:'flat' });
  });

  payload.alerts.forEach(a => prependAlert(a));
  if (payload.alerts.length) {
    document.getElementById('alrt-sub').textContent = payload.alerts.length + ' recent';
  }

  document.getElementById('s-critical').textContent =
    Object.values(payload.state).filter(s => s.status === 'critical').length;
  document.getElementById('fleet-sub').textContent = totalReadings + ' readings';
  applyFilter();
}

const src = new EventSource('/events');

src.onmessage = (e) => {
  const { type, payload } = JSON.parse(e.data);

  if (type === 'init') { handleInit(payload); return; }

  if (type === 'telemetry') {
    totalReadings = payload.totalReadings || totalReadings + 1;
    state[payload.id] = payload;
    updateRow(payload);
    updateDetailStats(payload);
    document.getElementById('s-readings').textContent = totalReadings;
    document.getElementById('s-fleet').textContent    = Object.keys(fleet).length || '—';
    document.getElementById('fleet-sub').textContent  = totalReadings + ' readings';
    document.getElementById('s-critical').textContent =
      Object.values(state).filter(s => s.status === 'critical').length;
    applyFilter();
  }

  if (type === 'alert') {
    totalAlerts = payload.totalAlerts || totalAlerts + 1;
    document.getElementById('s-alerts').textContent   = totalAlerts;
    document.getElementById('s-alerts-sub').textContent = 'all-time';
    document.getElementById('alrt-sub').textContent   = totalAlerts + ' total';
    prependAlert(payload);
    showToast(payload.msg);
    if (notifGranted) new Notification('Reefer Alert', { body: payload.msg });
  }
};

src.onerror = () => console.warn('SSE reconnecting…');

window.addEventListener('resize', () => {
  if (selectedId && state[selectedId]) {
    renderDetailChart(state[selectedId].history, (fleet[selectedId]||{}).threshold);
  }
});
</script>
</body>
</html>`;

// ─── HTTP Server ───────────────────────────────────────────────────────────────

function parseQuery(url) {
    const q = {};
    const i = url.indexOf('?');
    if (i < 0) return q;
    url.slice(i + 1).split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) q[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    return q;
}

const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];

    if (urlPath === '/events') {
        res.writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        res.write('retry: 3000\n\n');
        res.write(`data: ${JSON.stringify(buildInitPayload())}\n\n`);
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
    }

    if (urlPath === '/api/fleet') {
        const payload = {
            timestamp:    new Date().toISOString(),
            totalReadings,
            totalAlerts,
            totalEverPersisted: db.totalEver,
            containers:   Object.values(containerState).map(c => ({
                id: c.id, cargo: c.cargo, threshold: c.threshold, status: c.status,
                temperature: c.temperature, humidity: c.humidity, gps: c.gps,
                alertCount: c.alertCount,
                min: c.min === Infinity  ? null : parseFloat(c.min.toFixed(2)),
                max: c.max === -Infinity ? null : parseFloat(c.max.toFixed(2)),
                avg: c.count ? parseFloat((c.sum / c.count).toFixed(2)) : null
            })),
            recentAlerts: liveAlerts.slice(0, 10)
        };
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(payload, null, 2));
        return;
    }

    if (urlPath === '/api/alerts') {
        const q        = parseQuery(req.url);
        const page     = Math.max(1, parseInt(q.page)  || 1);
        const limit    = Math.min(200, Math.max(1, parseInt(q.limit) || 50));
        const cFilter  = (q.container || '').trim();

        const filtered = cFilter
            ? db.records.filter(r => r.id === cFilter)
            : db.records;

        const total  = filtered.length;
        const start  = (page - 1) * limit;
        const records = filtered.slice(start, start + limit);

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ page, limit, total, records }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Fleet Reefer Dashboard → http://0.0.0.0:${PORT}`);
    console.log(`JSON API (fleet)       → http://0.0.0.0:${PORT}/api/fleet`);
    console.log(`JSON API (alerts)      → http://0.0.0.0:${PORT}/api/alerts`);
    console.log(`Alert history file     → ${ALERTS_FILE}`);
    console.log(`Monitoring ${FLEET_CFG.length} containers:`);
    FLEET_CFG.forEach(c => console.log(`  ${c.icon} ${c.id}  ${c.cargo}  (≤ ${c.threshold}°C)`));
});
