// imports
const express = require("express");
const ds18b20 = require("ds18b20");
const GPIO = require("onoff").Gpio;
const bodyParser = require("body-parser");
const fs = require("fs");
require("dotenv").config();

// Set things up
const app = express();
const PORT = 3000;
app.use(express.static("public"));
app.use(bodyParser.json());
const HEATER_RELAY = new GPIO(2, "out");

// functions
app.get("/temperature", (req, res) => {
    // Your sensor's ID
    const sensorId = process.env.DS18B20_SENSOR_ID;
    ds18b20.temperature(sensorId, (err, value) => {
        if (err) {
            console.error(`Error reading temperature: ${err}`);
            return res.status(500).send("Error reading temperature.");
        }
        res.json({ temperature: value.toString() });
    });
});

app.post("/heater", (req, res) => {
    const command = req.body.command;
    if (command === "on") {
        HEATER_RELAY.writeSync(0);  // turn on
        res.json({ "heaterState": "On" });
    } else if (command === "off") {
        HEATER_RELAY.writeSync(1);  // turn off
        res.json({ "heaterState": "Off" });
    } else {
        res.status(400).send("Invalid command");
    }
});

app.post("/logTemperature", (req, res) => {
    const temperature = req.body.temperature;
    const logEntry = `${new Date().toISOString()}: ${temperature}\n`;
    fs.appendFile("temperatureLog.txt", logEntry, (err) => {
        if (err) throw err;
    });
    res.sendStatus(200);
});

// Cleanup code to release GPIO pins upon program exit
process.on("SIGINT", function () {
    HEATER_RELAY.writeSync(1);      // Set pin to HIGH before exiting
    HEATER_RELAY.unexport();        // Unexport pin
    process.exit();                 // Exit the application
});

// start express server
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
