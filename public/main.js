const UPDATE_INTERVAL = 10000; // 10 seconds

// Functions
function updateTemperature() {
    fetch("/temperature")
        .then(response => response.json())
        .then(data => {
            const formattedTemperature = parseFloat(data.temperature).toFixed(1);
            document.getElementById("temperature").textContent = formattedTemperature;
        })
        .catch(error => {
            console.error("Error fetching temperature:", error);
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
            console.log(data);
            document.getElementById("heaterState").textContent = data.heaterState;
        })
        .catch(error => {
            console.error("Error:", error);
        });
}

function controlLogging(command) {
    fetch("/logging", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ command: command }),
    })
        .then(response => response.json())
        .then(data => {
            console.log(data);
            document.getElementById("loggingState").textContent = data.loggingState;
        })
        .catch(error => {
            console.error("Error:", error);
        });
}

function controlSetpoint() {
    const temperature = document.getElementById("targetTemperature").value;
    fetch("/control", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ temperature: parseFloat(temperature) })
    })
        .then(response => response.json())
        .then(data => {
            console.log(data.message);
            document.getElementById("controlState").textContent = data.message;
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
        .then(data => {
            console.log(data.message);
            updateAllStatuses();
        });
}

function updateAllStatuses() {
    fetch("/status")
        .then(response => response.json())
        .then(data => {
            document.getElementById("heaterState").textContent = data.heaterState;
            document.getElementById("loggingState").textContent = data.loggingState;
            document.getElementById("controlState").textContent = data.controlState;
            document.getElementById("targetTemperature").value = data.targetTemperature;
            document.getElementById("temperature").textContent = parseFloat(data.temperature).toFixed(1);
        })
        .catch(error => {
            console.error("Error fetching statuses", error);
        });
}


// Event listeners
document.getElementById("refreshTemperature").addEventListener("click", updateTemperature);
document.getElementById("heaterOn").addEventListener("click", function() {controlHeat("on");});
document.getElementById("heaterOff").addEventListener("click", function() {controlHeat("off");});
document.getElementById("loggingOn").addEventListener("click", function() {controlLogging("on");});
document.getElementById("loggingOff").addEventListener("click", function() {controlLogging("off");});
document.getElementById("setTargetTemperature").addEventListener("click", function() {controlSetpoint();});
document.getElementById("stopControlLoop").addEventListener("click", function() {stopControlLoop();});
document.addEventListener("DOMContentLoaded", function() {updateAllStatuses();});


// Set auto updates
setInterval(updateAllStatuses, UPDATE_INTERVAL);