'use strict';

/**
 * Client for the official Polestar Data Portal M2M API (EU Data Act).
 * Read-only. Credentials are created by the user at data-portal.polestar.com
 * (API credentials): client ID + client secret, and an account ID that is sent
 * as the x-client-id header (shown on the portal's API docs page).
 *
 * Endpoints verified against a live account (Nov 2026):
 *   POST /token                                     → { accessToken, expiresIn, tokenType }
 *   GET  /v1/vehicles                               → { data: [vin] }
 *   GET  /v1/vehicles/{vin}/telemetry/{domain}      battery, odometer, location, exterior,
 *                                                   health, availability, parking-climatization
 *   GET  /v1/vehicles/{vin}/charging/{domain}       target-soc, global-charge-timer,
 *                                                   parking-climate-timer
 * A 404 with code DATA_NOT_AVAILABLE means "this car reports nothing for that domain".
 */

const axios = require('axios');

const BASE_URL = 'https://pc-api.polestar.com/eu-north-1/data-portal/m2m';

class DataPortalError extends Error {
    constructor(message, { status = null, code = null } = {}) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

class DataPortalClient {
    constructor({ clientId, clientSecret, accountId }) {
        if (!clientId || !clientSecret || !accountId) {
            throw new DataPortalError('Client ID, client secret and account ID are all required', { code: 'MISSING_CREDENTIALS' });
        }
        this._clientId = clientId;
        this._clientSecret = clientSecret;
        this._accountId = accountId;
        this._token = null;
        this._tokenExpiresAt = 0;
        this.scopes = [];
    }

    async _getToken() {
        if (this._token && Date.now() < this._tokenExpiresAt - 60_000) return this._token;
        const r = await axios.post(`${BASE_URL}/token`,
            { clientId: this._clientId, clientSecret: this._clientSecret },
            { headers: { 'content-type': 'application/json' }, timeout: 30000, validateStatus: () => true });
        if (r.status !== 200 || !r.data || !r.data.accessToken) {
            throw new DataPortalError(`Token request failed (${r.status}) — check client ID and secret`,
                { status: r.status, code: 'TOKEN_FAILED' });
        }
        this._token = r.data.accessToken;
        this._tokenExpiresAt = Date.now() + (Number(r.data.expiresIn) || 3600) * 1000;
        this.scopes = scopesFromJwt(this._token);
        return this._token;
    }

    async _get(path) {
        const token = await this._getToken();
        const r = await axios.get(BASE_URL + path, {
            headers: { authorization: `Bearer ${token}`, 'x-client-id': this._accountId, accept: 'application/json' },
            timeout: 30000,
            validateStatus: () => true,
        });
        if (r.status === 200) return r.data && r.data.data !== undefined ? r.data.data : r.data;
        const err = (r.data && r.data.error) || {};
        if (r.status === 404 && err.code === 'DATA_NOT_AVAILABLE') return null;
        if (r.status === 401) this._token = null;
        const hint = err.code === 'AUTHZ_CLIENT_ID_MISMATCH' ? ' — the account ID does not belong to these credentials' : '';
        throw new DataPortalError(`${path}: ${r.status} ${err.code || ''}${hint}`.trim(), { status: r.status, code: err.code || null });
    }

    async getVehicles() {
        const data = await this._get('/v1/vehicles');
        return Array.isArray(data) ? data : [];
    }

    async getDomain(vin, kind, domain) {
        return this._get(`/v1/vehicles/${encodeURIComponent(vin)}/${kind}/${domain}`);
    }

