const ds18b20 = require("ds18b20");

const CACHE_TTL_MS = 1000;

class TemperatureSensor {
    constructor(sensorId) {
        this.sensorId = sensorId;
        this.lastValue = null;
        this.lastReadAt = 0;
        this.pendingRead = null;
    }

    async read() {
        const now = Date.now();
        if (this.lastValue !== null && now - this.lastReadAt < CACHE_TTL_MS) {
            return this.lastValue;
        }
        if (this.pendingRead) {
            return this.pendingRead;
        }

        this.pendingRead = new Promise((resolve, reject) => {
            ds18b20.temperature(this.sensorId, (err, value) => {
                if (err) {
                    reject(err);
                } else {
                    this.lastValue = value;
                    this.lastReadAt = Date.now();
                    resolve(value);
                }
            });
        }).finally(() => {
            this.pendingRead = null;
        });

        return this.pendingRead;
    }
}

module.exports = TemperatureSensor;