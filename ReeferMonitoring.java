import java.util.*;
import java.time.LocalDateTime;

/**
 * Educational implementation of an IoT-enabled Reefer Monitoring System.
 * Focus: Object-Oriented Design and Encapsulation.
 */

class TelemetryData {
    public final double temperature;
    public final double humidity;
    public final String powerStatus;
    public final LocalDateTime timestamp;

    public TelemetryData(double temperature, double humidity, String powerStatus) {
        this.temperature = temperature;
        this.humidity = humidity;
        this.powerStatus = powerStatus;
        this.timestamp = LocalDateTime.now();
    }

    @Override
    public String toString() {
        return String.format("[%s] Temp: %.1fC, Humidity: %.1f%%, Power: %s", 
            timestamp, temperature, humidity, powerStatus);
    }
}

class ReeferContainer {
    private String id;
    private List<TelemetryData> history;

    public ReeferContainer(String id) {
        this.id = id;
        this.history = new ArrayList<>();
    }

    public void addTelemetry(double temp, double hum, String power) {
        TelemetryData data = new TelemetryData(temp, hum, power);
        history.add(data);
        System.out.println("System Alert: New telemetry received for " + id);
    }

    public TelemetryData getLatestStatus() {
        return history.isEmpty() ? null : history.get(history.size() - 1);
    }
}

public class ReeferMonitoring {
    public static void main(String[] args) {
        Map<String, ReeferContainer> fleet = new HashMap<>();
        
        // Registering a container
        String containerId = "MSC-ZUG-99";
        fleet.put(containerId, new ReeferContainer(containerId));
        
        // Adding data
        ReeferContainer container = fleet.get(containerId);
        container.addTelemetry(2.5, 78.0, "ON");
        container.addTelemetry(2.8, 77.5, "ON");
        
        // Displaying status
        System.out.println("Current Status for " + containerId + ": " + container.getLatestStatus());
    }
}
