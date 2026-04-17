'use strict';

const { AuthManager } = require('./auth');
const { discoverC3Endpoint, getVehicles } = require('./discovery');
const grpc = require('./grpc');
const codec = require('./codec');
const {
    VehicleRequestSchema,
    GetBatteryResponseSchema,
    GetOdometerResponseSchema,
    GetHealthResponseSchema,
    ChargingStatus,
    ChargerConnectionStatus,
    ChargingType,
    ServiceWarning,
    TyrePressureWarning,
} = require('./messages');

const SVC_BATTERY = '/services.vehiclestates.battery.BatteryService';
const SVC_ODOMETER = '/services.vehiclestates.odometer.OdometerService';
const SVC_HEALTH = '/services.vehiclestates.health.HealthService';

class PolestarC3 {
    constructor(email, password) {
        this._auth = new AuthManager();
        this._email = email;
        this._password = password;
        this._endpoint = null;
        this._session = null;
        this._vin = null;
    }

    async login() {
        await this._auth.authenticate(this._email, this._password);
        this._endpoint = await discoverC3Endpoint(this._auth.accessToken);
    }

    async listVehicles() {
        const token = await this._auth.ensureValidToken();
        return getVehicles(token);
    }

    async setVehicle(vin) {
        this._vin = vin;
    }

    _ensureSession() {
        if (this._session && !this._session.closed && !this._session.destroyed) return this._session;
        this._session = grpc.connect(this._endpoint.host, this._endpoint.port);
        this._session.setTimeout(60000);
        this._session.on('error', () => { /* swallow to allow reconnect */ });
        this._session.on('close', () => { this._session = null; });
        return this._session;
    }

    async _call(method, requestBytes, { debug = false, streaming = false } = {}) {
        const token = await this._auth.ensureValidToken();
        const session = this._ensureSession();
        const metadata = { authorization: `Bearer ${token}` };
        if (this._vin) metadata.vin = this._vin;
        const fn = streaming ? grpc.serverStreamFirst : grpc.unaryUnary;
        return fn(session, method, requestBytes, metadata, { debug });
    }

    _vehicleRequestBytes() {
        if (!this._vin) throw new Error('No vehicle selected — call setVehicle(vin) first');
        return codec.encode(VehicleRequestSchema, { vin: this._vin });
    }

    async getLatestBattery({ debug = false } = {}) {
        const req = this._vehicleRequestBytes();
        const respBytes = await this._call(`${SVC_BATTERY}/GetLatestBattery`, req, { debug });
        const decoded = codec.decode(GetBatteryResponseSchema, respBytes);
        if (decoded.battery) {
            decoded.battery.charging_status_label = ChargingStatus[decoded.battery.charging_status] || null;
            decoded.battery.charger_connection_status_label =
                ChargerConnectionStatus[decoded.battery.charger_connection_status] || null;
            decoded.battery.charging_type_label = ChargingType[decoded.battery.charging_type] || null;
        }
        return decoded;
    }

    async getLatestOdometer({ debug = false } = {}) {
        const req = this._vehicleRequestBytes();
        const respBytes = await this._call(`${SVC_ODOMETER}/GetOdometer`, req, { debug, streaming: true });
        return codec.decode(GetOdometerResponseSchema, respBytes);
    }

    async getLatestHealth({ debug = false } = {}) {
        const req = this._vehicleRequestBytes();
        const respBytes = await this._call(`${SVC_HEALTH}/GetHealth`, req, { debug, streaming: true });
        const decoded = codec.decode(GetHealthResponseSchema, respBytes);
        if (decoded.health) {
            decoded.health.service_warning_label = ServiceWarning[decoded.health.service_warning] || null;
            for (const side of ['front_left', 'front_right', 'rear_left', 'rear_right']) {
                const key = `${side}_tyre_pressure_warning`;
                decoded.health[`${key}_label`] = TyrePressureWarning[decoded.health[key]] || null;
            }
        }
        return decoded;
    }

    close() {
        if (this._session && !this._session.closed) {
            try { this._session.close(); } catch (_) { /* noop */ }
        }
        this._session = null;
    }
}

module.exports = { PolestarC3 };
