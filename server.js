// imports
const express = require("express");
const ds18b20 = require("ds18b20");
const GPIO = require("onoff").Gpio;
const bodyParser = require("body-parser");
const fsPromises = require("fs").promises;
require("dotenv").config();

// Set things up
const app = express();
const PORT = 3000;
app.use(express.static("public"));
app.use(bodyParser.json());
const HEATER_RELAY = new GPIO(2, "out");

// internal functions
function readTemperature() {
    return new Promise((resolve, reject) => {
        const sensorId = process.env.DS18B20_SENSOR_ID;
        ds18b20.temperature(sensorId, (err, value) => {
            if (err) {
                console.error(`Error reading temperature: ${err}`);
                reject("Error");
            } else {
                resolve(value.toString());
            }
        });
    });
}

async function logMessage(message){
    try {
        const logEntry = `${new Date().toISOString()}: ${message}\n`;
        await fsPromises.appendFile("log.txt", logEntry);
        return true;
    } catch (error) {
        console.error(`Error logging message: ${error}`);
        throw error;
    }
}

// external endpoints
app.get("/temperature", async (req, res) => {
    try {
        const temperature = await readTemperature();
        res.json({ "temperature": temperature });
    } catch (error) {
        res.status(500).send("Error reading temperature.");
    }
});


app.post("/heater", async (req, res) => {
    const command = req.body.command;
    if (command === "on") {
        HEATER_RELAY.writeSync(0);  // turn on
        await logMessage("Heater turned ON");
        res.json({ "heaterState": "On" });
    } else if (command === "off") {
        HEATER_RELAY.writeSync(1);  // turn off
        await logMessage("Heater turned OFF");
        res.json({ "heaterState": "Off" });
    } else {
        res.status(400).send("Invalid command");
    }
});

app.post("/logTemperature", async (req, res) => {
    const result = await logMessage(req.body.temperature);
    if (result) {
        res.send({ success: true });
    } else {
        res.status(500).send({ success: false, message: "Error logging temperature" });
    }
});

let loggingInterval;

app.post("/logging", async (req, res) => {
    const command = req.body.command;
    if (command === "on" && !loggingInterval) {
        loggingInterval = setInterval(async () => {
            try {
                const temperature = await readTemperature();
                await logMessage(temperature);
            } catch (error) {
                console.error(`Error logging temperature: ${error}`);
            }
        }, 30000);
        res.json({ "loggingState": "Logging started" });
    } else if (command === "on" && loggingInterval) {
        res.json({ "loggingState": "Logging already started" });
    } else if (command === "off") {
        clearInterval(loggingInterval);
        loggingInterval = null;
        res.json({ "loggingState": "Logging stopped" });
    } else {
        res.status(400).send("Invalid command");
    }
});


// Cleanup code to release GPIO pins upon program exit
process.on("SIGINT", function () {
    if (loggingInterval) {
        clearInterval(loggingInterval);
    }
    HEATER_RELAY.writeSync(1); // Set pin to HIGH before exiting
    HEATER_RELAY.unexport();   // Unexport pin

    logMessage("\nReleased the GPIO pin and cleared the interval. Exiting now...")
        .then(() => {
            console.log("\nReleased the GPIO pin and cleared the interval. Exiting now...");
            process.exit(0); // Exit the application
        })
        .catch(err => {
            console.error("Error logging the exit message:", err);
            process.exit(1); // Exit with error status
        });
});


// start express server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
