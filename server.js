// imports
const express = require("express");
const ds18b20 = require("ds18b20");
const GPIO = require("onoff").Gpio;
const bodyParser = require("body-parser");
const fsPromises = require("fs").promises;
const { Client } = require("pg");
require("dotenv").config();

// Constants
const app = express();
const PORT = 3000;
const SETPOINT_TOLERANCE_DEFAULT = 0.5; // degrees C either side of set point
const HEATING_RATE_SECS_PER_DEGREE_DEFAULT = 100; // Default value in seconds per degree
const COOLING_RATE_SECS_PER_DEGREE_DEFAULT = 800;  // seconds required to decrease 1°C
const EVENT_LOOP_INTERVAL = 10000; // milliseconds
const HEATER_RELAY = new GPIO(2, "out");
HEATER_RELAY.writeSync(1);  // turn off heater immediately (GPIO pin is *on* by default)
const SENSOR_ID = process.env.DS18B20_SENSOR_ID;

// db setup
const client = new Client({ host: "localhost", database: "pivide", user: process.env.dbuser, password: process.env.dbpassword, port: 5432 });

// Middleware setup
app.use(express.static("public"));
app.use(bodyParser.json());

// Global state variables
let targetTemperature;  // The desired temperature to maintain
let SETPOINT_TOLERANCE = SETPOINT_TOLERANCE_DEFAULT; // This will be the modifiable value
let CONTROL_STATE = "Off"; // state of control loop
let HEATING_RATE_SECS_PER_DEGREE = HEATING_RATE_SECS_PER_DEGREE_DEFAULT; // This will be the modifiable value
let COOLING_RATE_SECS_PER_DEGREE = COOLING_RATE_SECS_PER_DEGREE_DEFAULT;
let timeLeftInWaitingPhase = 0;


// internal functions
async function connectToDatabase() {
    try {
        await client.connect(); // This is an asynchronous operation
        console.log("Connected to the database");
        return true;
    } catch (err) {
        console.error("Error connecting to the database:", err);
        return false;
    }
}

async function sendToDB(type, data) {
    let query;
    let values;
    try {
        query = generateInsertQuery(type, data);
    } catch (error) {
        console.log(error);
        throw error;
    }

    try {
        values = generateInsertValues(type, data);
    } catch (error) {
        console.log(error);
        throw error;
    }

    try {
        client.query(query, values);
    } catch (error) {
        console.log(error);
        throw error;
    }
}

function generateInsertQuery(type) {
    switch (type) {
    case "temperature":
        return "INSERT INTO temperatures(temperature) VALUES($1)";
    default:
        throw "No matching insert type";
    }
}

function generateInsertValues(type, data) {
    switch (type) {
    case "temperature":
        return [data];
    default:
        throw "No matching insert type";
    }
}

function readTemperature() {
    return new Promise((resolve, reject) => {
        ds18b20.temperature(SENSOR_ID, (err, value) => {
            if (err) {
                console.error(`Error reading temperature: ${err}`);
                reject("Error");
            } else {
                resolve(value);
            }
        });
    });
}

async function logMessage(message) {
    try {
        const logEntry = `${new Date().toISOString()}: ${message}\n`;
        await fsPromises.appendFile("./public/log.txt", logEntry);
        return true;
    } catch (error) {
        console.error(`Error logging message: ${error}`);
        throw error;
    }
}

