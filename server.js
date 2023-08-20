const express = require('express');
const ds18b20 = require('ds18b20');
require('dotenv').config();
const app = express();
const PORT = 3000;

// This will serve your static files
app.use(express.static('public'));

app.get('/temperature', (req, res) => {
    // Your sensor's ID
    const sensorId = process.env.DS18B20_SENSOR_ID;
    console.log("here")
    ds18b20.temperature(sensorId, (err, value) => {
        if (err) {
            console.error(`Error reading temperature: ${err}`);
            return res.status(500).send('Error reading temperature.');
        }
        res.send(value.toString());
    });
});


app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
