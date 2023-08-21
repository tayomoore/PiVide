// Fetch the temperature from the server
fetch("/temperature")
    .then(response => response.json())
    .then(data => {
        document.getElementById("temperature").textContent = data.temperature;
    });

// Function to fetch and display the temperature
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

// Attach the function to the button's click event
document.getElementById("refreshTemperature").addEventListener("click", updateTemperature);
