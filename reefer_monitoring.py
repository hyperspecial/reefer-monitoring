import time
import uuid
from datetime import datetime

class ReeferContainer:
    """
    Educational implementation of an IoT-enabled Reefer Container.
    Focus: System Design and Data Modeling.
    """
    def __init__(self, container_id):
        self.container_id = container_id
        self.status = "Active"
        self.location = {"lat": 0.0, "lng": 0.0}
        self.sensors = {
            "temperature": 4.0,  # Celsius
            "humidity": 85.0,    # Percentage
            "power": "On",       # Power status
            "defrost": "Off"     # Defrost status
        }
        self.logs = []

    def update_telemetry(self, lat, lng, temp, humidity, power="On", defrost="Off"):
        """Simulates IoT device sending data to the cloud."""
        self.location = {"lat": lat, "lng": lng}
        self.sensors.update({
            "temperature": temp,
            "humidity": humidity,
            "power": power,
            "defrost": defrost
        })
        
        entry = {
            "timestamp": datetime.now().isoformat(),
            "location": self.location.copy(),
            "sensors": self.sensors.copy()
        }
        self.logs.append(entry)
        print(f"[IOT] Container {self.container_id} updated: Temp={temp}C, Power={power}")

class MonitoringSystem:
    """Central system to track multiple reefer containers."""
    def __init__(self):
        self.containers = {}

    def register_container(self, container_id):
        if container_id not in self.containers:
            self.containers[container_id] = ReeferContainer(container_id)
            return self.containers[container_id]
    
    def get_real_time_dashboard(self):
        """Returns a snapshot of all active containers."""
        return {cid: c.sensors for cid, c in self.containers.items()}

# --- Educational Demo ---
if __name__ == "__main__":
    system = MonitoringSystem()
    
    # 1. Register a new reefer container
    msc_reefer = system.register_container("MSC-RE-10293")
    
    # 2. Simulate real-time updates
    msc_reefer.update_telemetry(46.2044, 6.1432, 3.8, 82.0) # Geneva location
    time.sleep(0.1)
    msc_reefer.update_telemetry(46.2050, 6.1440, 4.2, 80.0, power="Off") # Alert: Power loss!
    
    # 3. View Dashboard
    print("\n--- System Dashboard ---")
    print(system.get_real_time_dashboard())
