/**
 * Reefer Monitoring System — Fleet Dashboard
 * Tracks multiple containers and serves a live dashboard on port 5000.
 */

const http = require('http');
const EventEmitter = require('events');

// ─── Reefer IoT Core ─────────────────────────────────────────────────────────

class ReeferIoT extends EventEmitter {
    constructor({ id, cargo, tempMin, tempMax, threshold, intervalMs }) {
        super();
        this.id         = id;
        this.cargo      = cargo;
        this.tempMin    = tempMin;
        this.tempMax    = tempMax;
        this.threshold  = threshold;
        this.intervalMs = intervalMs;
        this.active     = true;
    }

    sendTelemetry() {
        if (!this.active) return;
        const data = {
            id:          this.id,
            cargo:       this.cargo,
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

// ─── Fleet Definition ─────────────────────────────────────────────────────────

const FLEET = [
    { id: 'MSC-IOT-101', cargo: 'Fresh Produce',     tempMin: 2,  tempMax: 6,  threshold: 5.5, intervalMs: 2000 },
    { id: 'MSC-IOT-202', cargo: 'Dairy',             tempMin: 1,  tempMax: 6,  threshold: 5.0, intervalMs: 2500 },
    { id: 'MSC-IOT-303', cargo: 'Frozen Seafood',    tempMin: -2, tempMax: 3,  threshold: 2.0, intervalMs: 3000 },
    { id: 'MSC-IOT-404', cargo: 'Pharmaceuticals',   tempMin: 3,  tempMax: 8,  threshold: 6.0, intervalMs: 2000 },
    { id: 'MSC-IOT-505', cargo: 'Beverages',         tempMin: 4,  tempMax: 9,  threshold: 7.5, intervalMs: 3500 },
    { id: 'MSC-IOT-606', cargo: 'Meat & Poultry',    tempMin: -1, tempMax: 4,  threshold: 3.5, intervalMs: 2800 },
];

// ─── State ────────────────────────────────────────────────────────────────────

const fleetState  = {};   // latest reading per container
const alerts      = [];   // last 30 fleet-wide alerts
const sseClients  = new Set();
let   totalAlerts = 0;
let   totalReadings = 0;

for (const cfg of FLEET) {
    fleetState[cfg.id] = {
        id: cfg.id, cargo: cfg.cargo, threshold: cfg.threshold,
        temperature: null, humidity: null, gps: null,
        timestamp: null, alertCount: 0, status: 'waiting'
    };
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────

function broadcast(obj) {
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of sseClients) {
        try { res.write(line); } catch (_) { sseClients.delete(res); }
    }
}

// ─── Monitoring Logic ─────────────────────────────────────────────────────────

const monitoringCenter = new EventEmitter();

monitoringCenter.on('alert', ({ id, msg, cargo }) => {
    totalAlerts++;
    fleetState[id].alertCount++;
    const entry = { time: new Date().toISOString(), id, cargo, msg };
    alerts.unshift(entry);
    if (alerts.length > 30) alerts.pop();
    broadcast({ type: 'alert', payload: entry });
});

function startContainer(cfg) {
    const reefer = new ReeferIoT(cfg);

    reefer.on('telemetry', (data) => {
        totalReadings++;
        const hot = data.temperature > data.threshold;
        fleetState[data.id] = {
            ...fleetState[data.id],
            temperature: data.temperature,
            humidity:    data.humidity,
            gps:         data.gps,
            timestamp:   data.timestamp,
            status:      hot ? 'critical' : 'ok'
        };
        broadcast({ type: 'telemetry', payload: { ...data, totalReadings } });

        if (hot) {
            monitoringCenter.emit('alert', {
                id:    data.id,
                cargo: data.cargo,
                msg:   `[${data.id}] ${data.cargo} — temp ${data.temperature}°C exceeds ${data.threshold}°C threshold`
            });
        }
    });

    setInterval(() => reefer.sendTelemetry(), cfg.intervalMs);
    reefer.sendTelemetry(); // immediate first reading
}

for (const cfg of FLEET) startContainer(cfg);

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
    --bg:     #0d1117;
    --card:   #161b22;
    --border: #30363d;
    --text:   #e6edf3;
    --muted:  #8b949e;
    --blue:   #58a6ff;
    --green:  #3fb950;
    --red:    #f85149;
    --orange: #e3b341;
    --purple: #bc8cff;
  }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
    padding: 22px 20px;
  }

