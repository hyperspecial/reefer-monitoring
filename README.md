# Reefer Monitoring System - Educational Implementation

This repository contains educational implementations of a **Reefer Monitoring System** (inspired by the MSC iReefer platform). It demonstrates how IoT-enabled shipping containers can be monitored for temperature, humidity, and location across different programming paradigms.

## 🚀 Overview

A "Reefer" is a refrigerated shipping container. Modern logistics uses IoT devices to track these containers in real-time. This project breaks down the core logic into four major programming languages to highlight different software engineering concepts.

## 📂 Project Structure

| File | Language | Educational Focus |
|------|----------|-------------------|
| `reefer_monitoring.py` | Python | **System Design**: Focuses on data modeling and clean API structure. |
| `ReeferMonitoring.java` | Java | **Object-Oriented Programming**: Emphasizes encapsulation, classes, and types. |
| `reefer-monitoring.js` | JavaScript | **Event-Driven Architecture**: Uses Node.js `EventEmitter` for real-time alerts. |
| `reefer_monitoring.cpp` | C++ | **Performance**: Focuses on memory efficiency and fast data logging. |

## 🛠️ Key Features Implemented

1.  **Telemetry Tracking**: Real-time monitoring of temperature, humidity, and GPS.
2.  **Historical Logging**: Storing sensor data over time for audit and analysis.
3.  **Alert Systems**: Basic logic to detect temperature excursions (e.g., if it gets too warm).
4.  **Fleet Management**: Ability to manage multiple containers within a single system.

## 📖 How to Use

### Python
```bash
python3 reefer_monitoring.py
```

### Java
```bash
javac ReeferMonitoring.java
java ReeferMonitoring
```

### Node.js
```bash
node reefer-monitoring.js
```

### C++
```bash
g++ reefer_monitoring.cpp -o reefer_app
./reefer_app
```

---
*This project is for educational purposes and is designed to illustrate software architecture patterns in logistics.*
