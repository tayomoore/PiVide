const UPDATE_INTERVAL = 3000; // milliseconds

// Functions
function updateTemperature() {
    fetch("/temperature")
        .then(response => response.json())
        .then(data => {
            const formattedTemperature = parseFloat(data.temperature).toFixed(1);
            document.getElementById("temperature").textContent = formattedTemperature;
        })
        .catch(error => {
            logToServer(`Error fetching temperature: ${error}`);
            document.getElementById("temperature").textContent = "Error: " + error.message;
        });
}


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

function controlSetpoint() {
    const temperatureValue = document.getElementById("targetTemperatureInput").value;
    fetch("/control", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ temperature: parseFloat(temperatureValue) })
    })
        .then(response => response.json())
        .then(data => {
            document.getElementById("controlState").textContent = data.message;
            document.getElementById("setTargetTemperatureDisplay").textContent = parseFloat(temperatureValue).toFixed(1);
        });
}

function stopControlLoop() {
    fetch("/control", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ command: "stop" })
    })
        .then(response => response.json())
        .then(updateAllStatuses());
}

function updateAllStatuses() {
    fetch("/status")
        .then(response => response.json())
        .then(data => {
            document.getElementById("heaterState").textContent = data.heaterState;
            document.getElementById("controlState").textContent = data.controlState;
            document.getElementById("setTargetTemperatureDisplay").textContent = parseFloat(data.targetTemperature).toFixed(1);
            document.getElementById("temperature").textContent = parseFloat(data.temperature).toFixed(1);
        })
        .catch(error => {
            logToServer(`Error fetching statuses clientside: ${error}`);
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

function fetchAndDisplayTolerance() {
    fetch("/tolerance")
        .then(response => response.json())
        .then(data => {
            document.getElementById("toleranceInput").value = data.tolerance;
        })
        .catch(error => {
            logToServer("Error fetching tolerance: " + error.message);
        });
}

function updateTolerance() {
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


// Event listeners
document.getElementById("refreshTemperature").addEventListener("click", updateTemperature);
document.getElementById("heaterOn").addEventListener("click", function() {controlHeat("on");});
document.getElementById("heaterOff").addEventListener("click", function() {controlHeat("off");});
document.getElementById("setTargetTemperature").addEventListener("click", controlSetpoint);
document.getElementById("stopControlLoop").addEventListener("click", stopControlLoop);
document.getElementById("setTolerance").addEventListener("click", updateTolerance);
document.addEventListener("DOMContentLoaded", function() {
    updateAllStatuses();
    fetchAndDisplayTolerance();
});


// Set auto updates
setInterval(updateAllStatuses, UPDATE_INTERVAL);