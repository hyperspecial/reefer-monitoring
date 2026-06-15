/**
 * Reefer Monitoring System — Web Dashboard
 * Serves a live telemetry dashboard on port 5000 using SSE.
 */

const http = require('http');
const EventEmitter = require('events');

// ─── Reefer IoT Core ────────────────────────────────────────────────────────

class ReeferIoT extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        this.active = true;
    }

    sendTelemetry() {
        if (!this.active) return;
        const data = {
            id: this.id,
            timestamp: new Date().toISOString(),
            temperature: parseFloat((Math.random() * 5 + 2).toFixed(2)),
            humidity: parseFloat((Math.random() * 20 + 70).toFixed(2)),
            gps: {
                lat: parseFloat((Math.random() * 180 - 90).toFixed(4)),
                lng: parseFloat((Math.random() * 360 - 180).toFixed(4))
            }
        };
        this.emit('telemetry', data);
        return data;
    }
}

// ─── State ───────────────────────────────────────────────────────────────────

const history = [];          // last 50 readings
const alerts = [];           // last 20 alerts
const sseClients = new Set();

const monitoringCenter = new EventEmitter();
const myReefer = new ReeferIoT('MSC-IOT-404');

monitoringCenter.on('alert', (msg) => {
    const entry = { time: new Date().toISOString(), msg };
    alerts.unshift(entry);
    if (alerts.length > 20) alerts.pop();
    broadcast({ type: 'alert', payload: entry });
});

myReefer.on('telemetry', (data) => {
    history.unshift(data);
    if (history.length > 50) history.pop();
    broadcast({ type: 'telemetry', payload: data });

    if (data.temperature > 6.0) {
        monitoringCenter.emit('alert',
            `Container ${data.id} temperature critical: ${data.temperature}°C`);
    }
});

setInterval(() => myReefer.sendTelemetry(), 2000);

// ─── SSE broadcast ───────────────────────────────────────────────────────────

function broadcast(obj) {
    const line = `data: ${JSON.stringify(obj)}\n\n`;
    for (const res of sseClients) {
        try { res.write(line); } catch (_) { sseClients.delete(res); }
    }
}

// ─── HTML ─────────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Reefer Monitor</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d1117;
    --card: #161b22;
    --border: #30363d;
    --text: #e6edf3;
    --muted: #8b949e;
    --blue: #58a6ff;
    --green: #3fb950;
    --red: #f85149;
    --yellow: #d29922;
    --orange: #e3b341;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
    padding: 24px 20px;
  }

  header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 28px;
  }
  header h1 { font-size: 1.4rem; font-weight: 600; }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    background: #1c2a1c;
    color: var(--green);
    border: 1px solid #2d4a2d;
    border-radius: 20px;
    padding: 3px 10px;
  }
  .dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: var(--green);
    animation: pulse 1.5s infinite;
  }
  @keyframes pulse {
    0%,100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 14px;
    margin-bottom: 28px;
  }
  .stat-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 16px;
  }
  .stat-card .label { font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
  .stat-card .value { font-size: 2rem; font-weight: 700; line-height: 1; }
  .stat-card .unit  { font-size: 0.85rem; color: var(--muted); margin-top: 4px; }
  .temp-ok  { color: var(--blue); }
  .temp-hot { color: var(--red); animation: flash .6s infinite alternate; }
  @keyframes flash { from { opacity: 1; } to { opacity: 0.5; } }
  .hum-val { color: var(--blue); }
  .gps-val { font-size: 1.1rem; color: var(--orange); }

  .panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
  }
  @media (max-width: 680px) { .panels { grid-template-columns: 1fr; } }

  .panel {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .06em;
  }
  .panel-header span { color: var(--muted); font-weight: 400; font-size: 0.75rem; }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }
  thead th {
    background: #0d1117;
    color: var(--muted);
    font-weight: 500;
    text-align: left;
    padding: 8px 14px;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: .05em;
  }
  tbody tr { border-top: 1px solid var(--border); }
  tbody tr:hover { background: #1c2330; }
  tbody td { padding: 7px 14px; }
  .ok  { color: var(--green); }
  .hot { color: var(--red); }

  #alerts-list { list-style: none; max-height: 240px; overflow-y: auto; }
  #alerts-list li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    font-size: 0.83rem;
  }
  #alerts-list li:first-child { border-top: none; }
  .alert-icon { font-size: 1rem; flex-shrink: 0; margin-top: 1px; }
  .alert-time { color: var(--muted); font-size: 0.72rem; white-space: nowrap; }
  .no-alerts  { color: var(--muted); padding: 20px 16px; font-size: 0.85rem; }
