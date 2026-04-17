'use strict';

const { AuthManager } = require('./auth');
const { discoverC3Endpoint, getVehicles } = require('./discovery');
const grpc = require('./grpc');
const codec = require('./codec');
const { wrapChronos } = require('./chronos');
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
const SVC_CHARGE_NOW = '/chronos.services.v1.ChargeNowService';
const SVC_TARGET_SOC = '/chronos.services.v1.TargetSocService';
const SVC_AMP_LIMIT = '/chronos.services.v1.AmpLimitService';

// ChargeTargetLevelSettingType enum
const CHARGE_TARGET_DAILY = 1;
const CHARGE_TARGET_LONG_TRIP = 2;
const CHARGE_TARGET_CUSTOM = 3;

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
        const session = grpc.connect(this._endpoint.host, this._endpoint.port);
        session.setTimeout(60000);
        session.on('error', () => { /* swallow to allow reconnect */ });
        session.on('close', () => { if (this._session === session) this._session = null; });
        session.on('goaway', () => {
            console.warn('[polestar-c3] HTTP/2 GOAWAY received, resetting session');
            if (this._session === session) this._session = null;
            try { session.destroy(); } catch (_) {}
        });
        // Heartbeat ping every 30s — matches Python reference keepalive and keeps
        // intermediate load balancers from idling us out.
        const heartbeat = setInterval(() => {
            if (session.closed || session.destroyed) { clearInterval(heartbeat); return; }
            try {
                session.ping((err) => {
                    if (err) {
                        console.warn('[polestar-c3] ping failed, destroying session:', err.message);
                        if (this._session === session) this._session = null;
                        try { session.destroy(); } catch (_) {}
                    }
                });
            } catch (_) { /* session already gone */ }
        }, 30000);
        heartbeat.unref && heartbeat.unref();
        session.once('close', () => clearInterval(heartbeat));
        this._session = session;
        return session;
    }

    async _call(method, requestBytes, { debug = false, streaming = false, retries = 1 } = {}) {
        let lastErr = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const token = await this._auth.ensureValidToken();
            const session = this._ensureSession();
            const metadata = { authorization: `Bearer ${token}` };
            if (this._vin) metadata.vin = this._vin;
            const fn = streaming ? grpc.serverStreamFirst : grpc.unaryUnary;
            try {
                return await fn(session, method, requestBytes, metadata, { debug });
            } catch (err) {
                lastErr = err;
                const msg = err.message || '';
                const transient = /\bstatus=(13|14)\b|GOAWAY|goaway|ECONNRESET|EPIPE|ETIMEDOUT|NGHTTP2_/i.test(msg);
                if (attempt < retries && transient) {
                    console.warn(`[polestar-c3] transient error on ${method}, retrying (${msg})`);
                    this._session = null;
                    continue;
                }
                throw err;
            }
        }
        throw lastErr;
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

    // --- Chronos write helpers ---

    _unwrapChronosPayload(bytes) {
        // Chronos responses wrap the payload at field 3 of a length-delimited outer message.
        const raw = codec.decode({ payload: { num: 3, type: 'bytes' } }, bytes);
        return raw.payload || null;
    }

    async _chronosCall(method, innerPayload, { streaming = false, debug = false } = {}) {
        if (!this._vin) throw new Error('No vehicle selected');
        const req = wrapChronos(this._vin, innerPayload);
        if (debug || process.env.POLESTAR_DUMP_REQUESTS === '1') {
            console.log(`[polestar-c3 dump] ${method} REQUEST size=${req.length} hex=${req.toString('hex')}`);
            try {
                const raw = codec.decodeRaw(req);
                const summary = {};
                for (const [k, v] of Object.entries(raw)) {
                    summary[k] = Buffer.isBuffer(v) ? `<${v.length}B hex=${v.toString('hex')}>` : v;
                }
                console.log(`[polestar-c3 dump] ${method} REQUEST decoded:`, summary);
            } catch (_) {}
        }
        return this._call(method, req, { streaming, debug });
    }

    async chargeStart({ debug = false } = {}) {
        const resp = await this._chronosCall(`${SVC_CHARGE_NOW}/StartOverrideChargeTimer`, Buffer.alloc(0), { debug });
        return this._parseStatusCode(resp);
    }

    async chargeStop({ debug = false } = {}) {
        const resp = await this._chronosCall(`${SVC_CHARGE_NOW}/StopOverrideChargeTimer`, Buffer.alloc(0), { debug });
        return this._parseStatusCode(resp);
    }

    async getTargetSoc({ debug = false } = {}) {
        // Server-streaming, take first message.
        const resp = await this._chronosCall(`${SVC_TARGET_SOC}/GetTargetSoc`, Buffer.alloc(0), { streaming: true, debug });
        return this._parseIntegerField(resp, 1); // inner field 1 = target_level
    }

    async setTargetSoc(level, settingType = CHARGE_TARGET_DAILY, { debug = false } = {}) {
        if (!Number.isInteger(level) || level < 0 || level > 100) {
            throw new Error(`Target SoC out of range: ${level}`);
        }
        const inner = codec.encode({
            level: { num: 2, type: 'int32' },
            setting_type: { num: 3, type: 'int32' },
        }, { level, setting_type: settingType });
        // The response on Polestar 4 is a chronos-envelope ack (id, vin,
        // setting_type_echo) and does NOT echo the newly committed level —
        // field 1 of the inner payload can be stale. Callers should verify
        // via a subsequent GetTargetSoc instead of trusting the return here.
        const resp = await this._chronosCall(`${SVC_TARGET_SOC}/SetTargetSoc`, inner, { streaming: true, debug });
        return this._parseIntegerField(resp, 1);
    }

    async getAmpLimit({ debug = false } = {}) {
        const resp = await this._chronosCall(`${SVC_AMP_LIMIT}/GetAmpLimit`, Buffer.alloc(0), { streaming: true, debug });
        return this._parseIntegerField(resp, 1); // inner field 1 = amperage_limit
    }

    async setAmpLimit(amperage, { debug = false } = {}) {
        if (!Number.isInteger(amperage) || amperage < 6 || amperage > 32) {
            throw new Error(`Amp limit out of range (6–32): ${amperage}`);
        }
        const inner = codec.encode({
            amp_limit: { num: 2, type: 'int32' },
        }, { amp_limit: amperage });
        const resp = await this._chronosCall(`${SVC_AMP_LIMIT}/SetAmpLimit`, inner, { debug });
        return this._parseIntegerField(resp, 1);
    }

    /** Best-effort dump of a chronos response so we can see what the server
     *  actually sent back without writing proto schemas for every response type. */
    _debugDumpChronos(label, respBytes) {
        try {
            const raw = codec.decodeRaw(respBytes);
            const summarize = (obj) => {
                const out = {};
                for (const [k, v] of Object.entries(obj)) {
                    out[k] = Buffer.isBuffer(v) ? `<${v.length}B hex=${v.toString('hex')}>` : v;
                }
                return out;
            };
            console.log(`[polestar-c3 dump] ${label} size=${respBytes.length}:`, summarize(raw));
            // Recursively decode any nested messages (length-delimited with wt=2).
            for (const [key, val] of Object.entries(raw)) {
                if (Buffer.isBuffer(val)) {
                    try {
                        const inner = codec.decodeRaw(val);
                        if (Object.keys(inner).length) {
                            console.log(`[polestar-c3 dump] ${label} ${key} nested:`, summarize(inner));
                        }
                    } catch (_) { /* not a valid proto message */ }
                }
            }
        } catch (err) {
            console.log(`[polestar-c3 dump] ${label} decode failed:`, err.message);
        }
    }

    _parseStatusCode(respBytes) {
        const payload = this._unwrapChronosPayload(respBytes);
        if (!payload) return 0;
        const decoded = codec.decode({ status: { num: 1, type: 'int32' } }, payload);
        return decoded.status || 0;
    }

    _parseIntegerField(respBytes, fieldNum) {
        const payload = this._unwrapChronosPayload(respBytes);
        if (!payload) return null;
        const schema = { value: { num: fieldNum, type: 'int32' } };
        const decoded = codec.decode(schema, payload);
        return typeof decoded.value === 'number' ? decoded.value : null;
    }

    close() {
        if (this._session && !this._session.closed) {
            try { this._session.close(); } catch (_) { /* noop */ }
        }
        this._session = null;
    }
}

module.exports = { PolestarC3 };