async function eventLoop() {
    const currentTemperature = await readTemperature();
    const HEATER_GAIN = 1 / HEATING_RATE_SECS_PER_DEGREE; // Define the heater's gain (inverse of the seconds/degree to get deg/sec)
    const HEATING_INERTIA_DURATION = 200; // Define the duration for heating inertia (the time the system takes to react to the heater being turned off)
    const SMALL_HEAT_BURST_DURATION = 60; // about 0.5C
    const LARGE_HEAT_BURST_DURATION = 120; // about 1C
    const upperThreshold = targetTemperature + SETPOINT_TOLERANCE;
    const lowerThreshold = targetTemperature - SETPOINT_TOLERANCE;
    const maxTemperatureRiseIfHeaterTurnedOffNow = HEATER_GAIN * HEATING_INERTIA_DURATION;
    const temperatureIfHeaterTurnedOffNow = currentTemperature + maxTemperatureRiseIfHeaterTurnedOffNow;

    // log current temperature
    // delete this txt log once we're up and running with the db
    try {
        await logMessage(`Current temperature: ${currentTemperature}`);
    } catch (error) {
        console.error(`Error logging temperature: ${error}`);
    }

    try {
        await sendToDB("temperature", currentTemperature);
    } catch (error) {
        console.error(`Error inserting temperature into DB: ${error}`);
    }

    //
    // control loop
    //

    // if we're in a waiting period, log it and do nothing
    if (timeLeftInWaitingPhase > 0) {
        const heaterState = HEATER_RELAY.readSync() === 0 ? "On" : "Off";
        try {
            await logMessage(`${CONTROL_STATE}|Time left in waiting phase: ${timeLeftInWaitingPhase}|Heater state: ${heaterState}`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
        timeLeftInWaitingPhase -= EVENT_LOOP_INTERVAL;
    }

    // no setpoint set
    else if (CONTROL_STATE == "Off" && !targetTemperature) {
        try {
            await logMessage(`${CONTROL_STATE}`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }

    // if a setpoint has been set, transition into an "on" state
    else if (CONTROL_STATE == "Off" && targetTemperature) {
        const PREVIOUS_STATE = CONTROL_STATE;
        CONTROL_STATE = "Initial Heating";
        try {
            await logMessage(`${PREVIOUS_STATE} --> ${CONTROL_STATE}|Target Temperature: ${targetTemperature}`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }

    }

    // if we're in the initial heating phase, and we won't overshoot the upper limit, turn the heater on
    else if (CONTROL_STATE == "Initial Heating" && temperatureIfHeaterTurnedOffNow <= upperThreshold) {
        HEATER_RELAY.writeSync(0);  // turn on heater
        try {
            await logMessage(`${CONTROL_STATE}|Tmax: ${temperatureIfHeaterTurnedOffNow}|Heater ON`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }

    // we're in the initial heating phase, but we're on track to overshoot the upper limit, turn the heater off and set an inertia timer
    else if (CONTROL_STATE == "Initial Heating" && temperatureIfHeaterTurnedOffNow > upperThreshold) {
        const PREVIOUS_STATE = CONTROL_STATE;
        HEATER_RELAY.writeSync(1);  // turn off heater
        CONTROL_STATE = "Inertia Phase";
        timeLeftInWaitingPhase = HEATING_INERTIA_DURATION;
        try {
            await logMessage(`${PREVIOUS_STATE} --> ${CONTROL_STATE}|Tmax: ${temperatureIfHeaterTurnedOffNow}|Heater OFF|Heating inertia time set: ${timeLeftInWaitingPhase}`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }

    // when the inertia timer has finished, enter the control phase
    else if (CONTROL_STATE == "Inertia Phase" && timeLeftInWaitingPhase <= 0) {
        const PREVIOUS_STATE = CONTROL_STATE;
        CONTROL_STATE = "Control Phase";
        try {
            await logMessage(`${PREVIOUS_STATE} --> ${CONTROL_STATE}`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }

    // if we're in the control phase and the temp is above the target, do nothing
    else if (CONTROL_STATE == "Control Phase" && currentTemperature > targetTemperature) {
        try {
            await logMessage(`${CONTROL_STATE}|${currentTemperature} is above ${targetTemperature}|Doing nothing`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }

    // if we're in the control phase and the temp is between the target and lower threshold, do a small heat burst
    else if (CONTROL_STATE == "Control Phase" && currentTemperature >= lowerThreshold && currentTemperature <= targetTemperature) {
        const PREVIOUS_STATE = CONTROL_STATE;
        CONTROL_STATE = "Small Heat Burst";
        HEATER_RELAY.writeSync(0);  // turn on heater
        timeLeftInWaitingPhase = SMALL_HEAT_BURST_DURATION;
        try {
            await logMessage(`${PREVIOUS_STATE} --> ${CONTROL_STATE}|${currentTemperature} is between ${targetTemperature} and ${lowerThreshold}|Heater ON`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }

    else if (CONTROL_STATE == "Control Phase" && currentTemperature < lowerThreshold) {
        const PREVIOUS_STATE = CONTROL_STATE;
        CONTROL_STATE = "Large Heat Burst";
        HEATER_RELAY.writeSync(0);  // turn on heater
        timeLeftInWaitingPhase = LARGE_HEAT_BURST_DURATION;
        try {
            await logMessage(`${PREVIOUS_STATE} --> ${CONTROL_STATE}|${currentTemperature} is below ${lowerThreshold}|Heater ON`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }

    // we've finished the heat burst, go into a heating inertia phase
    else if (CONTROL_STATE == "Small Heat Burst" || CONTROL_STATE == "Large Heat Burst") {
        const PREVIOUS_STATE = CONTROL_STATE;
        CONTROL_STATE = "Inertia Phase";
        HEATER_RELAY.writeSync(1);  // turn off heater
        timeLeftInWaitingPhase = HEATING_INERTIA_DURATION;
        try {
            await logMessage(`${PREVIOUS_STATE} --> ${CONTROL_STATE}|Heater OFF|Heating inertia time set: ${timeLeftInWaitingPhase}`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }

    else {
        try {
            await logMessage(`Reached a state with no actions|State: ${CONTROL_STATE}|Current Temp: ${currentTemperature}|Target temp: ${targetTemperature}|Tmax: ${temperatureIfHeaterTurnedOffNow}|Time in waiting phase: ${timeLeftInWaitingPhase}`);
        } catch (error) {
            console.error(`Error writing to log ${error}`);
        }
    }
    setTimeout(eventLoop, EVENT_LOOP_INTERVAL);
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

app.post("/log", async (req, res) => {
    try {
        const { message } = req.body;
        await logMessage(`CLIENT: ${message}`);
        res.json({ success: true });
    } catch (error) {
        console.error(`Error logging client message: ${error}`);
        res.status(500).send("Failed to log client message.");
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

app.post("/setpoint", async (req, res) => {
    targetTemperature = req.body.temperature;
    CONTROL_STATE = "Off";
    res.json({ message: "Temperature set" });
});

app.get("/status", async (req, res) => {
    const heaterState = HEATER_RELAY.readSync() === 0 ? "On" : "Off";
    let currentTemperatureValue;
    const currentTargetTemperature = targetTemperature || 0;
    const currentTolerance = SETPOINT_TOLERANCE;

    try {
        currentTemperatureValue = await readTemperature();
    } catch (error) {
        console.error("Error reading temperature for status:", error);
        currentTemperatureValue = "Error";
    }

    res.json({
        heaterState,
        controlState: CONTROL_STATE,
        targetTemperature: currentTargetTemperature,
        tolerance: currentTolerance,
        temperature: currentTemperatureValue,
        heatingRate: HEATING_RATE_SECS_PER_DEGREE,
        coolingRate: COOLING_RATE_SECS_PER_DEGREE
    });
});

app.post("/tolerance", (req, res) => {
    const { tolerance } = req.body;
    if (typeof tolerance === "number" && tolerance > 0) {
        SETPOINT_TOLERANCE = tolerance;
        res.json({ success: true, message: `Tolerance updated successfully to ${tolerance}` });
    } else {
        res.status(400).json({ success: false, message: `Invalid tolerance value ${tolerance}` });
    }
});

app.post("/heatingRate", (req, res) => {
    const { heatingRate } = req.body;

    if (typeof heatingRate === "number" && heatingRate > 0) {
        HEATING_RATE_SECS_PER_DEGREE = heatingRate;
        logMessage(`Heating rate updated successfully to ${heatingRate} secs/°C`);
        res.json({ success: true, message: `Heating rate updated successfully to ${heatingRate} secs/°C` });
    } else {
        res.status(400).json({ success: false, message: `Invalid heating rate value ${heatingRate}` });
    }
});

app.post("/coolingRate", (req, res) => {
    const { coolingRate } = req.body;

    if (typeof coolingRate === "number" && coolingRate > 0) {
        COOLING_RATE_SECS_PER_DEGREE = coolingRate;
        logMessage(`Cooling rate updated successfully to ${coolingRate} secs/°C`);
        res.json({ success: true, message: `Cooling rate updated successfully to ${coolingRate} secs/°C` });
    } else {
        res.status(400).json({ success: false, message: `Invalid cooling rate value ${coolingRate}` });
    }
});

app.get("/temperatureHistory", async (req, res) => {
    const timeRangeMinutes = req.query.timeRange || 60;  // Default to 5 minutes
    const points = req.query.points || 400;  // Default to 400 points
    const intervalSeconds = (timeRangeMinutes * 60) / points;

    let query = `
        SELECT 
            date_trunc('second', (timestamp - timestamp % interval '${intervalSeconds} seconds')) as time, 
            AVG(temperature)
        FROM temperatures
        WHERE timestamp >= NOW() - INTERVAL '${timeRangeMinutes} minutes'
        GROUP BY time
        ORDER BY time DESC
    `;

    try {
        const result = await client.query(query);
        res.json({ temperatures: result.rows });
    } catch (error) {
        res.status(500).json({ message: "Error fetching temperature history: " + error.message });
    }
});



// Cleanup code to release GPIO pins upon program exit
function cleanupAndExit() {

    HEATER_RELAY.writeSync(1);
    HEATER_RELAY.unexport();

    logMessage("Released the GPIO pin. Exiting now...")
        .then(() => {
            console.log("Released the GPIO pin. Exiting now...");
            process.exit(0);
        })
        .catch(err => {
            console.error("Error logging the exit message", err);
            process.exit(1);
        });
}

// Handling shutdowns gracefully
process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);

// start express server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

connectToDatabase();
eventLoop();
