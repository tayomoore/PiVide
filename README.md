# PiVide
A node powered sous vide machine

We're aiming for a fully plug and play sous vide machine, hacked together from a slow cooker, with a webpage to control the device, locally at first, but who knows what the future might hold!

As of September 2023, the sous vide machine is fully functional.

# Requirements
To build it you will need a:
- Raspberry Pi (I used a v3 Model B, I have not tested it with any others)
- Slow cooker (I used a basic Crock Pot one with High/Low/Warm settings)
- Relay board module to turn the slow cooker on/off
- DS18B20 waterproof temperature sensor

# Electronics
## The Temperature Sensor
- Connect black/pin 1 to ground
- Connect red/pin 3 to 3.3v
- Connect yellow/pin 2 to pin 7/GPIO4
- Connect a 4.7k pull-up resistor between 3.3v (red) and the data pin (yellow)

## The relay board
- Connect GND to 0v
- Connect VCC to 5v
- Connect the control pin to GPIO2 (you could use a different pin, but would need to update the code)
- Cut the power cable to the slow cooker and splice together the neutral wires
- Splice the earth wires together
- Take the live wires and connect them to the relay outputs

# Setup
### Ensure Node is installed on the Raspberry Pi
### Temperature sensor
- You will need to enable I2C on the Raspberry Pi
- Find out the sensor ID, I used this [tutorial](https://www.circuitbasics.com/raspberry-pi-ds18b20-temperature-sensor-tutorial/)
- Store the sensor ID in a .env file as `DS18B20_SENSOR_ID={your ID here}`

### Database
A Postgres database is used to store temperature data for plotting the graph on the front end and saving the internal logic for the temperature control loop which is useful for debugging and fine tuning.
- Set up a Postgres instance on your Raspberry Pi and store the username and password in the .env file as `dbuser={database username here}` and `dbpassword={database password here}`
- Create a table `temperatures` using
```
CREATE TABLE IF NOT EXISTS temperatures (
    id SERIAL PRIMARY KEY,
    temperature DECIMAL,
    timestamp TIMESTAMP DEFAULT NOW()
  )
```
- Create a table `event_log` using
```
CREATE TABLE heating_control (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT current_timestamp,
    current_state TEXT NOT NULL,
    previous_state TEXT NOT NULL,
    heater_state TEXT,
    action TEXT NOT NULL,
    target_temperature FLOAT NOT NULL,
    current_temperature FLOAT NOT NULL,
    heater_gain FLOAT NOT NULL,
    upper_threshold FLOAT NOT NULL,
    lower_threshold FLOAT NOT NULL,
    heating_inertia_duration FLOAT NOT NULL,
    small_heat_burst_duration FLOAT NOT NULL,
    large_heat_burst_duration FLOAT NOT NULL,
    time_left_in_waiting_phase INTEGER NOT NULL,
    temp_rise_if_heater_off_now FLOAT NOT NULL,
    max_temp_if_heater_off_now FLOAT NOT NULL
);

CREATE INDEX idx_timestamp ON heating_control (timestamp);
```

# Installation
- Install Node
- Clone the repository
- Run `npm install`
- Run `node server.js`
- You should see
```
Server is running on http://localhost:3000
Connected to the database
```

# Use
- Navigate to `http://localhost:3000`
- Set the target temperature
- The control loop will inter the initial heating phase, the relay should switch on and the cooker should start to heat up
- Once it reaches the target temperature, it will enter the control phase and will maintain the desired temperature

# Calibrating
The constants for the temperature control loop are all based on my experiments with my slow cooker. The behaviour of your system may vary so some tweaking and calibration may be necessary. Here is how I obtained the two constants for my slow cooker
### To obtain the `HEATING_RATE_SECS_PER_DEGREE_DEFAULT` 
- Fill the cooker with tap water and turn the heater on
- After a few hours it should be well into the non-linear region of heating, turn off the heater and move the data into your favourite data analysis tool
- Put a line of best fit through a large portion of the approximately linear heating region and take the gradient
- This should be a very small number since the slow cooker is very slow to warm up. Take the inverse of this and use it as the constant

### To obtain the `HEATING_INERTIA_DURATION`
- Fill the cooker with tap water and turn the heater on
- After an hour or so, the water temperature should still be firmly in the approximately linear heating region and the slow cooker itself should be thermally saturated
- Turn off the heater and wait for the temperature to plateau
- The time it takes for the temperature to stop rising is the constant

# Troubleshooting
- You can vary the `EVENT_LOOP_INTERVAL` to make the temperature control loop calculate the heater action more or less frequently
- You can vary the `HEATING_INTERTIA_DURATION` to make the system more or less "reactive". A smaller duration could lead to oscillations as the system will not have time to react to the heat input (or lack of). A larger value will lead to less precise temperature control, but will reduce oscillations and make the system slower to react
- You can vary the `SMALL|LARGE_HEAT_BURST_DURATION` to make the system more or less aggressive with raising the temperature

# Possible further developments
- Make the `SMALL|LARGE_HEAT_BURST_DURATION` editable by the front end
- Make the `SMALL|LARGE_HEAT_BURST_DURATION` calculated values based on the `HEATER_GAIN`, `HEATING_INERTIA_DURATION`, and the distance to the target temperature
- Tighten up the state transitions, removing delays caused by waiting for the loop each time to enter a new state
- Move the state transitions to a 'proper' Class based state machine
- Change the status updates on the front end to be sent over a websocket rather than the front end polling for updates every `STATUS_UPDATE_INTERVAL` seconds
- Improve the charting to allow for more user interaction
- Timers to alert the user (SMS/WhatsApp/Email?) when a given time period has elapsed and the food is cooked
- Make the UI look nice
- Re-evaluate other temperature control strategies, like PID control, or just more predictive elements within the current strategy (taking cooling into account, for example)