    /** Fetch everything the Homey device uses, one domain at a time.
     *  A failing domain is reported in `errors` and does not sink the others. */
    async getSnapshot(vin) {
        const wanted = [
            ['battery', 'telemetry', 'battery'],
            ['odometer', 'telemetry', 'odometer'],
            ['exterior', 'telemetry', 'exterior'],
            ['health', 'telemetry', 'health'],
            ['availability', 'telemetry', 'availability'],
            ['climate', 'telemetry', 'parking-climatization'],
            ['chargeTimer', 'charging', 'global-charge-timer'],
            ['climateTimer', 'charging', 'parking-climate-timer'],
        ];
        const raw = {};
        const errors = {};
        for (const [key, kind, domain] of wanted) {
            try {
                raw[key] = await this.getDomain(vin, kind, domain);
            } catch (err) {
                if (err.status === 429) throw err; // rate limited: stop this round entirely
                errors[key] = err.message;
                raw[key] = null;
            }
        }
        return { ...normalizeSnapshot(raw), errors };
    }
}

function scopesFromJwt(token) {
    try {
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        return typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [];
    } catch (_) {
        return [];
    }
}

/** Strip a protobuf-style enum prefix: "USAGE_MODE_INACTIVE" → "INACTIVE". */
function enumTail(value, prefix) {
    if (typeof value !== 'string' || !value) return null;
    return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function finite(n) {
    const v = Number(n);
    return Number.isFinite(v) ? v : null;
}

function pad2(n) { return String(n).padStart(2, '0'); }

/** "HH:MM" from a timer endpoint; tolerant of {hour,minute} and {hours,minutes}. */
function clock(point) {
    if (!point || typeof point !== 'object') return null;
    const h = point.hour !== undefined ? point.hour : point.hours;
    const m = point.minute !== undefined ? point.minute : point.minutes;
    if (!Number.isFinite(Number(h))) return null;
    return `${pad2(Number(h))}:${pad2(Number(m) || 0)}`;
}

function warningActive(value, prefix) {
    const tail = enumTail(value, prefix);
    return !!tail && tail !== 'NO_WARNING' && tail !== 'UNSPECIFIED';
}

function normalizeSnapshot(raw) {
    const out = {};

    const o = raw.odometer;
    if (o) {
        out.tripManualKm = finite(o.tripMeterManualKm);
        out.tripAutomaticKm = finite(o.tripMeterAutomaticKm);
        out.averageSpeedKmh = finite(o.averageSpeedKmPerHourAutomatic);
    }

    const e = raw.exterior;
    if (e) {
        const alarm = enumTail(e.alarm, 'ALARM_STATUS_');
        out.alarmStatus = alarm;
        // Only IDLE and UNSPECIFIED are known-quiet; anything else (TRIGGERED, …) counts as going off.
        out.alarmTriggered = alarm ? !['IDLE', 'UNSPECIFIED', 'OFF', 'DISARMED', 'ARMED'].includes(alarm) : null;
        const tl = enumTail(e.tailgateLock, 'LOCK_STATUS_');
        out.tailgateLocked = tl === 'LOCKED' ? true : tl === 'UNLOCKED' ? false : null;
    }

    const h = raw.health;
    if (h) {
        out.brakeFluidWarning = h.brakeFluidLevelWarning !== undefined
            ? warningActive(h.brakeFluidLevelWarning, 'BRAKE_FLUID_LEVEL_WARNING_') : null;
        if (h.lightWarnings && typeof h.lightWarnings === 'object') {
            const failing = Object.entries(h.lightWarnings)
                .filter(([, v]) => warningActive(v, 'EXTERIOR_LIGHT_WARNING_'))
                .map(([k]) => k);
            out.lightWarning = failing.length > 0;
            out.lightWarningLamps = failing;
        }
    }

    const a = raw.availability;
    if (a) {
        out.usageMode = enumTail(a.usageMode, 'USAGE_MODE_');
        out.availability = enumTail(a.availabilityStatus, 'AVAILABILITY_STATUS_');
    }

    const c = raw.climate;
    if (c) {
        out.climateStartReason = enumTail(c.startReason, 'START_REASON_');
    }

    // Everything else in the battery domain already comes from the C3 route;
    // only the average consumption is new.
    if (raw.battery) out.averageConsumptionKwh100km = finite(raw.battery.averageEnergyConsumptionKwhPer100KmAutomatic);

    const t = raw.chargeTimer && raw.chargeTimer.globalChargeTimer;
    if (raw.chargeTimer) {
        out.chargeTimerActive = !!(t && t.activated);
        const start = t && clock(t.start);
        const stop = t && clock(t.stop);
        out.chargeTimerWindow = start && stop ? `${start}–${stop}` : null;
    }

    if (raw.climateTimer) {
        // Shape unverified: on the test car this domain only carried an id.
        // Count whatever timer list it exposes; zero when there is none.
        const ct = raw.climateTimer;
        const list = Array.isArray(ct.timers) ? ct.timers
            : Array.isArray(ct.parkingClimateTimers) ? ct.parkingClimateTimers
            : ct.parkingClimateTimer && Array.isArray(ct.parkingClimateTimer.timers) ? ct.parkingClimateTimer.timers
            : [];
        out.climateTimerCount = list.filter((x) => x && (x.activated || x.enabled || x.active)).length;
    }

    return out;
}

module.exports = { DataPortalClient, DataPortalError, normalizeSnapshot, BASE_URL };
