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
const EVENT_LOOP_INTERVAL = 10; // seconds
const HEATER_RELAY = new GPIO(2, "out");
HEATER_RELAY.writeSync(1);  // turn off heater immediately (GPIO pin is *on* by default)
const SENSOR_ID = process.env.DS18B20_SENSOR_ID;
const states = {
    OFF: "Off",
    INITIAL_HEATING: "Initial Heating",
    INERTIA_PHASE: "Inertia Phase",
    CONTROL_PHASE: "Control Phase",
    SMALL_HEAT_BURST: "Small Heat Burst",
    LARGE_HEAT_BURST: "Large Heat Burst"
};

// db setup
const client = new Client({ host: "localhost", database: "pivide", user: process.env.dbuser, password: process.env.dbpassword, port: 5432 });

// Middleware setup
app.use(express.static("public"));
app.use(bodyParser.json());

// Global state variables
let targetTemperature;  // The desired temperature to maintain
let SETPOINT_TOLERANCE = SETPOINT_TOLERANCE_DEFAULT; // This will be the modifiable value
let CONTROL_STATE = states.OFF; // state of control loop
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
        await client.query(query, values);
    } catch (error) {
        console.log(error);
        throw error;
    }
}

function generateInsertQuery(type) {
    switch (type) {
    case "temperature":
        return "INSERT INTO temperatures(temperature) VALUES($1)";
    case "event_log":
        return `INSERT INTO event_log(
            current_state, 
            previous_state, 
            heater_state, 
            current_temperature, 
            target_temperature, 
            upper_threshold, 
            lower_threshold, 
            temp_rise_if_heater_off_now, 
            max_temp_if_heater_off_now, 
            time_left_in_waiting_phase, 
            action, 
            heater_gain, 
            heating_inertia_duration, 
            small_heat_burst_duration, 
            large_heat_burst_duration) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`;
    default:
        throw "No matching insert type";
    }
}

