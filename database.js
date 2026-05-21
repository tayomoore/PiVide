const { Client } = require("pg");
 
const EVENT_LOG_INSERT = `INSERT INTO event_log(
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
    large_heat_burst_duration,
    super_heat_burst_duration
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`;

class Database {
    constructor({ host = "localhost", database = "pivide", user, password, port = 5432 } = {}) {
        this.client = new Client({ host, database, user, password, port });
    }

    async connect() {
        await this.client.connect();
    }

    async insertTemperature(temperature) {
        await this.client.query(
            "INSERT INTO temperatures(temperature) VALUES($1)",
            [temperature]
        );
    }

    async insertEventLog({ controlLoop, relay, action, previousState = null, currentState = null }) {
        const t = controlLoop.currentTemperature;
        const values = [
            currentState ?? controlLoop.controlState,
            previousState,
            relay.state(),
            t,
            controlLoop.targetTemperature,
            controlLoop.upperThreshold,
            controlLoop.lowerThreshold,
            controlLoop.maxTemperatureRiseIfHeaterOff,
            t !== null ? controlLoop.temperatureIfHeaterOff(t) : null,
            controlLoop.timeLeftInWaitingPhase,
            action,
            controlLoop.heaterGain,
            controlLoop.heatingInertiaDuration,
            controlLoop.smallHeatBurstDuration,
            controlLoop.largeHeatBurstDuration,
            controlLoop.superHeatBurstDuration
        ];
        await this.client.query(EVENT_LOG_INSERT, values);
    }

    async fetchTemperatureHistory(timeRangeMinutes, pointsToReturn) {
        const query = `
        WITH time_intervals AS (
            SELECT generate_series(
                NOW() - interval '1 second' * ($1 * 60),
                NOW(),
                interval '1 second' * ($1 * 60) / $2
            ) AS timestamp
        ),
        temp_data AS (
            SELECT timestamp, temperature
            FROM temperatures
            WHERE timestamp BETWEEN (NOW() - interval '1 second' * ($1 * 60)) AND NOW()
        ),
        joined_data AS (
            SELECT
                ti.timestamp as "time",
                AVG(td.temperature) AS "temperature"
            FROM time_intervals ti
            LEFT JOIN temp_data td ON td.timestamp BETWEEN
                ti.timestamp - interval '1 second' * ($1 * 60) / ($2 * 2) AND
                ti.timestamp + interval '1 second' * ($1 * 60) / ($2 * 2)
            GROUP BY ti.timestamp
        )
        SELECT * FROM joined_data
        ORDER BY "time" DESC;
        `;
        const result = await this.client.query(query, [timeRangeMinutes, pointsToReturn]);
        return result.rows;
    }
}

module.exports = Database;