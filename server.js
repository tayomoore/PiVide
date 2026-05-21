const express = require("express");
const fsPromises = require("fs").promises;
require("dotenv").config();

const TemperatureSensor = require("./sensor");
const HeaterRelay = require("./relay");
const Database = require("./database");
const { ControlLoop } = require("./control");

const PORT = 3000;
const HEATER_RELAY_PIN = 2;

const sensor = new TemperatureSensor(process.env.DS18B20_SENSOR_ID);
const relay = new HeaterRelay(HEATER_RELAY_PIN);
const database = new Database({
    user: process.env.dbuser,
    password: process.env.dbpassword
});
const controlLoop = new ControlLoop({ sensor, relay });

controlLoop.on("temperature", async (temperature) => {
    try {
        await database.insertTemperature(temperature);
    } catch (err) {
        console.error(`Error inserting temperature into DB: ${err}`);
    }
});

controlLoop.on("action", async ({ action }) => {
    try {
        await database.insertEventLog({ controlLoop, relay, action });
    } catch (err) {
        console.error(`Error inserting event log: ${err}`);
    }
});

controlLoop.on("transition", async ({ previous, current, action }) => {
    try {
        await database.insertEventLog({
            controlLoop,
            relay,
            action,
            previousState: previous,
            currentState: current
        });
    } catch (err) {
        console.error(`Error inserting event log: ${err}`);
    }
});

const app = express();
app.use(express.static("public"));
app.use(express.json());

async function logMessage(message) {
    const logEntry = `${new Date().toISOString()}: ${message}\n`;
    await fsPromises.appendFile("./public/log.txt", logEntry);
}

app.get("/temperature", async (req, res) => {
    try {
        const temperature = await sensor.read();
        res.json({ message: "Temperature fetched successfully", temperature });
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
        relay.on();
        await logMessage("Heater turned ON");
        res.json({ heaterState: "On" });
    } else if (command === "off") {
        relay.off();
        await logMessage("Heater turned OFF");
        res.json({ heaterState: "Off" });
    } else {
        res.status(400).send("Invalid command");
    }
});

app.post("/setpoint", (req, res) => {
    controlLoop.setTarget(req.body.temperature);
    res.json({ message: "Temperature set" });
});

app.get("/status", async (req, res) => {
    let currentTemperatureValue;
    try {
        currentTemperatureValue = await sensor.read();
    } catch (error) {
        console.error("Error reading temperature for status:", error);
        currentTemperatureValue = "Error";
    }
    res.json(controlLoop.status(currentTemperatureValue));
});

app.post("/tolerance", (req, res) => {
    const { tolerance } = req.body;
    if (typeof tolerance === "number" && tolerance > 0) {
        controlLoop.setTolerance(tolerance);
        res.json({ success: true, message: `Tolerance updated successfully to ${tolerance}` });
    } else {
        res.status(400).json({ success: false, message: `Invalid tolerance value ${tolerance}` });
    }
});

app.post("/heatingRate", (req, res) => {
    const { heatingRate } = req.body;
    if (typeof heatingRate === "number" && heatingRate > 0) {
        controlLoop.setHeatingRate(heatingRate);
        logMessage(`Heating rate updated successfully to ${heatingRate} secs/°C`);
        res.json({ success: true, message: `Heating rate updated successfully to ${heatingRate} secs/°C` });
    } else {
        res.status(400).json({ success: false, message: `Invalid heating rate value ${heatingRate}` });
    }
});

app.get("/temperatureHistory", async (req, res) => {
    const timeRangeMinutes = Number(req.query.timeRange) || 60;
    const pointsToReturn = Number(req.query.points) || 800;
    try {
        const rows = await database.fetchTemperatureHistory(timeRangeMinutes, pointsToReturn);
        res.json({ temperatures: rows });
    } catch (error) {
        res.status(500).json({ message: "Error fetching temperature history: " + error.message });
    }
});

function cleanupAndExit() {
    relay.release();
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

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);

async function main() {
    try {
        await database.connect();
        console.log("Connected to the database");
    } catch (err) {
        console.error("Error connecting to the database:", err);
    }
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
    });
    controlLoop.start();
}

main();