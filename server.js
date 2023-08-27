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
const SETPOINT_TOLERANCE = 1.0; // degrees C either side of set point
const TEMPERATURE_CONTROL_LOOP_INTERVAL = 5; // seconds 
const HEATER_RELAY = new GPIO(2, "out");
HEATER_RELAY.writeSync(1);  // turn off heater immediately (GPIO pin is *on* by default)
const SENSOR_ID = process.env.DS18B20_SENSOR_ID;
app.use(express.static("public"));
app.use(bodyParser.json());

// internal functions
function readTemperature() {
    return new Promise((resolve, reject) => {
        ds18b20.temperature(SENSOR_ID, (err, value) => {
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
        res.json({ message: "Temperature fetched successfully", temperature: temperature });
    } catch (error) {
        res.status(500).json({ message: "Error reading temperature: " + error.message });
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

async function evaluateTemperatureControl(targetTemp) {
    const currentTemperature = parseFloat(await readTemperature());
    const difference = parseFloat((currentTemperature - targetTemp).toFixed(1));
    const distanceToEdgeOfDeadband = Math.abs(parseFloat((difference - SETPOINT_TOLERANCE).toFixed(1)));
    
    if (difference < -SETPOINT_TOLERANCE) {
        return {
            action: "turnOn",
            message: `Target is ${targetTemp}°C, currently ${-difference}°C below threshold (heater on)`
        };
    } else if (difference > SETPOINT_TOLERANCE) {
        return {
            action: "turnOff",
            message: `Target is ${targetTemp}°C, currently ${difference}°C above threshold (heater off)`
        };
    } else {
        return {
            action: "doNothing",
            message: `Target is ${targetTemp}°C, currently ${distanceToEdgeOfDeadband}°C within tolerance (heater unchanged)`
        };
    }
}

let targetTemperature;
let controlInterval;

app.post("/control", async (req, res) => {
    if (req.body.command && req.body.command === "stop") {
        if (controlInterval) {
            clearInterval(controlInterval); // clear the existing interval
            HEATER_RELAY.writeSync(1); //turn off the heater
            controlInterval = null;
            res.json({ message: "Control loop stopped" });
            return;
        }
    }
    targetTemperature = req.body.temperature;
    if (controlInterval) {
        clearInterval(controlInterval); // clear any existing interval
    }
    controlInterval = setInterval(async () => {
        try {
            const { action, message } = await evaluateTemperatureControl(targetTemperature);
            await logMessage(message);
            if (action === "turnOn") {
                HEATER_RELAY.writeSync(0);
            } else if (action === "turnOff") {
                HEATER_RELAY.writeSync(1);
            }
        } catch (error) {
            console.error(`Error in control loop: ${error}`);
        }
    }, (TEMPERATURE_CONTROL_LOOP_INTERVAL * 1000));
    

    res.json({ message: "Temperature set and control loop started" });
});

// Endpoint to get the current status of the system
app.get("/status", async (req, res) => {
    const heaterState = HEATER_RELAY.readSync() === 0 ? "On" : "Off";
    const currentTargetTemperature = targetTemperature || 0;
    let controlStateMessage = "Off";

    // If control loop is active, provide a detailed breakdown of the control state
    if (controlInterval) {
        try {
            const { message } = await evaluateTemperatureControl(currentTargetTemperature);
            controlStateMessage = message;
        } catch (error) {
            controlStateMessage = "Error fetching control state details";
        }
    }    

    res.json({
        heaterState,
        controlState: controlStateMessage,
        targetTemperature: currentTargetTemperature
    });
});



// Cleanup code to release GPIO pins upon program exit
function cleanupAndExit() {
    if (controlInterval) {
        clearInterval(controlInterval);
    }
    HEATER_RELAY.writeSync(1);
    HEATER_RELAY.unexport();

    logMessage("Released the GPIO pin and cleared the interval. Exiting now...")
        .then(() => {
            console.log("Released the GPIO pin and cleared the intervals. Exiting now...");
            process.exit(0);
        })
        .catch(err => {
            console.error("Error logging the exit message", err);
            process.exit(1);
        });
}

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit); // Handling SIGTERM for graceful shutdowns



// start express server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
