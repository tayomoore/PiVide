// functions
function updateTemperature() {
    fetch("/temperature")
        .then(response => response.json())
        .then(data => {
            let formattedTemperature = parseFloat(data.temperature).toFixed(1);
            document.getElementById("temperature").textContent = formattedTemperature;
        })
        .catch(error => {
            console.error("Error fetching temperature:", error);
            document.getElementById("temperature").textContent = "Error fetching temperature.";
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
    fetch("/setTargetTemperature", {
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


// Event listeners
document.getElementById("refreshTemperature").addEventListener("click", updateTemperature);
document.getElementById("heaterOn").addEventListener("click", function() {controlHeat("on");});
document.getElementById("heaterOff").addEventListener("click", function() {controlHeat("off");});
document.getElementById("loggingOn").addEventListener("click", function() {controlLogging("on");});
document.getElementById("loggingOff").addEventListener("click", function() {controlLogging("off");});
document.getElementById("setTargetTemperature").addEventListener("click", function() {controlSetpoint();});


// Auto actions set on page load
updateTemperature();
setInterval(updateTemperature, 10000);