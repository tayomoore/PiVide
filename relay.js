const GPIO = require("onoff").Gpio;

// Relay is active-low: writing 0 energises the relay (heater on),
// writing 1 de-energises it (heater off). GPIO pin is high by default
// at boot, which keeps the heater off until we explicitly turn it on.
const ON = 0;
const OFF = 1;

class HeaterRelay {
    constructor(pin) {
        this.gpio = new GPIO(pin, "out");
        this.gpio.writeSync(OFF);
    }

    on() {
        this.gpio.writeSync(ON);
    }

    off() {
        this.gpio.writeSync(OFF);
    }

    isOn() {
        return this.gpio.readSync() === ON;
    }

    state() {
        return this.isOn() ? "On" : "Off";
    }

    release() {
        this.gpio.writeSync(OFF);
        this.gpio.unexport();
    }
}

module.exports = HeaterRelay;