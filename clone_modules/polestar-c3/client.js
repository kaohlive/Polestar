'use strict';

const { AuthManager } = require('./auth');
const { discoverC3Endpoint, decodeGetMyCarsResponse } = require('./discovery');
const grpc = require('./grpc');
const codec = require('./codec');
const { wrapChronos } = require('./chronos');
const {
    VehicleRequestSchema,
    GetBatteryResponseSchema,
    GetOdometerResponseSchema,
    GetHealthResponseSchema,
    GetExteriorResponseSchema,
    GetClimateResponseSchema,
    InvocationRequestSchema,
    CarLockRequestSchema,
    CarUnlockRequestSchema,
    HonkFlashRequestSchema,
    ClimatizationStartRequestSchema,
    ClimatizationStopRequestSchema,
    InvocationResponseEnvelopeSchema,
    InvocationStatus,
    HonkFlashAction,
    HeatingIntensity,
    WindowControlRequestSchema,
    WindowControlType,
    GetSoftwareInfoResponseSchema,
    SoftwareState,
    OTA_AVAILABLE_STATES,
    ChargingStatus,
    ChargerConnectionStatus,
    ChargingType,
    ServiceWarning,
    TyrePressureWarning,
    OpenStatus,
    LockStatus,
    ClimatizationRunningStatus,
    ClimatizationRequestType,
} = require('./messages');

