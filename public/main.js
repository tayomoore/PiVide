// Fetch and display the temperature
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

// Call the function initially to set the temperature when the page loads
updateTemperature();

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

let loggingInterval;

function startLoggingTemperature() {
    // Start the heater (if not started)
    fetch("/heater", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            state: "on"
        })
    });

    // Start logging the temperature every 30 seconds
    loggingInterval = setInterval(() => {
        fetch("/temperature")
            .then(response => response.json())
            .then(data => {
                // Append to a text file
                fetch("/logTemperature", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        temperature: data.temperature
                    })
                });
            });
    }, 30000);
}

function stopLoggingTemperature() {
    clearInterval(loggingInterval);
    console.log("Stopped logging temperature.");
}


// Event listeners
document.getElementById("refreshTemperature").addEventListener("click", updateTemperature);
document.getElementById("heaterOn").addEventListener("click", function() {controlHeat("on");});
document.getElementById("heaterOff").addEventListener("click", function() {controlHeat("off");});
document.getElementById("startLogging").addEventListener("click", startLoggingTemperature);
document.getElementById("stopLogging").addEventListener("click", stopLoggingTemperature);

// Auto actions
setInterval(updateTemperature, 10000);