function generateInsertValues(type, data) {
    switch (type) {
    case "temperature":
        return [data];
    case "event_log":
        return [
            data.current_state,
            data.previous_state,
            data.heater_state,
            data.currentTemperature,
            data.targetTemperature,
            data.upperThreshold,
            data.lowerThreshold,
            data.maxTemperatureRiseIfHeaterTurnedOffNow,
            data.temperatureIfHeaterTurnedOffNow,
            data.timeLeftInWaitingPhase,
            data.action,
            data.HEATER_GAIN,
            data.HEATING_INERTIA_DURATION,
            data.SMALL_HEAT_BURST_DURATION,
            data.LARGE_HEAT_BURST_DURATION
        ];
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

    let context = {
        currentTemperature,
        HEATER_GAIN,
        HEATING_INERTIA_DURATION,
        SMALL_HEAT_BURST_DURATION,
        LARGE_HEAT_BURST_DURATION,
        upperThreshold,
        lowerThreshold,
        maxTemperatureRiseIfHeaterTurnedOffNow,
        temperatureIfHeaterTurnedOffNow,
    };

    // Update context with additional variables
    context.current_state = CONTROL_STATE;
    context.previous_state = null; // Will be updated in transitionState()
    context.heater_state = HEATER_RELAY.readSync() === 0 ? "On" : "Off";
    context.targetTemperature = targetTemperature;
    context.timeLeftInWaitingPhase = timeLeftInWaitingPhase;
    context.action = null; // Will be updated as needed in state handlers

    // log current temperature
    try {
        await sendToDB("temperature", currentTemperature);
    } catch (error) {
        console.error(`Error inserting temperature into DB: ${error}`);
    }

    switch (CONTROL_STATE) {
    case states.OFF:
        await handleOffState(context);
        break;
    case states.INITIAL_HEATING:
        await handleInitialHeatingState(context);
        break;
    case states.INERTIA_PHASE:
        await handleInertiaPhaseState(context);
        break;
    case states.CONTROL_PHASE:
        await handleControlPhaseState(context);
        break;
    case states.SMALL_HEAT_BURST:
    case states.LARGE_HEAT_BURST:
        await handleHeatBurstState(context);
        break;
    default:
        await handleUnknownState(context);
    }

    setTimeout(eventLoop, EVENT_LOOP_INTERVAL * 1000);
}

async function handleOffState(context) {
    if (targetTemperature) {
        await transitionState(states.INITIAL_HEATING, context);
    }
}

async function handleInitialHeatingState(context) {
    const { HEATING_INERTIA_DURATION, upperThreshold, temperatureIfHeaterTurnedOffNow } = context;
    if (temperatureIfHeaterTurnedOffNow <= upperThreshold) {
        HEATER_RELAY.writeSync(0);  // turn on heater
        context.action = "Max temp below upper threshold, heater on";
        await sendToDB("event_log", context);
    } else {
        await transitionState(states.INERTIA_PHASE, context, HEATING_INERTIA_DURATION);
        HEATER_RELAY.writeSync(1);  // turn off heater
    }
}

async function handleInertiaPhaseState(context) {
    if (timeLeftInWaitingPhase <= 0) {
        await transitionState(states.CONTROL_PHASE, context);
    }
    timeLeftInWaitingPhase -= EVENT_LOOP_INTERVAL;
    context.action = "Heating inertia waiting period";
    await sendToDB("event_log", context);
}

async function handleControlPhaseState(context) {
    const { currentTemperature, lowerThreshold, SMALL_HEAT_BURST_DURATION, LARGE_HEAT_BURST_DURATION } = context;
    if (currentTemperature > targetTemperature) {
        context.action = "Temperature above target, heater off";
        HEATER_RELAY.writeSync(1);  // turn off heater
        await sendToDB("event_log", context);
    } else if (currentTemperature >= lowerThreshold && currentTemperature <= targetTemperature) {
        await transitionState(states.SMALL_HEAT_BURST, context, SMALL_HEAT_BURST_DURATION);
        context.action = "Temperature between lower threshold and target temperature, heater on";
        await sendToDB("event_log", context);
        HEATER_RELAY.writeSync(0);  // turn on heater
    } else {
        await transitionState(states.LARGE_HEAT_BURST, context, LARGE_HEAT_BURST_DURATION);
        context.action = "Temperature below lower threshold, heater on";
        await sendToDB("event_log", context);
        HEATER_RELAY.writeSync(0);  // turn on heater
    }
}

async function handleHeatBurstState(context) {
    const { HEATING_INERTIA_DURATION} = context;
    if (timeLeftInWaitingPhase <= 0) {
        await transitionState(states.INERTIA_PHASE, context, HEATING_INERTIA_DURATION);
        context.action = "Heat burst finished, heater off";
        await sendToDB("event_log", context);
        HEATER_RELAY.writeSync(1);  // turn off heater
    }
    timeLeftInWaitingPhase -= EVENT_LOOP_INTERVAL;
}

async function handleUnknownState(context) {
    context.action = "Reached an unknown state";
    await sendToDB("event_log", context);
}

async function transitionState(newState, context, inertiaTime = 0) {
    const PREVIOUS_STATE = CONTROL_STATE;
    CONTROL_STATE = newState;
    timeLeftInWaitingPhase = inertiaTime;

    // Update context with the previous and new states
    context.previous_state = PREVIOUS_STATE;
    context.current_state = newState;

    // Log to DB
    await sendToDB("event_log", context);
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
    const timeRangeMinutes = req.query.timeRange || 60;  // Default to 60 minutes
    const pointsToReturn = req.query.points || 800;  // Default to 800 points

    let query = `
    WITH time_intervals AS (
        SELECT generate_series(
            NOW() - interval '1 second' * (${timeRangeMinutes} * 60),
            NOW(),
            interval '1 second' * (${timeRangeMinutes} * 60) / ${pointsToReturn}
        ) AS timestamp
    ),
    temp_data AS (
        SELECT timestamp, temperature
        FROM temperatures
        WHERE timestamp BETWEEN (NOW() - interval '1 second' * (${timeRangeMinutes} * 60)) AND NOW()
    ),
    joined_data AS (
        SELECT
            ti.timestamp as "time",
            AVG(td.temperature) AS "temperature"
        FROM time_intervals ti
        LEFT JOIN temp_data td ON td.timestamp BETWEEN 
            ti.timestamp - interval '1 second' * (${timeRangeMinutes} * 60) / (${pointsToReturn} * 2) AND 
            ti.timestamp + interval '1 second' * (${timeRangeMinutes} * 60) / (${pointsToReturn} * 2)
        GROUP BY ti.timestamp
    )
    SELECT * FROM joined_data
    ORDER BY "time" DESC;
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
