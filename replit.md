# Reefer Monitoring System

An educational, polyglot implementation of an IoT-enabled Reefer (refrigerated shipping container) Monitoring System. Demonstrates telemetry tracking, historical logging, and alert systems across four programming languages — plus a live web dashboard.

## Project Structure

| File | Language | Focus |
|------|----------|-------|
| `dashboard.js` | Node.js | **Live web dashboard** — fleet monitoring, SSE, charts |
| `reefer-monitoring.js` | Node.js | Event-Driven Architecture (original console script) |
| `reefer_monitoring.py` | Python | System Design & Data Modeling |
| `ReeferMonitoring.java` | Java | Object-Oriented Programming |
| `reefer_monitoring.cpp` | C++ | Memory Efficiency & Performance |

## Web Dashboard (default)

The main workflow runs `dashboard.js` on port 5000. Features:

- **Fleet overview table** — 6 containers, each with cargo type, live temp, humidity, GPS
- **Inline sparkline charts** — 30-reading temperature history per container
- **Trend indicators** — ↑ rising / ↓ falling / — stable
- **Min / Max / Avg stats** — per container, updated live
- **Click any row** — opens a detail panel with a full SVG temperature chart and threshold line
- **Filter bar** — view All / OK / Critical containers
- **Fleet Alerts log** — every threshold breach logged with timestamp
- **Toast notifications** — on-screen popup for each critical alert
- **Browser notifications** — native OS alerts (if permission granted)
- **JSON API** — `GET /api/fleet` returns current fleet snapshot

## Fleet

| Container | Cargo | Threshold |
|-----------|-------|-----------|
| MSC-IOT-101 | 🥦 Fresh Produce | 5.5°C |
| MSC-IOT-202 | 🧀 Dairy | 5.0°C |
| MSC-IOT-303 | 🐟 Frozen Seafood | 2.0°C |
| MSC-IOT-404 | 💊 Pharmaceuticals | 6.0°C |
| MSC-IOT-505 | 🍺 Beverages | 7.5°C |
| MSC-IOT-606 | 🥩 Meat & Poultry | 3.5°C |

## Running Console Scripts

### Python
```bash
python3 reefer_monitoring.py
```

### Java
```bash
javac ReeferMonitoring.java && java ReeferMonitoring
```

### C++
```bash
g++ reefer_monitoring.cpp -o reefer_app && ./reefer_app
```

### Node.js (original console script)
```bash
node reefer-monitoring.js
```

## User Preferences

- Dashboard is the primary entry point; console scripts remain for educational reference.
