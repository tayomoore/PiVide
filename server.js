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
const SETPOINT_TOLERANCE = 2; //degrees C
const TEMPERATURE_CONTROL_LOOP_INTERVAL = 10; // seconds 
const HEATER_RELAY = new GPIO(2, "out");
HEATER_RELAY.writeSync(1);  // turn off heater immediately (GPIO pin is *on* by default)
app.use(express.static("public"));
app.use(bodyParser.json());

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
        if (loggingInterval) {  // Check if logging is enabled
            await logMessage("Heater turned ON");
        }
        res.json({ "heaterState": "On" });
    } else if (command === "off") {
        HEATER_RELAY.writeSync(1);  // turn off
        if (loggingInterval) {  // Check if logging is enabled
            await logMessage("Heater turned OFF");
        }
        res.json({ "heaterState": "Off" });
    } else {
        res.status(400).send("Invalid command");
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

let targetTemperature;
let controlInterval;

app.post("/control", (req, res) => {
    targetTemperature = req.body.temperature;
    if (controlInterval) clearInterval(controlInterval); // clear any existing interval

    controlInterval = setInterval(async () => {
        try {
            const currentTemperature = await readTemperature();

            if (currentTemperature < targetTemperature - SETPOINT_TOLERANCE) {
                // Turn on the heater
                await logMessage(`currentTemperature: ${currentTemperature}, less than lower limit: ${(targetTemperature - SETPOINT_TOLERANCE)}, heater ON`);
                HEATER_RELAY.writeSync(0);
            } else if (currentTemperature > targetTemperature + SETPOINT_TOLERANCE) {
                // Turn off the heater
                await logMessage(`currentTemperature: ${currentTemperature}, greater than upper limit: ${(targetTemperature + SETPOINT_TOLERANCE)}, heater OFF`);
                HEATER_RELAY.writeSync(1);
            }
        } catch (error) {
            console.error(`Error in control loop: ${error}`);
        }
    }, (TEMPERATURE_CONTROL_LOOP_INTERVAL * 1000));

    res.json({ message: "Temperature set and control loop started" });
});

app.get("/status", (req, res) => {
    const heaterState = HEATER_RELAY.readSync() === 0 ? "On" : "Off";
    const loggingState = loggingInterval ? "On" : "Off";
    const controlState = controlInterval ? "On" : "Off";
    const targetTemperature = targetTemperature;

    res.json({
        heaterState,
        loggingState,
        controlState,
        targetTemperature
    });
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
