const EventEmitter = require("events");
 
const EVENT_LOOP_INTERVAL = 10; // seconds
const SETPOINT_TOLERANCE_DEFAULT = 0.5;
const HEATING_RATE_SECS_PER_DEGREE_DEFAULT = 100;
const HEATING_INERTIA_DURATION = 200;
const SMALL_HEAT_BURST_DURATION = 60;
const LARGE_HEAT_BURST_DURATION = 120;
const SUPER_HEAT_BURST_DURATION = 480;
const SUPER_BURST_DEFICIT = 5;

const states = {
    OFF: "Off",
    INITIAL_HEATING: "Initial Heating",
    INERTIA_PHASE: "Inertia Phase",
    CONTROL_PHASE: "Control Phase",
    SMALL_HEAT_BURST: "Small Heat Burst",
    LARGE_HEAT_BURST: "Large Heat Burst",
    SUPER_HEAT_BURST: "Super Heat Burst"
};

class ControlLoop extends EventEmitter {
    constructor({ sensor, relay }) {
        super();
        this.sensor = sensor;
        this.relay = relay;

        this.currentTemperature = null;
        this.targetTemperature = null;
        this.setpointTolerance = SETPOINT_TOLERANCE_DEFAULT;
        this.heatingRateSecsPerDegree = HEATING_RATE_SECS_PER_DEGREE_DEFAULT;
        this.controlState = states.OFF;
        this.timeLeftInWaitingPhase = 0;

        this.heatingInertiaDuration = HEATING_INERTIA_DURATION;
        this.smallHeatBurstDuration = SMALL_HEAT_BURST_DURATION;
        this.largeHeatBurstDuration = LARGE_HEAT_BURST_DURATION;
        this.superHeatBurstDuration = SUPER_HEAT_BURST_DURATION;
    }

    // --- Public API ------------------------------------------------------

    setTarget(temperature) {
        if (typeof temperature !== "number" || !isFinite(temperature) || temperature <= 0) {
            this.targetTemperature = null;
            this.controlState = states.OFF;
            this.timeLeftInWaitingPhase = 0;
            this.relay.off();
            return;
        }
        this.targetTemperature = temperature;
    }

    setTolerance(tolerance) {
        this.setpointTolerance = tolerance;
    }

    setHeatingRate(rate) {
        this.heatingRateSecsPerDegree = rate;
    }

    status(currentTemperature) {
        return {
            heaterState: this.relay.state(),
            controlState: this.controlState,
            targetTemperature: this.targetTemperature || 0,
            tolerance: this.setpointTolerance,
            temperature: currentTemperature,
            heatingRate: this.heatingRateSecsPerDegree
        };
    }

    // --- Derived values --------------------------------------------------

    get heaterGain() {
        return 1 / this.heatingRateSecsPerDegree;
    }

    get upperThreshold() {
        return this.targetTemperature + this.setpointTolerance;
    }

    get lowerThreshold() {
        return this.targetTemperature - this.setpointTolerance;
    }

    get maxTemperatureRiseIfHeaterOff() {
        return this.heaterGain * this.heatingInertiaDuration;
    }

    temperatureIfHeaterOff(currentTemperature) {
        return currentTemperature + this.maxTemperatureRiseIfHeaterOff;
    }

    // --- Loop ------------------------------------------------------------

    start() {
        this._schedule();
    }

    _schedule() {
        setTimeout(() => this._tick(), EVENT_LOOP_INTERVAL * 1000);
    }

    async _tick() {
        try {
            await this._runOnce();
        } catch (err) {
            console.error("Event loop error:", err);
        } finally {
            this._schedule();
        }
    }

    async _runOnce() {
        let currentTemperature;
        try {
            currentTemperature = await this.sensor.read();
        } catch (err) {
            console.error(`Error reading temperature: ${err}`);
            return;
        }
        this.currentTemperature = currentTemperature;
        this.emit("temperature", currentTemperature);

        switch (this.controlState) {
        case states.OFF:
            await this._handleOff();
            break;
        case states.INITIAL_HEATING:
            await this._handleInitialHeating(currentTemperature);
            break;
        case states.INERTIA_PHASE:
            await this._handleInertiaPhase();
            break;
        case states.CONTROL_PHASE:
            await this._handleControlPhase(currentTemperature);
            break;
        case states.SMALL_HEAT_BURST:
        case states.LARGE_HEAT_BURST:
        case states.SUPER_HEAT_BURST:
            await this._handleHeatBurst();
            break;
        default:
            this._emitAction("Reached an unknown state");
        }
    }

    // --- Emitters --------------------------------------------------------

    _emitAction(action) {
        this.emit("action", { action });
    }

    _transition(newState, action, inertiaTime = 0) {
        const previous = this.controlState;
        this.controlState = newState;
        this.timeLeftInWaitingPhase = inertiaTime;
        this.emit("transition", { previous, current: newState, action });
    }

    // --- Handlers --------------------------------------------------------

    _handleOff() {
        if (this.targetTemperature) {
            this._transition(states.INITIAL_HEATING, "Setpoint set, starting control loop");
        }
    }

    _handleInitialHeating(currentTemperature) {
        if (this.temperatureIfHeaterOff(currentTemperature) <= this.upperThreshold) {
            this.relay.on();
            this._emitAction("Max temp below upper threshold, heater on");
        } else {
            this.relay.off();
            this._transition(states.INERTIA_PHASE, "Max temp above upper threshold, heater off", this.heatingInertiaDuration);
        }
    }

    _handleInertiaPhase() {
        if (this.timeLeftInWaitingPhase <= 0) {
            this._transition(states.CONTROL_PHASE, "End of waiting period");
        } else {
            this._emitAction("Heating inertia waiting period");
            this.timeLeftInWaitingPhase -= EVENT_LOOP_INTERVAL;
        }
    }

    _handleControlPhase(currentTemperature) {
        if (currentTemperature > this.targetTemperature) {
            this.relay.off();
            this._emitAction("Temperature above target, heater off");
        } else if (currentTemperature <= this.targetTemperature - SUPER_BURST_DEFICIT) {
            this.relay.on();
            this._transition(states.SUPER_HEAT_BURST, "Temperature well below target temperature, heater on", this.superHeatBurstDuration);
        } else if (currentTemperature >= this.lowerThreshold) {
            this.relay.on();
            this._transition(states.SMALL_HEAT_BURST, "Temperature between lower threshold and target temperature, heater on", this.smallHeatBurstDuration);
        } else {
            this.relay.on();
            this._transition(states.LARGE_HEAT_BURST, "Temperature below lower threshold, heater on", this.largeHeatBurstDuration);
        }
    }

    _handleHeatBurst() {
        if (this.timeLeftInWaitingPhase <= 0) {
            this.relay.off();
            this._transition(states.INERTIA_PHASE, "Heat burst finished, heater off", this.heatingInertiaDuration);
        } else {
            this._emitAction("In heat burst, heater on");
            this.timeLeftInWaitingPhase -= EVENT_LOOP_INTERVAL;
        }
    }
}

module.exports = { ControlLoop, states, EVENT_LOOP_INTERVAL };