const SVC_BATTERY = '/services.vehiclestates.battery.BatteryService';
const SVC_ODOMETER = '/services.vehiclestates.odometer.OdometerService';
const SVC_HEALTH = '/services.vehiclestates.health.HealthService';
const SVC_EXTERIOR = '/services.vehiclestates.exterior.ExteriorService';
const SVC_CLIMATE = '/services.vehiclestates.parkingclimatization.ParkingClimatizationService';
const SVC_CHARGE_NOW = '/chronos.services.v1.ChargeNowService';
const SVC_TARGET_SOC = '/chronos.services.v1.TargetSocService';
const SVC_AMP_LIMIT = '/chronos.services.v1.AmpLimitService';
const SVC_INVOCATION = '/invocation.InvocationService';
const SVC_LOCATION = '/dtlinternet.DtlInternetService';
const SVC_OTA_DISCOVERY = '/ota_mobcache.OtaDiscoveryService';
const GET_MY_CARS = '/car_information.CarInformation/GetMyCars';

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
        const response = await this._call(GET_MY_CARS, Buffer.alloc(0));
        return decodeGetMyCarsResponse(response);
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

    async getLatestExterior({ debug = false } = {}) {
        const req = this._vehicleRequestBytes();
        const respBytes = await this._call(`${SVC_EXTERIOR}/GetLatestExterior`, req, { debug });
        const decoded = codec.decode(GetExteriorResponseSchema, respBytes);
        if (decoded.exterior) {
            const e = decoded.exterior;
            e.central_lock_label = LockStatus[e.central_lock] || null;
            e.tailgate_lock_label = LockStatus[e.tailgate_lock] || null;
            for (const key of ['door_front_left', 'door_front_right', 'door_rear_left', 'door_rear_right',
                               'window_front_left', 'window_front_right', 'window_rear_left', 'window_rear_right',
                               'hood', 'tailgate', 'tank_lid', 'sunroof']) {
                e[`${key}_label`] = OpenStatus[e[key]] || null;
            }
        }
        return decoded;
    }

    async getLatestClimate({ debug = false } = {}) {
        const req = this._vehicleRequestBytes();
        const respBytes = await this._call(`${SVC_CLIMATE}/GetLatestParkingClimatization`, req, { debug });
        const decoded = codec.decode(GetClimateResponseSchema, respBytes);
        if (decoded.climate) {
            const c = decoded.climate;
            c.running_status_label = ClimatizationRunningStatus[c.running_status] || null;
            c.request_type_label = ClimatizationRequestType[c.request_type] || null;
        }
        return decoded;
    }

    // --- Invocation write helpers (lock, unlock, honk/flash, climate) ---

    _parseInvocationResponse(respBytes) {
        const env = codec.decode(InvocationResponseEnvelopeSchema, respBytes);
        const r = env.response || {};
        const statusLabel = InvocationStatus[r.status] || null;
        return {
            id: r.id || null,
            vin: r.vin || null,
            status: typeof r.status === 'number' ? r.status : null,
            statusLabel,
            message: r.message || null,
            timestamp: typeof r.timestamp === 'bigint' ? Number(r.timestamp) : (r.timestamp || null),
            ok: r.status === 1 || r.status === 4 || r.status === 6, // SENT / DELIVERED / SUCCESS
        };
    }

    async _invocationCall(method, requestBytes, { debug = false } = {}) {
        // Invocation methods are server-streaming; we take the first delivered
        // response (often SENT or DELIVERED — the car processes the command
        // regardless of whether we hang around for the final SUCCESS).
        const respBytes = await this._call(`${SVC_INVOCATION}/${method}`, requestBytes, { debug, streaming: true });
        const parsed = this._parseInvocationResponse(respBytes);
        if (!parsed.ok) {
            throw new Error(`Invocation ${method} failed: status=${parsed.status} (${parsed.statusLabel}) ${parsed.message || ''}`.trim());
        }
        return parsed;
    }

    async lock({ debug = false } = {}) {
        const req = codec.encode(CarLockRequestSchema, {
            request: codec.encode(InvocationRequestSchema, { vin: this._vin }),
            lock_type: 0, // LOCK
        });
        return this._invocationCall('Lock', req, { debug });
    }

    async unlock({ debug = false } = {}) {
        const req = codec.encode(CarUnlockRequestSchema, {
            request: codec.encode(InvocationRequestSchema, { vin: this._vin }),
            unlock_type: 0, // full unlock
        });
        return this._invocationCall('Unlock', req, { debug });
    }

    async unlockTrunk({ debug = false } = {}) {
        const req = codec.encode(CarUnlockRequestSchema, {
            request: codec.encode(InvocationRequestSchema, { vin: this._vin }),
            unlock_type: 1, // trunk only
        });
        return this._invocationCall('Unlock', req, { debug });
    }

    async honkFlash({ action = HonkFlashAction.FLASH, debug = false } = {}) {
        const req = codec.encode(HonkFlashRequestSchema, {
            request: codec.encode(InvocationRequestSchema, { vin: this._vin }),
            honk_flash_type: action,
        });
        return this._invocationCall('HonkFlash', req, { debug });
    }

    async climateStart(options = {}) {
        const {
            temperature = 21,
            frontLeftSeat = HeatingIntensity.UNSPECIFIED,
            frontRightSeat = HeatingIntensity.UNSPECIFIED,
            rearLeftSeat = HeatingIntensity.UNSPECIFIED,
            rearRightSeat = HeatingIntensity.UNSPECIFIED,
            steeringWheel = HeatingIntensity.UNSPECIFIED,
            debug = false,
        } = options;
        const req = codec.encode(ClimatizationStartRequestSchema, {
            request: codec.encode(InvocationRequestSchema, { vin: this._vin }),
            start: true,
            compartment_temperature_celsius: Number(temperature),
            front_left_seat: frontLeftSeat,
            front_right_seat: frontRightSeat,
            rear_left_seat: rearLeftSeat,
            rear_right_seat: rearRightSeat,
            steering_wheel: steeringWheel,
        });
        return this._invocationCall('ClimatizationStart', req, { debug });
    }

    async climateStop({ debug = false } = {}) {
        const req = codec.encode(ClimatizationStopRequestSchema, {
            request: codec.encode(InvocationRequestSchema, { vin: this._vin }),
        });
        return this._invocationCall('ClimatizationStop', req, { debug });
    }

    async windowsOpen({ debug = false } = {}) {
        const req = codec.encode(WindowControlRequestSchema, {
            request: codec.encode(InvocationRequestSchema, { vin: this._vin }),
            windows_control: WindowControlType.OPEN_ALL,
        });
        return this._invocationCall('WindowControl', req, { debug });
    }

    async windowsClose({ debug = false } = {}) {
        const req = codec.encode(WindowControlRequestSchema, {
            request: codec.encode(InvocationRequestSchema, { vin: this._vin }),
            windows_control: WindowControlType.CLOSE_ALL,
        });
        return this._invocationCall('WindowControl', req, { debug });
    }

    async getOtaSoftwareInfo({ debug = false } = {}) {
        const req = codec.encode(
            { vin: { num: 1, type: 'string' }, locale: { num: 2, type: 'string' } },
            { vin: this._vin, locale: 'en' },
        );
        const respBytes = await this._call(`${SVC_OTA_DISCOVERY}/GetSoftwareInfo`, req, { debug, streaming: true });
        const decoded = codec.decode(GetSoftwareInfoResponseSchema, respBytes);
        if (!decoded.info) return null;
        const info = decoded.info;
        info.state_label = SoftwareState[info.state] || null;
        info.update_available = OTA_AVAILABLE_STATES.has(info.state);
        return info;
    }

    async getLastKnownLocation({ debug = false } = {}) {
        // Location service uses VIN at field 1 (not VehicleRequest at field 1/2).
        const req = codec.encode({ vin: { num: 1, type: 'string' } }, { vin: this._vin });
        const respBytes = await this._call(`${SVC_LOCATION}/GetLastKnownLocation`, req, { debug });
        return this._parseLocationResponse(respBytes);
    }

    async getLastParkedLocation({ debug = false } = {}) {
        const req = codec.encode({ vin: { num: 1, type: 'string' } }, { vin: this._vin });
        const respBytes = await this._call(`${SVC_LOCATION}/GetLastParkedLocation`, req, { debug });
        return this._parseLocationResponse(respBytes);
    }

    /**
     * Location responses come in three shapes depending on backend version:
     *   A) outer[5] = nested-location-bytes          (most common on C3)
     *   B) outer[2] = nested-location-bytes
     *   C) outer[2]=longitude_float, outer[3]=latitude_float, outer[4]=timestamp
     * Inner "compact" layout: [1]=longitude, [2]=latitude, [3]=timestamp.
     */
    _parseLocationResponse(respBytes) {
        const raw = codec.decodeRaw(respBytes);
        // Variant A/B: nested compact location at field 5 or 2
        for (const key of ['field5(wt=2)', 'field2(wt=2)']) {
            const nested = raw[key];
            if (Buffer.isBuffer(nested)) {
                const parsed = this._parseCompactLocation(nested);
                if (parsed) return parsed;
            }
        }
        // Variant C: flat fields
        const lng = raw['field2(wt=5)'] ?? raw['field2(wt=1)'];
        const lat = raw['field3(wt=5)'] ?? raw['field3(wt=1)'];
        if (typeof lng === 'number' && typeof lat === 'number') {
            const ts = raw['field4(wt=0)'];
            return { longitude: lng, latitude: lat, timestamp: typeof ts === 'number' ? ts : null };
        }
        return null;
    }

    _parseCompactLocation(bytes) {
        const raw = codec.decodeRaw(bytes);
        const lng = raw['field1(wt=5)'] ?? raw['field1(wt=1)'];
        const lat = raw['field2(wt=5)'] ?? raw['field2(wt=1)'];
        if (typeof lng !== 'number' || typeof lat !== 'number') return null;
        let ts = null;
        const tsField = raw['field3(wt=2)'] ?? raw['field3(wt=0)'];
        if (Buffer.isBuffer(tsField)) {
            const tsRaw = codec.decodeRaw(tsField);
            const seconds = tsRaw['field1(wt=0)'];
            ts = typeof seconds === 'number' ? seconds : null;
        } else if (typeof tsField === 'number') {
            ts = tsField;
        }
        return { longitude: lng, latitude: lat, timestamp: ts };
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
