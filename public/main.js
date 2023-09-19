const UPDATE_INTERVAL = 3000; // milliseconds

// Functions
function controlHeat(command) {
    fetch("/heater", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ command: command }),
    })
        .then(response => response.json())
        .then(data => {
            document.getElementById("heaterState").textContent = data.heaterState;
        })
        .catch(error => {
            logToServer(`Error setting heater state: ${error}`);
        });
}

function setSetpoint() {
    const temperatureValue = document.getElementById("targetTemperatureInput").value;
    fetch("/setpoint", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ temperature: parseFloat(temperatureValue) })
    })
        .then(response => response.json())
        .then(
            document.getElementById("targetTemperatureDisplay").textContent = parseFloat(temperatureValue).toFixed(1)
        );
}

function clearSetpoint() {
    fetch("/setpoint", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ temperature: null })
    })
        .then(response => response.json())
        .then(
            document.getElementById("targetTemperatureDisplay").textContent = "N/A"
        );
}

function updateAllStatuses() {
    fetch("/status")
        .then(response => response.json())
        .then(data => {
            document.getElementById("temperature").textContent = parseFloat(data.temperature).toFixed(1);
            document.getElementById("controlState").textContent = data.controlState;
            document.getElementById("heaterState").textContent = data.heaterState;
            document.getElementById("targetTemperatureDisplay").textContent = parseFloat(data.targetTemperature).toFixed(1);
            document.getElementById("toleranceDisplay").textContent = parseFloat(data.tolerance).toFixed(1);
            document.getElementById("heatingRateDisplay").textContent = parseFloat(data.heatingRate).toFixed(1);
            document.getElementById("coolingRateDisplay").textContent = parseFloat(data.coolingRate).toFixed(1);
        })
        .catch(error => {
            logToServer(`Error fetching statuses: ${error}`);
        });
}

function logToServer(message) {
    fetch("/log", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: message }),
    })
        .catch(error => {
            console.error("Failed to log to server:", error);
        });
}

function setTolerance() {
    const newTolerance = parseFloat(document.getElementById("toleranceInput").value);
    fetch("/tolerance", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ tolerance: newTolerance })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                console.log(data.message);
                logToServer(data.message);
            } else {
                console.error(data.message);
                logToServer("Error updating tolerance: " + data.message);
            }
        })
        .catch(error => {
            console.error("Error updating tolerance:", error);
            logToServer("Error updating tolerance: " + error.message);
        });
}

function setHeatingRate() {
    const heatingRateValue = document.getElementById("heatingRateInput").value;
    fetch("/heatingRate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ heatingRate: parseFloat(heatingRateValue) })
    })
        .then(response => response.json())
        .then(data => {
            console.log(data.message);
            document.getElementById("heatingRateDisplay").textContent = parseFloat(heatingRateValue).toFixed(1);
        });
}

function setCoolingRate() {
    const coolingRateValue = document.getElementById("coolingRateInput").value;
    fetch("/coolingRate", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ coolingRate: parseFloat(coolingRateValue) })
    })
        .then(response => response.json())
        .then(data => {
            console.log(data.message);
            document.getElementById("coolingRateDisplay").textContent = parseFloat(coolingRateValue).toFixed(1);
        });
}

// Event listeners
document.getElementById("refreshValues").addEventListener("click", updateAllStatuses);
document.getElementById("heaterOn").addEventListener("click", function () { controlHeat("on"); });
document.getElementById("heaterOff").addEventListener("click", function () { controlHeat("off"); });
document.getElementById("setTolerance").addEventListener("click", setTolerance);
document.getElementById("setHeatingRate").addEventListener("click", setHeatingRate);
document.getElementById("setCoolingRate").addEventListener("click", setCoolingRate);
document.getElementById("setSetpoint").addEventListener("click", setSetpoint);
document.getElementById("clearSetpoint").addEventListener("click", clearSetpoint);
document.addEventListener("DOMContentLoaded", updateAllStatuses);


// Set auto updates
setInterval(updateAllStatuses, UPDATE_INTERVAL);