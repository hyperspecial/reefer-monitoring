#include <iostream>
#include <vector>
#include <string>
#include <ctime>
#include <iomanip>

/**
 * Educational implementation of an IoT-enabled Reefer Monitoring System.
 * Focus: Memory Management and Performance.
 */

struct SensorData {
    float temperature;
    float humidity;
    std::string timestamp;
};

class ReeferContainer {
private:
    std::string id;
    std::vector<SensorData> logs;

public:
    ReeferContainer(std::string containerId) : id(containerId) {}

    void logData(float temp, float hum) {
        std::time_t now = std::time(nullptr);
        char buf[20];
        std::strftime(buf, sizeof(buf), "%Y-%m-%d %H:%M:%S", std::localtime(&now));
        
        SensorData data = {temp, hum, std::string(buf)};
        logs.push_back(data);
        
        std::cout << "[C++] Logged: " << id << " | Temp: " << temp << "C | Time: " << buf << std::endl;
    }

    void printHistory() const {
        std::cout << "\n--- History for " << id << " ---" << std::endl;
        for (const auto& entry : logs) {
            std::cout << entry.timestamp << " -> Temp: " << entry.temperature << "C, Hum: " << entry.humidity << "%" << std::endl;
        }
    }
};

int main() {
    // High-performance vector to manage containers
    std::vector<ReeferContainer> fleet;
    fleet.emplace_back("MSC-CPP-001");
    fleet.emplace_back("MSC-CPP-002");

    // Simulate data logging
    fleet[0].logData(4.5f, 80.2f);
    fleet[0].logData(4.7f, 79.8f);
    
    fleet[0].printHistory();

    return 0;
}
