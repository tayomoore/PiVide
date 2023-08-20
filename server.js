const express = require('express');
const app = express();
const PORT = 3000;

// This will serve your static files
app.use(express.static('public'));

app.get('/temperature', (req, res) => {
    // For now, we'll spoof the temperature
    let spoofedTemperature = (Math.random() * (25 - 20) + 20).toFixed(2);  // Random temperature between 20 and 25
    res.json({ temperature: spoofedTemperature });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
