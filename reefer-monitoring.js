/**
 * Educational implementation of an IoT-enabled Reefer Monitoring System.
 * Focus: Asynchronous Programming and Event-Driven Architecture.
 */

const EventEmitter = require('events');

class ReeferIoT extends EventEmitter {
    constructor(id) {
        super();
        this.id = id;
        this.active = true;
    }

    // Simulates a sensor reading and emits an event
    sendTelemetry() {
        if (!this.active) return;

        const data = {
            id: this.id,
            timestamp: new Date().toISOString(),
            temperature: (Math.random() * 5 + 2).toFixed(2), // 2-7 Celsius
            humidity: (Math.random() * 20 + 70).toFixed(2),  // 70-90%
            gps: {
                lat: (Math.random() * 180 - 90).toFixed(4),
                lng: (Math.random() * 360 - 180).toFixed(4)
            }
        };

        this.emit('telemetry', data);
    }
}

// --- Educational Usage ---

const monitoringCenter = new EventEmitter();

// Handle incoming telemetry events
monitoringCenter.on('alert', (msg) => {
    console.warn(`[ALARM] 🚨 ${msg}`);
});

const myReefer = new ReeferIoT('MSC-IOT-404');

// Subscribe to telemetry
myReefer.on('telemetry', (data) => {
    console.log(`[DATA] Container ${data.id} reporting at ${data.gps.lat}, ${data.gps.lng}`);
    
    // Threshold check
    if (data.temperature > 6.0) {
        monitoringCenter.emit('alert', `Container ${data.id} temperature critical: ${data.temperature}C`);
    }
});

// Simulate continuous monitoring
console.log('Starting Reefer Monitoring Stream...');
setInterval(() => {
    myReefer.sendTelemetry();
}, 2000);