  /* ── Header ── */
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 24px;
  }
  .header-left { display: flex; align-items: center; gap: 12px; }
  header h1 { font-size: 1.35rem; font-weight: 600; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 0.75rem; background: #1c2a1c; color: var(--green);
    border: 1px solid #2d4a2d; border-radius: 20px; padding: 3px 10px;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--green); animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }

  /* ── Summary stats ── */
  .stats-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 22px;
  }
  @media (max-width: 600px) { .stats-row { grid-template-columns: repeat(2, 1fr); } }
  .stat {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 16px 14px;
  }
  .stat .lbl { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .stat .val { font-size: 1.75rem; font-weight: 700; line-height: 1; }

  /* ── Fleet table ── */
  .panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    margin-bottom: 20px;
  }
  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 11px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem; font-weight: 600;
    color: var(--muted); text-transform: uppercase; letter-spacing: .06em;
  }
  .panel-header span { font-weight: 400; font-size: 0.72rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.81rem; }
  thead th {
    background: #0d1117; color: var(--muted); font-weight: 500;
    text-align: left; padding: 8px 14px;
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: .05em;
  }
  tbody tr { border-top: 1px solid var(--border); transition: background .15s; }
  tbody tr:hover { background: #1c2330; }
  tbody td { padding: 9px 14px; }
  td.id-cell { font-family: monospace; font-size: 0.8rem; color: var(--blue); }
  td.cargo-cell { color: var(--muted); font-size: 0.78rem; }

  .temp-ok  { color: var(--green); font-weight: 600; }
  .temp-hot { color: var(--red);   font-weight: 700; animation: flash .7s infinite alternate; }
  @keyframes flash { from{opacity:1} to{opacity:.45} }
  .hum-val  { color: var(--blue); }
  .gps-val  { color: var(--orange); font-size: 0.76rem; }

  .pill {
    display: inline-block; padding: 2px 9px; border-radius: 12px;
    font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
  }
  .pill-ok       { background: #1a2e1a; color: var(--green); border: 1px solid #2d4a2d; }
  .pill-critical { background: #2e1a1a; color: var(--red);   border: 1px solid #4a2d2d; animation: flash .7s infinite alternate; }
  .pill-waiting  { background: #1e1e2e; color: var(--muted); border: 1px solid var(--border); }

  /* ── Alerts ── */
  .alerts-list { list-style: none; max-height: 260px; overflow-y: auto; }
  .alerts-list li {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 9px 16px; border-top: 1px solid var(--border); font-size: 0.81rem;
  }
  .alerts-list li:first-child { border-top: none; }
  .alert-icon { flex-shrink: 0; font-size: 0.95rem; margin-top: 2px; }
  .alert-body { flex: 1; min-width: 0; }
  .alert-id   { font-family: monospace; font-size: 0.72rem; color: var(--blue); margin-bottom: 2px; }
  .alert-msg  { color: var(--text); word-break: break-word; }
  .alert-time { color: var(--muted); font-size: 0.7rem; margin-top: 2px; }
  .no-alerts  { color: var(--muted); padding: 20px 16px; font-size: 0.83rem; }

  /* scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
</style>
</head>
<body>

<header>
  <div class="header-left">
    <h1>🚢 Fleet Reefer Monitor</h1>
    <div class="badge"><div class="dot"></div>Live Stream</div>
  </div>
</header>

<div class="stats-row">
  <div class="stat">
    <div class="lbl">Containers</div>
    <div class="val" id="s-fleet" style="color:var(--blue)">${FLEET.length}</div>
  </div>
  <div class="stat">
    <div class="lbl">Active Alerts</div>
    <div class="val" id="s-alerts" style="color:var(--red)">0</div>
  </div>
  <div class="stat">
    <div class="lbl">Total Readings</div>
    <div class="val" id="s-readings" style="color:var(--green)">0</div>
  </div>
  <div class="stat">
    <div class="lbl">Critical Now</div>
    <div class="val" id="s-critical" style="color:var(--orange)">0</div>
  </div>
</div>

<div class="panel">
  <div class="panel-header">Fleet Status <span id="fleet-sub"></span></div>
  <table>
    <thead><tr>
      <th>Container ID</th>
      <th>Cargo</th>
      <th>Temp °C</th>
      <th>Threshold</th>
      <th>Humidity %</th>
      <th>GPS</th>
      <th>Last Seen</th>
      <th>Status</th>
    </tr></thead>
    <tbody id="fleet-body">
      ${FLEET.map(c => `
      <tr id="row-${c.id.replace(/-/g,'_')}">
        <td class="id-cell">${c.id}</td>
        <td class="cargo-cell">${c.cargo}</td>
        <td class="temp-ok" id="t-${c.id.replace(/-/g,'_')}">—</td>
        <td style="color:var(--muted)">${c.threshold}°C</td>
        <td class="hum-val" id="h-${c.id.replace(/-/g,'_')}">—</td>
        <td class="gps-val" id="g-${c.id.replace(/-/g,'_')}">—</td>
        <td style="color:var(--muted);font-size:.75rem" id="ts-${c.id.replace(/-/g,'_')}">—</td>
        <td id="st-${c.id.replace(/-/g,'_')}"><span class="pill pill-waiting">Waiting</span></td>
      </tr>`).join('')}
    </tbody>
  </table>
</div>

<div class="panel">
  <div class="panel-header">Fleet Alerts <span id="alrt-sub"></span></div>
  <ul class="alerts-list" id="alerts-list">
    <li class="no-alerts">No alerts yet — all containers within thresholds.</li>
  </ul>
</div>

<script>
  let totalAlerts   = 0;
  let totalReadings = 0;

  const sAlerts   = document.getElementById('s-alerts');
  const sReadings = document.getElementById('s-readings');
  const sCritical = document.getElementById('s-critical');
  const fleetSub  = document.getElementById('fleet-sub');
  const alrtSub   = document.getElementById('alrt-sub');
  const alertsList= document.getElementById('alerts-list');

  function key(id) { return id.replace(/-/g, '_'); }
  function fmtTime(iso) { return new Date(iso).toLocaleTimeString(); }

  function countCritical() {
    return document.querySelectorAll('.pill-critical').length;
  }

  const src = new EventSource('/events');

  src.onmessage = (e) => {
    const { type, payload } = JSON.parse(e.data);

    if (type === 'telemetry') {
      const k   = key(payload.id);
      const hot = payload.temperature > payload.threshold;

      const tEl  = document.getElementById('t-'  + k);
      const hEl  = document.getElementById('h-'  + k);
      const gEl  = document.getElementById('g-'  + k);
      const tsEl = document.getElementById('ts-' + k);
      const stEl = document.getElementById('st-' + k);

      if (tEl) {
        tEl.textContent = payload.temperature.toFixed(2);
        tEl.className   = hot ? 'temp-hot' : 'temp-ok';
      }
      if (hEl)  hEl.textContent  = payload.humidity.toFixed(2);
      if (gEl)  gEl.textContent  = payload.gps.lat + ', ' + payload.gps.lng;
      if (tsEl) tsEl.textContent = fmtTime(payload.timestamp);
      if (stEl) stEl.innerHTML   = hot
        ? '<span class="pill pill-critical">Critical</span>'
        : '<span class="pill pill-ok">OK</span>';

      totalReadings = payload.totalReadings || (totalReadings + 1);
      sReadings.textContent = totalReadings;
      sCritical.textContent = countCritical();
      fleetSub.textContent  = totalReadings + ' readings';
    }

    if (type === 'alert') {
      totalAlerts++;
      sAlerts.textContent  = totalAlerts;
      sCritical.textContent = countCritical();
      alrtSub.textContent  = totalAlerts + ' total';

      const placeholder = alertsList.querySelector('.no-alerts');
      if (placeholder) placeholder.remove();

      const li = document.createElement('li');
      li.innerHTML =
        '<span class="alert-icon">🚨</span>' +
        '<div class="alert-body">' +
          '<div class="alert-id">' + payload.id + ' — ' + payload.cargo + '</div>' +
          '<div class="alert-msg">' + payload.msg + '</div>' +
          '<div class="alert-time">' + fmtTime(payload.time) + '</div>' +
        '</div>';
      alertsList.prepend(li);
      while (alertsList.children.length > 30) alertsList.removeChild(alertsList.lastChild);
    }
  };

  src.onerror = () => console.warn('SSE reconnecting…');
</script>
</body>
</html>`;

// ─── HTTP Server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
    if (req.url === '/events') {
        res.writeHead(200, {
            'Content-Type':  'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection':    'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });
        res.write('retry: 3000\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(HTML);
});

const PORT = 5000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Fleet Reefer Dashboard → http://0.0.0.0:${PORT}`);
    console.log(`Monitoring ${FLEET.length} containers...`);
    FLEET.forEach(c => console.log(`  · ${c.id}  ${c.cargo}  (threshold ${c.threshold}°C)`));
});