</style>
</head>
<body>

<header>
  <h1>🌡️ Reefer Monitor</h1>
  <div class="badge"><div class="dot"></div>Live — MSC-IOT-404</div>
</header>

<div class="grid">
  <div class="stat-card">
    <div class="label">Temperature</div>
    <div class="value temp-ok" id="temp">—</div>
    <div class="unit">°C</div>
  </div>
  <div class="stat-card">
    <div class="label">Humidity</div>
    <div class="value hum-val" id="hum">—</div>
    <div class="unit">%</div>
  </div>
  <div class="stat-card">
    <div class="label">Latitude</div>
    <div class="value gps-val" id="lat">—</div>
    <div class="unit">deg</div>
  </div>
  <div class="stat-card">
    <div class="label">Longitude</div>
    <div class="value gps-val" id="lng">—</div>
    <div class="unit">deg</div>
  </div>
  <div class="stat-card">
    <div class="label">Readings</div>
    <div class="value" id="count" style="color:var(--blue)">0</div>
    <div class="unit">logged</div>
  </div>
  <div class="stat-card">
    <div class="label">Alerts</div>
    <div class="value" id="alert-count" style="color:var(--red)">0</div>
    <div class="unit">triggered</div>
  </div>
</div>

<div class="panels">
  <div class="panel">
    <div class="panel-header">Recent Readings <span id="hist-count"></span></div>
    <table>
      <thead><tr>
        <th>Time</th><th>Temp °C</th><th>Hum %</th>
      </tr></thead>
      <tbody id="hist-body"></tbody>
    </table>
  </div>

  <div class="panel">
    <div class="panel-header">Alerts <span id="alrt-count"></span></div>
    <ul id="alerts-list"><li class="no-alerts">No alerts yet</li></ul>
  </div>
</div>

<script>
  let readingCount = 0;
  let alertCount   = 0;

  const tempEl  = document.getElementById('temp');
  const humEl   = document.getElementById('hum');
  const latEl   = document.getElementById('lat');
  const lngEl   = document.getElementById('lng');
  const cntEl   = document.getElementById('count');
  const aCountEl= document.getElementById('alert-count');
  const histBody= document.getElementById('hist-body');
  const alertsList = document.getElementById('alerts-list');
  const histCount  = document.getElementById('hist-count');
  const alrtCount  = document.getElementById('alrt-count');

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString();
  }

  const src = new EventSource('/events');

  src.onmessage = (e) => {
    const { type, payload } = JSON.parse(e.data);

    if (type === 'telemetry') {
      const hot = payload.temperature > 6.0;
      tempEl.textContent = payload.temperature.toFixed(2);
      tempEl.className   = 'value ' + (hot ? 'temp-hot' : 'temp-ok');
      humEl.textContent  = payload.humidity.toFixed(2);
      latEl.textContent  = payload.gps.lat;
      lngEl.textContent  = payload.gps.lng;

      readingCount++;
      cntEl.textContent = readingCount;
      histCount.textContent = readingCount + ' total';

      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + fmtTime(payload.timestamp) + '</td>' +
        '<td class="' + (hot ? 'hot' : 'ok') + '">' + payload.temperature.toFixed(2) + '</td>' +
        '<td>' + payload.humidity.toFixed(2) + '</td>';
      histBody.prepend(tr);
      // keep last 10 rows visible
      while (histBody.children.length > 10) histBody.removeChild(histBody.lastChild);
    }

    if (type === 'alert') {
      alertCount++;
      aCountEl.textContent = alertCount;
      alrtCount.textContent = alertCount + ' total';

      // remove placeholder
      const placeholder = alertsList.querySelector('.no-alerts');
      if (placeholder) placeholder.remove();

      const li = document.createElement('li');
      li.innerHTML =
        '<span class="alert-icon">🚨</span>' +
        '<div><div>' + payload.msg + '</div>' +
        '<div class="alert-time">' + fmtTime(payload.time) + '</div></div>';
      alertsList.prepend(li);
      while (alertsList.children.length > 20) alertsList.removeChild(alertsList.lastChild);
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
    console.log(`Reefer Dashboard running → http://0.0.0.0:${PORT}`);
    console.log('Streaming telemetry every 2 seconds...');
});
