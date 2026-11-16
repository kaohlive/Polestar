'use strict';

const { Device } = require('homey');
const LegacyPolestar = require('../../clone_modules/polestar.js');
const PolestarC3Compat = require('../../clone_modules/polestar-c3/compat');
const { transitionPreconditioningState } = require('../../clone_modules/polestar-c3/preconditioning');
const EvChargingState = require('../../lib/evChargingState')

const measureInterval = 60000;
const DATA_PORTAL_INTERVAL = 5 * 60 * 1000;
const RECONNECT_DELAYS = [2, 5, 15, 30].map((m) => m * 60 * 1000);
const SESSION_STORE_KEY = 'c3_session';

// Capabilities that only exist while "Enhanced Polestar EU experience" is on
// and this car's VIN is visible to the Data Portal credentials.
const DP_CAP = {
    avgConsumption: 'measure_polestarAvgConsumption',
    avgSpeed: 'measure_polestarAvgSpeed',
    tripManual: 'measure_polestarTripManual',
    tripAuto: 'measure_polestarTripAuto',
    carAlarm: 'alarm_generic.car_alarm',
    tailgateLock: 'measure_polestarTailgateLocked',
    brakeFluid: 'alarm_generic.brake_fluid',
    lightFailure: 'alarm_generic.light_failure',
    chargeTimerActive: 'measure_polestarChargeTimerActive',
    chargeTimer: 'measure_polestarChargeTimer',
    climateTimers: 'measure_polestarClimateTimers',
    climateStartReason: 'measure_polestarClimateStartReason',
    usageMode: 'measure_polestarUsageMode',
};
const DP_CAPS = Object.values(DP_CAP);

// Options for the system sub-capabilities. Applied by hand after addCapability,
// because capabilitiesOptions from driver.compose.json only reach new devices.
const DP_CAP_OPTIONS = {
    [DP_CAP.carAlarm]: { title: { en: 'Car alarm', nl: 'Autoalarm', de: 'Fahrzeugalarm', fr: 'Alarme du véhicule', it: 'Allarme auto', sv: 'Billarm', no: 'Billalarm', es: 'Alarma del coche', da: 'Bilalarm', ru: 'Автосигнализация', pl: 'Alarm samochodu', ko: '차량 경보', ja: '車両アラーム' } },
    [DP_CAP.brakeFluid]: { title: { en: 'Brake fluid warning', nl: 'Remvloeistofwaarschuwing', de: 'Bremsflüssigkeitswarnung', fr: 'Alerte liquide de frein', it: 'Avviso liquido freni', sv: 'Bromsvätskevarning', no: 'Bremsevæskevarsel', es: 'Aviso de líquido de frenos', da: 'Bremsevæskeadvarsel', ru: 'Предупреждение о тормозной жидкости', pl: 'Ostrzeżenie o płynie hamulcowym', ko: '브레이크액 경고', ja: 'ブレーキ液警告' } },
    [DP_CAP.lightFailure]: { title: { en: 'Light failure', nl: 'Lampstoring', de: 'Lampenausfall', fr: 'Défaut d\'éclairage', it: 'Guasto luci', sv: 'Lampfel', no: 'Lyspære-feil', es: 'Fallo de luces', da: 'Lygtefejl', ru: 'Неисправность фар', pl: 'Awaria oświetlenia', ko: '조명 고장', ja: 'ライト故障' } },
};

function titleCase(enumTail) {
    if (!enumTail) return null;
    return enumTail.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
const KM_TO_MILES = 0.621371;
const DEFAULT_HOME_RADIUS_M = 150;
const EARTH_RADIUS_M = 6371000;
const BATTERY_PRECONDITIONING_STATUS_CAPABILITY = 'measure_polestarBatteryPreconditioningStatus';

// Trigger-token text for each preconditioning state, kept word-for-word in step
// with the enum titles in the capability so a flow token and the device tile
// never disagree. The capability carries all 13 locales; these are the ones
// locales/ covers, and homey.__() falls back to `en` for the rest.
const BATTERY_PRECONDITIONING_LABELS = {
    in_progress: { en: 'In progress', nl: 'Bezig', no: 'Pågår', de: 'In Bearbeitung', da: 'I gang', sv: 'Pågår' },
    on:          { en: 'On', nl: 'Aan', no: 'På', de: 'Ein', da: 'Til', sv: 'På' },
    off:         { en: 'Off', nl: 'Uit', no: 'Av', de: 'Aus', da: 'Fra', sv: 'Av' },
    finished:    { en: 'Finished', nl: 'Voltooid', no: 'Fullført', de: 'Abgeschlossen', da: 'Afsluttet', sv: 'Slutförd' },
    optimal:     { en: 'Battery temperature optimal', nl: 'Batterijtemperatuur optimaal', no: 'Batteritemperaturen er optimal', de: 'Batterietemperatur optimal', da: 'Batteritemperaturen er optimal', sv: 'Batteritemperaturen är optimal' },
    planned:     { en: 'Planned', nl: 'Gepland', no: 'Planlagt', de: 'Geplant', da: 'Planlagt', sv: 'Planerad' },
    fault:       { en: 'Unavailable: fault', nl: 'Niet beschikbaar: storing', no: 'Ikke tilgjengelig: feil', de: 'Nicht verfügbar: Fehler', da: 'Ikke tilgængelig: fejl', sv: 'Inte tillgänglig: fel' },
    charging:    { en: 'Unavailable: charging', nl: 'Niet beschikbaar: laden', no: 'Ikke tilgjengelig: lading', de: 'Nicht verfügbar: Laden', da: 'Ikke tilgængelig: opladning', sv: 'Inte tillgänglig: laddning' },
    low_energy:  { en: 'Unavailable: low energy', nl: 'Niet beschikbaar: batterij bijna leeg', no: 'Ikke tilgjengelig: lavt energinivå', de: 'Nicht verfügbar: niedriger Ladestand', da: 'Ikke tilgængelig: lavt energiniveau', sv: 'Inte tillgänglig: låg energinivå' },
    unavailable: { en: 'Unavailable', nl: 'Niet beschikbaar', no: 'Ikke tilgjengelig', de: 'Nicht verfügbar', da: 'Ikke tilgængelig', sv: 'Inte tillgänglig' },
    unknown:     { en: 'Unknown', nl: 'Onbekend', no: 'Ukjent', de: 'Unbekannt', da: 'Ukendt', sv: 'Okänd' },
};

// Haversine great-circle distance in meters. Inlined so we don't pull in
// geolib just for one call. Accurate to sub-meter at driveway scale.
function haversineMeters(lat1, lng1, lat2, lng2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Map feature-key → { capabilities: [...] } for auto-remove on UNIMPLEMENTED.
const OPTIONAL_FEATURES = {
    amp_limit:  { capabilities: ['target_polestarAmpLimit'] },
    target_soc: { capabilities: ['target_polestarChargeLimit'] },
    windows:    { capabilities: ['button.windows_open', 'button.windows_close'] },
};

function selectClient(homey) {
    const legacy = homey.settings.get('c3_backend_disabled') === true;
    return legacy ? LegacyPolestar : PolestarC3Compat;
}

function isUnimplementedError(err) {
    if (!err || !err.message) return false;
    return /status=12\b|UNIMPLEMENTED|not supported/i.test(err.message);
}

/** Convert a raw gRPC error into a message Homey can surface usefully. */
function friendlyGrpcError(message, label) {
    if (!message) return `${label} failed`;
    const m = /status=(\d+)[^m]*message="([^"]*)"/.exec(message);
    if (!m) return message;
    const code = Number(m[1]);
    const detail = m[2];
    if (code === 12) return `${label}: not supported for this vehicle (${detail})`;
    if (code === 7)  return `${label}: permission denied (${detail || 'VIN not linked to this account'})`;
    if (code === 16) return `${label}: authentication expired — try again`;
    if (code === 14) return `${label}: service temporarily unavailable`;
    if (code === 4)  return `${label}: command timed out`;
    return `${label}: ${detail || 'error'} (code ${code})`;
}

var polestar = null;

class PolestarVehicle extends Device {

    /**
     * Check if the user has selected miles as the distance unit
     * @returns {boolean} true if miles, false if km (default)
     */
    usesMiles() {
        return this.homey.settings.get('distance_unit') === 'miles';
    }

    /**
     * Update capability units based on distance unit setting
     */
    async updateCapabilityUnits() {
        const unit = this.usesMiles() ? { en: 'mi' } : { en: 'km' };
        const speedUnit = this.usesMiles() ? { en: 'mph' } : { en: 'km/h' };
        const caps = [
            ['measure_vehicleOdometer', unit],
            ['measure_vehicleRange', unit],
            ['measure_vehicleDistanceTillService', unit],
            [DP_CAP.tripManual, unit],
            [DP_CAP.tripAuto, unit],
            [DP_CAP.avgSpeed, speedUnit],
        ];
        for (const [cap, units] of caps) {
            if (!this.hasCapability(cap)) continue;
            try {
                await this.setCapabilityOptions(cap, { units });
            } catch (err) {
                this.homey.app.log(`Failed to update units of ${cap}`, this.name, 'ERROR', err);
            }
        }
        this.homey.app.log(`Updated capability units to ${this.usesMiles() ? 'miles' : 'km'}`, this.name, 'DEBUG');
    }

    // ---- Session: stored refresh token first, password only when needed ----

    _loadSession() {
        const stored = this.getStoreValue(SESSION_STORE_KEY);
        if (!stored) return null;
        try {
            return JSON.parse(this.homey.app.decryptSecret(stored));
        } catch (err) {
            this.homey.app.log('Stored session cannot be read, a password login will follow', this.name, 'WARNING', err.message);
            return null;
        }
    }

    _saveSession(tokens) {
        // Refresh token only: the access token is renewed at every start anyway.
        const session = {
            refresh_token: tokens.refresh_token,
            refresh_rotated: tokens.refresh_rotated,
            refresh_expires_in: tokens.refresh_expires_in,
            obtained_at: tokens.obtained_at,
        };
        if (!session.refresh_token) return;
        this.setStoreValue(SESSION_STORE_KEY, this.homey.app.encryptSecret(JSON.stringify(session)))
            .catch((err) => this.homey.app.log('Could not persist session', this.name, 'ERROR', err));
    }

    async clearSession() {
        await this.setStoreValue(SESSION_STORE_KEY, null);
    }

    async _createClient() {
        const email = this.homey.app.getEmail();
        if (selectClient(this.homey) === LegacyPolestar) {
            // The legacy GraphQL backend keeps its own in-memory tokens and
            // needs the password up front.
            const password = await this.homey.app.getPassword();
            this.homey.app.logAuth('legacy_password_login', this.name, { reason: 'legacy backend always logs in with the password' });
            return new LegacyPolestar(email, password);
        }
        return new PolestarC3Compat(email, () => this.homey.app.getPassword(), {
            tokens: this._loadSession(),
            onTokens: (tokens) => this._saveSession(tokens),
            onEvent: (type, detail) => this.homey.app.logAuth(type, this.name, detail),
        });
    }

    async _connect() {
        const client = await this._createClient();
        await client.login();
        await client.setVehicle(this.getData().vin);
        if (this.polestar && this.polestar !== client && typeof this.polestar.close === 'function') {
            try { this.polestar.close(); } catch (_) {}
        }
        this.polestar = client;
    }

    /**
     * Rebuild the client after an error that says the session is gone. Uses
     * the stored refresh token first, so this rarely costs a password login.
     */
    async attemptReLogin() {
        if (this._reLoginInProgress) {
            this.homey.app.log('Re-login already in progress, skipping', this.name, 'DEBUG');
            return;
        }
        this._reLoginInProgress = true;
        try {
            await this._connect();
            this.homey.app.log('Re-login successful', this.name, 'DEBUG');
        } catch (err) {
            this.homey.app.log('Re-login failed', this.name, 'ERROR', err);
        } finally {
            this._reLoginInProgress = false;
        }
    }

    /** Called after a repair stored new credentials: start a fresh session. */
    async onCredentialsChanged() {
        await this.clearSession();
        this._reconnectAttempt = 0;
        try {
            await this._connect();
            await this.setAvailable();
            if (!this._running) await this._startRunning();
        } catch (err) {
            this.homey.app.log('Login after repair failed', this.name, 'ERROR', err);
        }
    }

    _scheduleReconnect() {
        if (this._destroyed) return;
        const attempt = this._reconnectAttempt || 0;
        const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
        this._reconnectAttempt = attempt + 1;
        this.homey.app.log(`Next login attempt in ${Math.round(delay / 60000)} min`, this.name, 'DEBUG');
        this._reconnectTimer = this.homey.setTimeout(async () => {
            this._reconnectTimer = null;
            if (this._destroyed || this._running) return;
            try {
                await this._connect();
                this._reconnectAttempt = 0;
                await this.setAvailable();
                await this._startRunning();
            } catch (err) {
                this.homey.app.log('Login attempt failed', this.name, 'ERROR', err);
                this._scheduleReconnect();
            }
        }, delay);
    }

    async onInit() {
        // Device has getName(), not a `name` property — without this every
        // log call passing this.name handed the logger undefined, so it fell
        // back to its 'Polestar App' default and those lines were attributed to
        // the app instead of the car. Set before the early returns below, or the
        // failure paths log under the wrong name too. Matches how the CSV driver
        // already does it.
        this.name = this.getName();

        try {
            await this._connect();
        } catch (err) {
            // Used to be a silent dead end until the next app restart. Now the
            // device says why and keeps retrying.
            this.homey.app.log('Could not login. Please check your credentials or try again later', this.name, 'ERROR', err);
            const needsRepair = /repair the device|No password stored|Invalid username or password/.test(err.message || '');
            await this.setUnavailable(needsRepair
                ? this.homey.__({ en: 'Login required — repair this device', nl: 'Opnieuw inloggen nodig — repareer dit apparaat', no: 'Innlogging kreves — reparer enheten' })
                : this.homey.__({ en: 'Cannot reach Polestar, retrying', nl: 'Polestar niet bereikbaar, nieuwe poging volgt', no: 'Får ikke kontakt med Polestar, prøver igjen' })
            ).catch(() => {});
            this._scheduleReconnect();
            return;
        }

        try {
            await this._startRunning();
        } catch (err) {
            this.homey.app.log('Device setup failed', this.name, 'ERROR', err);
        }
    }

    async _startRunning() {
        if (this._running) return;
        this._running = true;
        await this.fixCapabilities();
        await this.fixEnergy();
        await this.updateCapabilityUnits();
        this._registerWriteCapabilityListeners();
        this.update_loop_timers();
        this.refreshChargingTargets();  // best-effort initial read
        this._startDataPortal().catch((err) => this.homey.app.log('Data Portal start failed', this.name, 'ERROR', err));

        // Listen for distance unit setting changes
        this.homey.settings.on('set', async (key) => {
            if (key === 'distance_unit') {
                this.homey.app.log('Distance unit setting changed', 'PolestarVehicle', 'DEBUG');
                await this.updateCapabilityUnits();
                // Refresh values with new unit
                await this.updateVehicleState();
                await this.updateHealthState();
                await this._updateDataPortal();
                // Send specific event for widget to refresh
                this.homey.api.realtime('distanceUnitChanged');
            }
        });

        this.homey.app.log(this.homey.__({
          en: `${this.name} has been initialized`,
          no: `${this.name} har blitt initialisert`,
          nl: `${this.name} is geinitialiseerd`,
      }), this.name, 'DEBUG');
    }

    async update_loop_timers() {
        await this.updateVehicleState();
        this._timerTimers = this.homey.setInterval(async () => {
            await this.updateVehicleState();
        }, measureInterval);

        // Health, tyre pressures, current target SoC / amp limit: refresh every 15 min
        // so externally-made changes (e.g. via the Polestar mobile app) show up in Homey
        // within that window without hammering the backend.
        const slowInterval = 15 * 60 * 1000;
        await this._runSlowCycle();
        this._timerHealth = this.homey.setInterval(async () => {
            await this._runSlowCycle();
        }, slowInterval);
    }

    async _runSlowCycle() {
        await this.updateHealthState();
        await this.refreshAmpLimit();
        await this.updateLocationState();
        await this.updateOtaState();
    }

    async updateOtaState() {
        if (this._destroyed) return;
        if (!this.polestar || typeof this.polestar.getOtaStatus !== 'function') return;
        try {
            const ota = await this.polestar.getOtaStatus();
            if (!ota) return;
            await this._setBoolAndTrigger('alarm_polestarOtaAvailable', !!ota.updateAvailable, '_otaAvailableTrigger', '_otaInstalledTrigger');
            // "UNKNOWN" (state=0) really means "no pending update info returned" — show a
            // friendlier label so the tile doesn't imply the sensor is broken.
            const stateText = (!ota.state && !ota.newVersion) ? 'No pending update' : (ota.stateLabel || 'UNKNOWN');
            await this.setCapabilityValue('measure_polestarOtaState', stateText);
            await this.setCapabilityValue('measure_polestarOtaVersion', ota.newVersion || '');
        } catch (err) {
            if (err.message === 'Not logged in') { await this.attemptReLogin(); return; }
            if (isUnimplementedError(err)) return;
            this.homey.app.log('Failed to retrieve OTA state', this.name, 'DEBUG', err.message);
        }
    }

    async updateLocationState() {
        if (this._destroyed) return;
        if (!this.polestar || typeof this.polestar.getLocation !== 'function') return;
        this.homey.app.log('Retrieve vehicle location', this.name, 'DEBUG');
        try {
            const loc = await this.polestar.getLocation();
            if (!loc) {
                this.homey.app.log('Location: no data returned by backend (getLocation → null); capability left unchanged', this.name, 'DEBUG');
                return;
            }
            if (!Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
                this.homey.app.log('Location: got a response but coords are not finite; capability left unchanged', this.name, 'DEBUG', loc);
                return;
            }
            this._lastLocation = loc;
            const str = `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`;
            await this.setCapabilityValue('measure_polestarLocation', str);
            this.homey.app.log('Location:', this.name, 'DEBUG', str);
            await this._evaluateAtHome(loc);
        } catch (err) {
            if (err.message === 'Not logged in') { await this.attemptReLogin(); return; }
            if (isUnimplementedError(err)) {
                this.homey.app.log('Location: backend reports UNIMPLEMENTED — not supported on this vehicle', this.name, 'DEBUG');
                return;
            }
            this.homey.app.log('Failed to retrieve location', this.name, 'DEBUG', err.message);
        }
    }

    // Compare vehicle location to Homey's own location and toggle the
    // measure_polestarAtHome boolean. If Homey's geolocation isn't available
    // (permission missing / mode manual with no lat set) we skip silently
    // rather than pinning the tile to false.
    async _evaluateAtHome(loc) {
        if (this._destroyed) return;
        if (!this.hasCapability('measure_polestarAtHome')) return;
        let homeLat, homeLng;
        try {
            homeLat = this.homey.geolocation.getLatitude();
            homeLng = this.homey.geolocation.getLongitude();
        } catch (err) {
            this.homey.app.log('At-home: cannot read Homey geolocation', this.name, 'DEBUG', err.message);
            return;
        }
        if (!Number.isFinite(homeLat) || !Number.isFinite(homeLng) || (homeLat === 0 && homeLng === 0)) {
            this.homey.app.log('At-home: Homey has no usable geolocation, skipping', this.name, 'DEBUG');
            return;
        }
        const radius = Number(this.getSetting('home_radius_m')) || DEFAULT_HOME_RADIUS_M;
        const meters = haversineMeters(loc.latitude, loc.longitude, homeLat, homeLng);
        const atHome = meters <= radius;
        const prev = this.getCapabilityValue('measure_polestarAtHome');
        await this.setCapabilityValue('measure_polestarAtHome', atHome);
        if (prev !== atHome) {
            this.homey.app.log(`At-home: ${atHome ? 'arrived' : 'left'} (distance ${Math.round(meters)} m, radius ${radius} m)`, this.name, 'DEBUG');
            // Suppress the false→true fire on device boot when prev is null
            // (initial capability value before we ever set it). Real transitions
            // where prev is a boolean still fire.
            if (typeof prev === 'boolean') {
                const card = atHome
                    ? this.driver && this.driver._carCameHomeTrigger
                    : this.driver && this.driver._carLeftHomeTrigger;
                if (card) {
                    try {
                        await card.trigger(this, {}, {});
                    } catch (err) {
                        this.homey.app.log('At-home trigger failed', this.name, 'ERROR', err.message);
                    }
                }
            }
        }
    }

    /** Called by the get_location flow action; returns lat/lng tokens. */
    async getLocationForFlow() {
        await this.updateLocationState();
        const loc = this._lastLocation || {};
        return {
            latitude: Number.isFinite(loc.latitude) ? loc.latitude : 0,
            longitude: Number.isFinite(loc.longitude) ? loc.longitude : 0,
            location: this.getCapabilityValue('measure_polestarLocation') || '',
        };
    }

    async fixEnergy()
    {
        const currentEnergy = await this.getEnergy();
        //Check if this ev was created with the right energy object
        if(!currentEnergy?.electricCar)
        {
            await this.setEnergy({
                "electricCar": true
            })
        }
    }

    async fixCapabilities() {
        if (!this.hasCapability('measure_battery'))
            await this.addCapability('measure_battery');
        if (!this.hasCapability('ev_charging_state'))
            await this.addCapability('ev_charging_state');
        // measure_polestarBattery is deprecated — it duplicates measure_battery.
        // Deliberately not added to new devices, and deliberately not removed
        // from existing ones: removeCapability would drop their Insights history
        // and break any tile or widget already pointing at it.
        if(!this.hasCapability('measure_current'))
           await this.addCapability('measure_current');
        if(!this.hasCapability('measure_power'))
           await this.addCapability('measure_power');
        if(!this.hasCapability('meter_power'))
            await this.addCapability('meter_power');
        if (!this.hasCapability('measure_vehicleChargeTimeRemaining'))
            await this.addCapability('measure_vehicleChargeTimeRemaining');
        if (!this.hasCapability('measure_vehicleOdometer'))
            await this.addCapability('measure_vehicleOdometer');
        if (!this.hasCapability('measure_vehicleRange'))
            await this.addCapability('measure_vehicleRange');
        if (!this.hasCapability('measure_vehicleChargeState'))
            await this.addCapability('measure_vehicleChargeState');
        if (!this.hasCapability('measure_vehicleConnected'))
            await this.addCapability('measure_vehicleConnected');
        if (!this.hasCapability('alarm_generic'))
            await this.addCapability('alarm_generic');
        if (!this.hasCapability('measure_vehicleDaysTillService'))
            await this.addCapability('measure_vehicleDaysTillService');
        if (!this.hasCapability('measure_vehicleDistanceTillService'))
            await this.addCapability('measure_vehicleDistanceTillService');
        if (!this.hasCapability('measure_voltage'))
            await this.addCapability('measure_voltage');
        if (!this.hasCapability('measure_polestarChargingType'))
            await this.addCapability('measure_polestarChargingType');
        if (!this.hasCapability('measure_polestarDrivingKwh'))
            await this.addCapability('measure_polestarDrivingKwh');
        if (!this.hasCapability('measure_polestarSessionKwh'))
            await this.addCapability('measure_polestarSessionKwh');
        if (!this.hasCapability('alarm_polestarTyrePressure'))
            await this.addCapability('alarm_polestarTyrePressure');
        // Optional features — only add the slider if we haven't previously learned
        // this vehicle doesn't support the underlying service (e.g. Polestar 4 AMP_LIMIT).
        if (!this._isFeatureUnsupported('target_soc')) {
            if (!this.hasCapability('target_polestarChargeLimit'))
                await this.addCapability('target_polestarChargeLimit');
        } else if (this.hasCapability('target_polestarChargeLimit')) {
            try { await this.removeCapability('target_polestarChargeLimit'); } catch (_) {}
        }
        if (!this._isFeatureUnsupported('amp_limit')) {
            if (!this.hasCapability('target_polestarAmpLimit'))
                await this.addCapability('target_polestarAmpLimit');
        } else if (this.hasCapability('target_polestarAmpLimit')) {
            try { await this.removeCapability('target_polestarAmpLimit'); } catch (_) {}
        }
        if (!this.hasCapability('button.charge_start'))
            await this.addCapability('button.charge_start');
        if (!this.hasCapability('button.charge_stop'))
            await this.addCapability('button.charge_stop');
        if (!this.hasCapability('button.honk_flash'))
            await this.addCapability('button.honk_flash');
        if (!this.hasCapability('button.unlock_trunk'))
            await this.addCapability('button.unlock_trunk');
        // Windows are optional — skipped on vehicles that don't support remote
        // window control (e.g. Polestar 4 responds UNIMPLEMENTED). Users can
        // also toggle this off manually via the 'Windows remote control' device setting.
        if (!this._isFeatureUnsupported('windows')) {
            if (!this.hasCapability('button.windows_open'))  await this.addCapability('button.windows_open');
            if (!this.hasCapability('button.windows_close')) await this.addCapability('button.windows_close');
        } else {
            for (const c of ['button.windows_open', 'button.windows_close']) {
                if (this.hasCapability(c)) { try { await this.removeCapability(c); } catch (_) {} }
            }
        }

        // Exterior + climate states (read-only now, future-setable via capabilitiesOptions).
        for (const cap of [
            'locked',
            'onoff.climate',
            'target_temperature',
            'measure_temperature',
            'measure_polestarClimateRemaining',
            'alarm_contact.door_front_left',
            'alarm_contact.door_front_right',
            'alarm_contact.door_rear_left',
            'alarm_contact.door_rear_right',
            'alarm_contact.window_any',
            'alarm_contact.tailgate',
            'alarm_contact.hood',
            'alarm_contact.sunroof',
            'alarm_contact.tank_lid',
            'measure_polestarLocation',
            'measure_polestarAtHome',
            'alarm_polestarOtaAvailable',
            'measure_polestarOtaState',
            'measure_polestarOtaVersion',
        ]) {
            if (!this.hasCapability(cap)) await this.addCapability(cap);
        }

        for (const sub of ['front_left', 'front_right', 'rear_left', 'rear_right']) {
            const id = `measure_pressure.${sub}`;
            if (!this.hasCapability(id)) await this.addCapability(id);
        }
    }

    async updateHealthState(){
        if (this._destroyed) return;
        this.homey.app.log('Retrieve vehicle health', 'PolestarVehicle', 'DEBUG');
        try {
            var healthInfo = await this.polestar.getHealthData();
            this.homey.app.log('Health:', 'PolestarVehicle', 'DEBUG', healthInfo);
            if(healthInfo!=null)
            {
                this.setCapabilityValue('alarm_generic', healthInfo.serviceWarning!='SERVICE_WARNING_NO_WARNING');
                this.setCapabilityValue('measure_vehicleDaysTillService', healthInfo.daysToService);
                // Convert distance to service based on user preference
                let distanceToService = healthInfo.distanceToServiceKm;
                if (this.usesMiles() && distanceToService != null) {
                    distanceToService = Math.floor(distanceToService * KM_TO_MILES);
                } else if (distanceToService != null) {
                    distanceToService = Math.floor(distanceToService);
                }
                this.setCapabilityValue('measure_vehicleDistanceTillService', distanceToService);

                // C3-only fields — legacy GraphQL does not supply these, so guard each one.
                if (healthInfo.tyrePressures) {
                    const tp = healthInfo.tyrePressures;
                    if (Number.isFinite(tp.frontLeftKpa))  this.setCapabilityValue('measure_pressure.front_left',  tp.frontLeftKpa);
                    if (Number.isFinite(tp.frontRightKpa)) this.setCapabilityValue('measure_pressure.front_right', tp.frontRightKpa);
                    if (Number.isFinite(tp.rearLeftKpa))   this.setCapabilityValue('measure_pressure.rear_left',   tp.rearLeftKpa);
                    if (Number.isFinite(tp.rearRightKpa))  this.setCapabilityValue('measure_pressure.rear_right',  tp.rearRightKpa);
                }
                if (typeof healthInfo.anyTyreWarning === 'boolean') {
                    await this._setBoolAndTrigger('alarm_polestarTyrePressure', healthInfo.anyTyreWarning, '_tyreWarningRaisedTrigger', '_tyreWarningClearedTrigger');
                }
            } else {
                this.setCapabilityValue('alarm_generic', false);
            }
        } catch (err) {
            if (err.message === 'Not logged in') {
                this.homey.app.log('Session expired, attempting to re-login', 'PolestarVehicle', 'WARNING');
                await this.attemptReLogin();
            } else {
                this.homey.app.log('Failed to retrieve health state', 'PolestarVehicle', 'ERROR', err);
            }
        }
    }

    async updateVehicleState() {
        if (this._destroyed) return;
        this.homey.app.log('Retrieve device details', 'PolestarVehicle', 'DEBUG');
        try {
            var odometer = await this.polestar.getOdometer();
            this.homey.app.log('Odometers:', 'PolestarVehicle', 'DEBUG', odometer);
            var odo = odometer.odometerMeters;
            try {
                odo = odo / 1000; //Convert to KM instead of M
                if (this.usesMiles()) {
                    odo = Math.floor(odo * KM_TO_MILES); //Convert to miles
                } else {
                    odo = Math.floor(odo);
                }
            } catch {
                odo = null;
            }
            this.homey.app.log((this.usesMiles() ? 'Miles:' : 'KM:') + odo, 'PolestarVehicle', 'DEBUG');
            this.setCapabilityValue('measure_vehicleOdometer', odo);
        } catch (err) {
            if (err.message === 'Not logged in') {
                this.homey.app.log('Session expired, attempting to re-login', 'PolestarVehicle', 'WARNING');
                await this.attemptReLogin();
                return; // Exit early, next interval will retry
            }
            this.homey.app.log('Failed to retrieve odometer', 'PolestarVehicle', 'ERROR', err);
        };
        try {
            var batteryInfo = await this.polestar.getBattery();
            this.homey.app.log('Battery:', 'PolestarVehicle', 'DEBUG', batteryInfo);

            const batterySoc = Math.floor(batteryInfo.batteryChargeLevelPercentage);
            this.setCapabilityValue('measure_battery', batterySoc);
            // Deprecated duplicate — only present on devices paired before it was
            // retired, kept fed so their existing flows and tiles keep working.
            if (this.hasCapability('measure_polestarBattery'))
                this.setCapabilityValue('measure_polestarBattery', batterySoc);

            // Restored charging metrics — C3 fills these reliably; GraphQL used to leave them null.
            const amps = Number.isFinite(batteryInfo.chargingCurrentAmps) ? batteryInfo.chargingCurrentAmps : 0;
            const watts = Number.isFinite(batteryInfo.chargingPowerWatts) ? batteryInfo.chargingPowerWatts : 0;
            const volts = Number.isFinite(batteryInfo.chargingVoltageVolts) ? batteryInfo.chargingVoltageVolts : 0;
            this.setCapabilityValue('measure_current', amps);
            this.setCapabilityValue('measure_power', watts);
            this.setCapabilityValue('measure_voltage', volts);
            // Resolve the plug state once, here, and let everything below read it:
            // the energy accrual gate, measure_vehicleChargeState and
            // ev_charging_state all used to derive "is it charging?" separately,
            // which is how smart-charging sessions ended up accruing no energy.
            const isConnected = EvChargingState.resolveConnected(batteryInfo);
            const evChargingState = EvChargingState.resolveChargingState({
                chargingStatus: batteryInfo.chargingStatus,
                connected: isConnected,
            });
            const isCharging = evChargingState === EvChargingState.PLUGGED_IN_CHARGING;
            const hoursPerPoll = measureInterval / (1000 * 60 * 60);
            const deltaKwh = isCharging && watts > 0 ? (watts / 1000) * hoursPerPoll : 0;

            // meter_power — monotonic lifetime charging meter.
            // Never reset, never overwritten by C3 driving-consumption (different semantics).
            let meterPower = this.getCapabilityValue('meter_power');
            if (meterPower === null || meterPower === undefined) meterPower = 0;
            if (deltaKwh > 0) meterPower += deltaKwh;
            this.setCapabilityValue('meter_power', meterPower);

            // measure_polestarSessionKwh — resets on idle→charging transition, accumulates
            // while charging, holds the last session total while idle.
            const wasCharging = this._wasCharging === true;
            let sessionKwh = this.getCapabilityValue('measure_polestarSessionKwh');
            if (sessionKwh === null || sessionKwh === undefined) sessionKwh = 0;
            if (isCharging && !wasCharging) sessionKwh = 0; // new session starts
            if (deltaKwh > 0) sessionKwh += deltaKwh;
            this.setCapabilityValue('measure_polestarSessionKwh', sessionKwh);
            this._wasCharging = isCharging;

            // measure_polestarDrivingKwh — monotonic lifetime driving consumption from C3.
            // Guard against downward jumps (rare but cheap to ignore).
            if (Number.isFinite(batteryInfo.totalEnergyConsumedKwh) && batteryInfo.totalEnergyConsumedKwh > 0) {
                const prevDriving = this.getCapabilityValue('measure_polestarDrivingKwh') || 0;
                if (batteryInfo.totalEnergyConsumedKwh >= prevDriving) {
                    this.setCapabilityValue('measure_polestarDrivingKwh', batteryInfo.totalEnergyConsumedKwh);
                }
            }

            if (batteryInfo.chargingTypeLabel) {
                this.setCapabilityValue('measure_polestarChargingType', batteryInfo.chargingTypeLabel);
            }

            //Set the estimated range for the vehicle based on user preference
            let range;
            if (this.usesMiles() && batteryInfo.estimatedDistanceToEmptyMiles != null) {
                range = Math.floor(batteryInfo.estimatedDistanceToEmptyMiles);
            } else if (this.usesMiles()) {
                // Fallback: convert km to miles if miles not available from API
                range = Math.floor(batteryInfo.estimatedDistanceToEmptyKm * KM_TO_MILES);
            } else {
                range = Math.floor(batteryInfo.estimatedDistanceToEmptyKm);
            }
            this.setCapabilityValue('measure_vehicleRange', range);

            // Plug state was resolved above, alongside the energy accrual gate, so
            // these three can no longer contradict each other mid-poll.
            this.setCapabilityValue('measure_vehicleConnected', isConnected);
            this.setCapabilityValue('ev_charging_state', evChargingState);
            this.setCapabilityValue('measure_vehicleChargeState', isCharging);
            this.setCapabilityValue('measure_vehicleChargeTimeRemaining',
                isCharging ? batteryInfo.estimatedChargingTimeToFullMinutes : null);
            // TODO: Add capability to show charging error (CHARGING_STATUS_ERROR)

            // Last in the block on purpose. Preconditioning is a secondary
            // reading, and everything above is the core telemetry — running it
            // first meant a throw here cost the whole poll's SoC, range, power
            // and charging state.
            await this._updateBatteryPreconditioningState(batteryInfo);
        } catch (err) {
            if (err.message === 'Not logged in') {
                this.homey.app.log('Session expired, attempting to re-login', 'PolestarVehicle', 'WARNING');
                await this.attemptReLogin();
                return; // Exit early, next interval will retry
            }
            this.homey.app.log('Failed to retrieve batterystate', 'PolestarVehicle', 'ERROR', err);
        }

        // Also refresh the user-setable charge limit every tick. The Get call is a single
        // server-streaming frame (cheap) and catches changes the user makes in the Polestar
        // app / in-car menu within the 60 s window instead of the 15-min slow cycle.
        await this.refreshChargeLimit();
        await this.updateExteriorState();
        await this.updateClimateState();

        this.homey.api.realtime('updatevehicle');
    }

    // Writes a boolean capability and, on a real false→true / true→false
    // transition, fires the matching device-trigger flow card. Skips firing
    // when the previous value wasn't a boolean (device boot / first-ever
    // set), so users don't get a spurious "climate started" the moment the
    // app comes up. The trigger card refs are held on the driver instance
    // by _registerFlowCards().
    async _setBoolAndTrigger(capId, newValue, trueCardKey, falseCardKey) {
        const prev = this.getCapabilityValue(capId);
        await this.setCapabilityValue(capId, newValue);
        if (prev === newValue || typeof prev !== 'boolean') return;
        const card = newValue
            ? this.driver && this.driver[trueCardKey]
            : this.driver && this.driver[falseCardKey];
        if (!card) return;
        try {
            await card.trigger(this, {}, {});
        } catch (err) {
            this.homey.app.log(`Trigger ${newValue ? trueCardKey : falseCardKey} failed for ${capId}`, this.name, 'ERROR', err.message);
        }
    }

    async _updateBatteryPreconditioningState(batteryInfo) {
        const reported = batteryInfo.batteryPreconditioningReported === true;
        if (!reported) return;

        const key = batteryInfo.batteryPreconditioningStatusKey || 'unknown';
        const previous = this.hasCapability(BATTERY_PRECONDITIONING_STATUS_CAPABILITY)
            ? this.getCapabilityValue(BATTERY_PRECONDITIONING_STATUS_CAPABILITY)
            : null;
        const transition = transitionPreconditioningState(previous, key);

        // Add the status capability only after this vehicle has actually
        // reported C3 field 29. Flow-card filters then keep these cards hidden
        // for legacy-backend and unsupported vehicles. The enum key is the
        // persisted source of truth used by the condition card after restarts.
        try {
            if (!this.hasCapability(BATTERY_PRECONDITIONING_STATUS_CAPABILITY)) {
                await this.addCapability(BATTERY_PRECONDITIONING_STATUS_CAPABILITY);
            }
            await this.setCapabilityValue(BATTERY_PRECONDITIONING_STATUS_CAPABILITY, key);
        } catch (err) {
            this.homey.app.log('Failed to expose battery preconditioning status', this.name, 'WARNING', err);
            return;
        }

        if (!transition.changed) return;

        // getDeviceTriggerCard throws on an id the built app.json doesn't carry,
        // so it belongs inside the guard with the trigger itself — outside it, a
        // card-id slip would propagate into the battery poll's catch.
        try {
            const card = this.homey.flow.getDeviceTriggerCard('battery_preconditioning_changed');
            if (!card) return;
            const state = this.homey.__(BATTERY_PRECONDITIONING_LABELS[key] || BATTERY_PRECONDITIONING_LABELS.unknown);
            await card.trigger(this, { state }, {});
        } catch (err) {
            this.homey.app.log('Battery preconditioning state trigger failed', this.name, 'ERROR', err);
        }
    }

    // Writes an alarm_contact sub-cap and, on a false→true / true→false
    // transition, fires the matching contact_opened / contact_closed
    // device-trigger flow card. The trigger run-listener gates on the
    // user's selected sensor dropdown value.
    async _setContact(capId, newValue) {
        const prev = this.getCapabilityValue(capId);
        await this.setCapabilityValue(capId, newValue);
        if (prev === newValue) return;
        const card = newValue
            ? this.driver && this.driver._contactOpenedTrigger
            : this.driver && this.driver._contactClosedTrigger;
        if (!card) return;
        try {
            await card.trigger(this, {}, { sensor: capId });
        } catch (err) {
            this.homey.app.log(`Contact trigger failed for ${capId}`, this.name, 'ERROR', err);
        }
    }

    async updateExteriorState() {
        if (this._destroyed) return;
        if (!this.polestar || typeof this.polestar.getExterior !== 'function') return;
        try {
            const ext = await this.polestar.getExterior();
            if (!ext) return;
            this.homey.app.log('Exterior:', this.name, 'DEBUG', ext);

            if (typeof ext.isLocked === 'boolean') {
                await this.setCapabilityValue('locked', ext.isLocked);
            }
            await this._setContact('alarm_contact.door_front_left',  !!ext.doors.frontLeftOpen);
            await this._setContact('alarm_contact.door_front_right', !!ext.doors.frontRightOpen);
            await this._setContact('alarm_contact.door_rear_left',   !!ext.doors.rearLeftOpen);
            await this._setContact('alarm_contact.door_rear_right',  !!ext.doors.rearRightOpen);
            await this._setContact('alarm_contact.window_any', !!ext.windows.anyOpen);
            await this._setContact('alarm_contact.tailgate',   !!ext.tailgateOpen);
            await this._setContact('alarm_contact.hood',       !!ext.hoodOpen);
            await this._setContact('alarm_contact.sunroof',    !!ext.sunroofOpen);
            await this._setContact('alarm_contact.tank_lid',   !!ext.tankLidOpen);
        } catch (err) {
            if (err.message === 'Not logged in') {
                await this.attemptReLogin();
                return;
            }
            this.homey.app.log('Failed to retrieve exterior state', this.name, 'ERROR', err);
        }
    }

    async updateClimateState() {
        if (this._destroyed) return;
        if (!this.polestar || typeof this.polestar.getClimate !== 'function') return;
        try {
            const cl = await this.polestar.getClimate();
            if (!cl) return;
            this.homey.app.log('Climate:', this.name, 'DEBUG', cl);

            await this._setBoolAndTrigger('onoff.climate', !!cl.isActive, '_climateStartedTrigger', '_climateStoppedTrigger');
            // Polestar often encodes temps in tenths of °C. Heuristic: if the raw number
            // is clearly out of human range (<45 assumed to be whole °C, otherwise /10).
            const normalizeTemp = (raw) => {
                if (!Number.isFinite(raw) || raw <= 0) return null;
                return raw <= 45 ? raw : raw / 10;
            };
            const target = normalizeTemp(cl.requestedTempRaw);
            const current = normalizeTemp(cl.currentTempRaw);

            // Only the ACTIVE response includes requested_temp. When idle, the tile would
            // otherwise stay empty forever on a fresh device. Fall back to the configured
            // default so users always see their preferred target.
            if (target !== null) {
                await this.setCapabilityValue('target_temperature', target);
            } else if (this.getCapabilityValue('target_temperature') == null) {
                const defaultTemp = Number(this.getSetting('climate_default_temp'));
                if (Number.isFinite(defaultTemp) && defaultTemp >= 16 && defaultTemp <= 30) {
                    await this.setCapabilityValue('target_temperature', defaultTemp);
                }
            }
            if (current !== null) await this.setCapabilityValue('measure_temperature', current);

            // Climate remaining minutes: only meaningful while ACTIVE; show null otherwise so
            // the tile reads "—" rather than claiming 30 min forever when idle.
            if (cl.isActive && Number.isFinite(cl.timeRemainingMinutes) && cl.timeRemainingMinutes > 0) {
                await this.setCapabilityValue('measure_polestarClimateRemaining', cl.timeRemainingMinutes);
            } else {
                await this.setCapabilityValue('measure_polestarClimateRemaining', null);
            }
        } catch (err) {
            if (err.message === 'Not logged in') {
                await this.attemptReLogin();
                return;
            }
            if (isUnimplementedError(err)) {
                // Some models might not support parking climatization — silent handle.
                return;
            }
            this.homey.app.log('Failed to retrieve climate state', this.name, 'ERROR', err);
        }
    }

    /**
     * Master-switch check for write commands. Defaults to allowed; users can
     * flip the device setting off to kill-switch all write flows instantly.
     */
    _requireWritesEnabled() {
        const enabled = this.getSetting('writes_enabled');
        // Treat undefined (never set) as true to match default value in compose.
        if (enabled === false) {
            this.homey.app.log('Remote command blocked: writes_enabled is off', this.name, 'WARNING');
            throw new Error('Remote commands are disabled for this vehicle (see device settings)');
        }
    }

    /** Guard a write command: master-switch check + client check + error logging. */
    async _invokeWrite(label, fn) {
        this._requireWritesEnabled();
        if (!this.polestar) throw new Error('Polestar client not ready');
        if (this.homey.settings.get('c3_backend_disabled') === true) {
            throw new Error('C3 backend is disabled on this device — write commands unavailable');
        }
        try {
            const result = await fn();
            this.homey.app.log(`${label} OK`, this.name, 'DEBUG', result);
            return result;
        } catch (err) {
            if (err.message === 'Not logged in') {
                this.homey.app.log(`${label}: session expired, re-logging in`, this.name, 'WARNING');
                await this.attemptReLogin();
                const result = await fn();
                this.homey.app.log(`${label} OK (after re-login)`, this.name, 'DEBUG', result);
                return result;
            }
            this.homey.app.log(`${label} FAILED`, this.name, 'ERROR', err);
            // If the write revealed a feature isn't supported, clean up right away
            // so the user won't see a sad slider next run.
            if (isUnimplementedError(err)) {
                const l = label.toLowerCase();
                const featureKey =
                    /amplimit|amp_limit/.test(l) ? 'amp_limit' :
                    /targetsoc|chargelimit/.test(l) ? 'target_soc' :
                    /windows/.test(l) ? 'windows' :
                    null;
                if (featureKey) await this._markFeatureUnsupported(featureKey, err.message);
            }
            throw new Error(friendlyGrpcError(err.message, label));
        }
    }

    async chargeStart() {
        const r = await this._invokeWrite('chargeStart', () => this.polestar.chargeStart());
        this._scheduleStateRefresh(['vehicle']);
        return r;
    }
    async chargeStop() {
        const r = await this._invokeWrite('chargeStop', () => this.polestar.chargeStop());
        this._scheduleStateRefresh(['vehicle']);
        return r;
    }
    async lockCar() {
        const r = await this._invokeWrite('lock', () => this.polestar.lock());
        this._scheduleStateRefresh(['exterior']);
        return r;
    }
    async unlockCar() {
        const r = await this._invokeWrite('unlock', () => this.polestar.unlock());
        this._scheduleStateRefresh(['exterior']);
        return r;
    }
    async unlockTrunkAction() {
        const r = await this._invokeWrite('unlockTrunk', () => this.polestar.unlockTrunk());
        this._scheduleStateRefresh(['exterior']);
        return r;
    }
    honkFlashAction(args) {
        const actionMap = { flash: 2, honk: 1, both: 0 };
        const code = actionMap[args && args.action] !== undefined ? actionMap[args.action] : 2;
        return this._invokeWrite('honkFlash', () => this.polestar.honkFlash({ action: code }));
    }
    async climateStartAction(args) {
        const parse = (v) => {
            const n = Number(v);
            return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1;
        };
        const opts = {
            temperature: Number(args.temp),
            frontLeftSeat:  parse(args.seat_fl),
            frontRightSeat: parse(args.seat_fr),
            rearLeftSeat:   parse(args.seat_rl),
            rearRightSeat:  parse(args.seat_rr),
            steeringWheel:  parse(args.wheel),
        };
        const r = await this._invokeWrite('climateStart', () => this.polestar.climateStart(opts));
        this._scheduleStateRefresh(['climate']);
        return r;
    }
    /** Start climate using the defaults from device settings — mirrors the tile toggle. */
    async climateStartSimpleAction() {
        const opts = this._getClimateStartOptions();
        const r = await this._invokeWrite('climateStart', () => this.polestar.climateStart(opts));
        this._scheduleStateRefresh(['climate']);
        return r;
    }
    async climateStopAction() {
        const r = await this._invokeWrite('climateStop', () => this.polestar.climateStop());
        this._scheduleStateRefresh(['climate']);
        return r;
    }
    async windowsOpenAction() {
        const r = await this._invokeWrite('windowsOpen', () => this.polestar.windowsOpen());
        this._scheduleStateRefresh(['exterior'], { delays: [3000, 15000] });
        return r;
    }
    async windowsCloseAction() {
        const r = await this._invokeWrite('windowsClose', () => this.polestar.windowsClose());
        this._scheduleStateRefresh(['exterior'], { delays: [3000, 15000] });
        return r;
    }

    /** Called by the is_locked condition flow card. */
    isLocked() {
        return this.getCapabilityValue('locked') === true;
    }

    /**
     * Schedule one or more delayed refreshes so the UI catches up with a write
     * faster than the 60 s polling cycle. The first (~3 s) typically catches
     * immediate state sync; the second (~10 s) catches cases where the car
     * takes longer to propagate the new state back to C3.
     */
    _scheduleStateRefresh(kinds, { delays = [3000, 10000] } = {}) {
        for (const delay of delays) {
            this.homey.setTimeout(async () => {
                if (this._destroyed) return;
                try {
                    if (kinds.includes('climate'))  await this.updateClimateState();
                    if (kinds.includes('exterior')) await this.updateExteriorState();
                    if (kinds.includes('vehicle'))  await this.updateVehicleState();
                } catch (_) { /* already logged inside each update method */ }
            }, delay);
        }
    }
    _getTargetSocSettingType() {
        const raw = this.getSetting('target_soc_setting_type');
        const n = raw === undefined || raw === null ? 1 : Number(raw);
        return Number.isInteger(n) && n >= 0 && n <= 3 ? n : 1;
    }

    async setTargetSoc(args) {
        const level = Math.round(args.level);
        const slot = this._getTargetSocSettingType();
        const returned = await this._invokeWrite('setTargetSoc',
            () => this.polestar.setTargetSoc(level, slot));
        await this._applyTargetSocResult(level, returned);
    }
    async setAmpLimit(args) {
        const amps = Math.round(args.amperage);
        const returned = await this._invokeWrite('setAmpLimit', () => this.polestar.setAmpLimit(amps));
        await this._applyAmpLimitResult(amps, returned);
    }

    /**
     * Intentionally DON'T trust the Set response — on Polestar 4 the server
     * returns an echo of setting_type plus a stale copy of the previous level
     * (field 1 of the inner payload), not the newly committed level. Leave the
     * slider on what the user moved to and correct it 3 s later via a Get.
     * If the Get still disagrees, warn the user once to check their slot setting.
     */
    async _applyTargetSocResult(requested, _returnedIgnored) {
        this.homey.setTimeout(async () => {
            try {
                const actual = await this.polestar.getTargetSoc();
                if (!Number.isFinite(actual)) return;
                if (actual !== requested) {
                    await this.setCapabilityValue('target_polestarChargeLimit', actual);
                    this.homey.app.log(
                        `Charge limit did not change to ${requested}% (server reports ${actual}%). ` +
                        `Try switching 'Charge limit slot' in device settings.`,
                        this.name, 'WARNING');
                }
            } catch (err) { this.homey.app.log('post-write SoC re-read failed', this.name, 'DEBUG', err.message); }
        }, 3000);
    }

    async _applyAmpLimitResult(requested, _returnedIgnored) {
        this.homey.setTimeout(async () => {
            try {
                const actual = await this.polestar.getAmpLimit();
                if (!Number.isFinite(actual)) return;
                if (actual !== requested) {
                    await this.setCapabilityValue('target_polestarAmpLimit', actual);
                    this.homey.app.log(`Amp limit differs after write: requested ${requested}A, server reports ${actual}A`,
                        this.name, 'WARNING');
                }
            } catch (err) { this.homey.app.log('post-write amp limit re-read failed', this.name, 'DEBUG', err.message); }
        }, 3000);
    }

    /** Check if the backend has previously told us this feature isn't supported on this vehicle. */
    _isFeatureUnsupported(key) {
        const unsupported = this.getStoreValue('unsupportedFeatures') || {};
        return unsupported[key] === true;
    }

    /** Mark a feature as unsupported based on a gRPC UNIMPLEMENTED response,
     *  remove its capabilities, and log once. */
    async _markFeatureUnsupported(key, reason = '') {
        if (this._isFeatureUnsupported(key)) return; // already marked
        const spec = OPTIONAL_FEATURES[key];
        if (!spec) return;
        const unsupported = { ...(this.getStoreValue('unsupportedFeatures') || {}), [key]: true };
        await this.setStoreValue('unsupportedFeatures', unsupported);
        this.homey.app.log(`Feature '${key}' not supported on this vehicle — removing related capabilities. ${reason}`,
            this.name, 'WARNING');
        for (const cap of spec.capabilities) {
            if (this.hasCapability(cap)) {
                try { await this.removeCapability(cap); }
                catch (err) { this.homey.app.log(`Failed to remove ${cap}`, this.name, 'WARNING', err); }
            }
        }
    }

    /** Register tile/slider handlers for the setable write capabilities. */
    _registerWriteCapabilityListeners() {
        // registerCapabilityListener throws on a capability the device lacks
        // (e.g. the amp-limit slider removed on a Polestar 4), which used to
        // abort the rest of the device setup.
        // Safe to call again later: already-registered capabilities are skipped.
        this._registeredListeners = this._registeredListeners || new Set();
        const reg = (cap, fn) => {
            if (!this.hasCapability(cap) || this._registeredListeners.has(cap)) return;
            this.registerCapabilityListener(cap, fn);
            this._registeredListeners.add(cap);
        };
        reg('target_polestarChargeLimit', async (value) => {
            const level = Math.round(value);
            const slot = this._getTargetSocSettingType();
            const returned = await this._invokeWrite('target_polestarChargeLimit',
                () => this.polestar.setTargetSoc(level, slot));
            await this._applyTargetSocResult(level, returned);
        });
        reg('target_polestarAmpLimit', async (value) => {
            const amps = Math.round(value);
            const returned = await this._invokeWrite('target_polestarAmpLimit',
                () => this.polestar.setAmpLimit(amps));
            await this._applyAmpLimitResult(amps, returned);
        });
        reg('button.charge_start', async () => {
            await this._invokeWrite('button.charge_start', () => this.polestar.chargeStart());
        });
        reg('button.charge_stop', async () => {
            await this._invokeWrite('button.charge_stop', () => this.polestar.chargeStop());
        });

        reg('locked', async (value) => {
            const label = value ? 'lock' : 'unlock';
            await this._invokeWrite(label, () => value ? this.polestar.lock() : this.polestar.unlock());
            this._scheduleStateRefresh(['exterior']);
        });

        reg('button.honk_flash', async () => {
            await this._invokeWrite('button.honk_flash', () => this.polestar.honkFlash());
            // No state change — honk/flash is fire-and-forget.
        });

        reg('button.unlock_trunk', async () => {
            await this._invokeWrite('button.unlock_trunk', () => this.polestar.unlockTrunk());
            this._scheduleStateRefresh(['exterior']);
        });
        reg('button.windows_open', async () => {
            await this._invokeWrite('button.windows_open', () => this.polestar.windowsOpen());
            this._scheduleStateRefresh(['exterior'], { delays: [3000, 15000] });
        });
        reg('button.windows_close', async () => {
            await this._invokeWrite('button.windows_close', () => this.polestar.windowsClose());
            this._scheduleStateRefresh(['exterior'], { delays: [3000, 15000] });
        });

        reg('onoff.climate', async (value) => {
            if (value) {
                const opts = this._getClimateStartOptions();
                await this._invokeWrite('climateStart', () => this.polestar.climateStart(opts));
            } else {
                await this._invokeWrite('climateStop', () => this.polestar.climateStop());
            }
            // Climate status (including time_remaining) updates slower than the write ack;
            // refresh at 3 s for first sync and again at 10 s to catch the server settling.
            this._scheduleStateRefresh(['climate']);
        });

        reg('target_temperature', async (temperature) => {
            // Target temperature alone doesn't start climate — it just updates the stored
            // default so the next climateStart uses the new value. If climate is already
            // ACTIVE, the user can toggle onoff.climate to restart with the new target.
            await this.setSettings({ climate_default_temp: Number(temperature) });
        });
    }

    /** Read climate defaults from device settings and build the climateStart args. */
    _getClimateStartOptions() {
        const parseLevel = (raw) => {
            const n = Number(raw);
            return Number.isInteger(n) && n >= 1 && n <= 4 ? n : 1; // default OFF
        };
        const tileTarget = this.getCapabilityValue('target_temperature');
        const settingTemp = this.getSetting('climate_default_temp');
        const temperature = Number.isFinite(tileTarget) && tileTarget >= 16 && tileTarget <= 30
            ? tileTarget
            : (Number.isFinite(Number(settingTemp)) ? Number(settingTemp) : 21);
        return {
            temperature,
            frontLeftSeat:  parseLevel(this.getSetting('climate_seat_front_left')),
            frontRightSeat: parseLevel(this.getSetting('climate_seat_front_right')),
            rearLeftSeat:   parseLevel(this.getSetting('climate_seat_rear_left')),
            rearRightSeat:  parseLevel(this.getSetting('climate_seat_rear_right')),
            steeringWheel:  parseLevel(this.getSetting('climate_steering_wheel')),
        };
    }

    /**
     * Populate the read-side of the target_* capabilities. Called at init and
     * after any flow-card or tile change so the slider reflects reality.
     * Silently tolerates UNIMPLEMENTED (Polestar 4 amp limit case).
     */
    /** Fast-cycle refresh: charge limit only. User can change it several times a day
     *  (via Polestar app, in-car menu), so keep up with the 60 s cycle. */
    async refreshChargeLimit() {
        if (!this.polestar || typeof this.polestar.getTargetSoc !== 'function') return;
        if (this._isFeatureUnsupported('target_soc')) return;
        try {
            const soc = await this.polestar.getTargetSoc();
            if (Number.isFinite(soc) && soc >= 50 && soc <= 100) {
                await this.setCapabilityValue('target_polestarChargeLimit', soc);
            }
        } catch (err) {
            if (isUnimplementedError(err)) await this._markFeatureUnsupported('target_soc', err.message);
            else this.homey.app.log('refresh target SoC failed', this.name, 'DEBUG', err.message);
        }
    }

    /** Slow-cycle refresh: amp limit. Changes rarely (per charging location), so 15 min
     *  is plenty and saves a gRPC round-trip every minute. Skipped entirely on Polestar 4. */
    async refreshAmpLimit() {
        if (!this.polestar || typeof this.polestar.getAmpLimit !== 'function') return;
        if (this._isFeatureUnsupported('amp_limit')) return;
        try {
            const amps = await this.polestar.getAmpLimit();
            if (Number.isFinite(amps) && amps >= 6 && amps <= 32) {
                await this.setCapabilityValue('target_polestarAmpLimit', amps);
            }
        } catch (err) {
            if (isUnimplementedError(err)) await this._markFeatureUnsupported('amp_limit', err.message);
            else this.homey.app.log('refresh amp limit failed', this.name, 'DEBUG', err.message);
        }
    }

    /** Back-compat shim for callers that still invoke the old combined method. */
    async refreshChargingTargets() {
        await this.refreshChargeLimit();
        await this.refreshAmpLimit();
    }

    async getCurrentTargetSoc() {
        if (!this.polestar) return null;
        try { return await this.polestar.getTargetSoc(); }
        catch (err) {
            this.homey.app.log('getTargetSoc failed', this.name, 'ERROR', err);
            return null;
        }
    }

    async getCurrentAmpLimit() {
        if (!this.polestar) return null;
        try { return await this.polestar.getAmpLimit(); }
        catch (err) {
            this.homey.app.log('getAmpLimit failed', this.name, 'ERROR', err);
            return null;
        }
    }

    // ---- Enhanced Polestar EU experience (Data Portal) -----------------------

    /** Start or stop the Data Portal extras to match the app settings. */
    async _startDataPortal() {
        this._stopDataPortalTimer();
        const client = this.homey.app.getDataPortalClient();
        if (!client) {
            await this._removeDataPortalCaps();
            return;
        }
        const vin = this.getData().vin;
        let vins;
        try {
            vins = await client.getVehicles();
        } catch (err) {
            // Keep whatever caps the device has; try again on the next cycle.
            this.homey.app.log('Data Portal: vehicle list failed', this.name, 'ERROR', err.message);
            this._dataPortalTimer = this.homey.setTimeout(() => this._startDataPortal().catch(() => {}), DATA_PORTAL_INTERVAL);
            return;
        }
        if (!vins.includes(vin)) {
            this.homey.app.log('Data Portal: this vehicle is not linked to the portal credentials, extras stay off', this.name, 'WARNING');
            await this._removeDataPortalCaps();
            return;
        }
        await this._addDataPortalCaps();
        await this.updateCapabilityUnits();
        await this._updateDataPortal();
        this._dataPortalTimer = this.homey.setInterval(() => this._updateDataPortal(), DATA_PORTAL_INTERVAL);
    }

    async onDataPortalChanged() {
        if (!this._running) return;
        await this._startDataPortal();
    }

    _stopDataPortalTimer() {
        if (!this._dataPortalTimer) return;
        try { this.homey.clearInterval(this._dataPortalTimer); } catch (_) {}
        try { this.homey.clearTimeout(this._dataPortalTimer); } catch (_) {}
        this._dataPortalTimer = null;
    }

    async _addDataPortalCaps() {
        for (const cap of DP_CAPS) {
            if (this.hasCapability(cap)) continue;
            try {
                await this.addCapability(cap);
                if (DP_CAP_OPTIONS[cap]) await this.setCapabilityOptions(cap, DP_CAP_OPTIONS[cap]);
            } catch (err) {
                this.homey.app.log(`Data Portal: could not add ${cap}`, this.name, 'ERROR', err.message);
            }
        }
    }

    async _removeDataPortalCaps() {
        for (const cap of DP_CAPS) {
            if (!this.hasCapability(cap)) continue;
            try { await this.removeCapability(cap); }
            catch (err) { this.homey.app.log(`Data Portal: could not remove ${cap}`, this.name, 'WARNING', err.message); }
        }
    }

    async _updateDataPortal() {
        if (this._destroyed) return;
        if (this._dataPortalSkip > 0) { this._dataPortalSkip--; return; }
        const client = this.homey.app.getDataPortalClient();
        if (!client) return;
        let snap;
        try {
            snap = await client.getSnapshot(this.getData().vin);
        } catch (err) {
            if (err.status === 429) {
                this._dataPortalSkip = 2;
                this.homey.app.log('Data Portal: rate limited, skipping two rounds', this.name, 'WARNING');
            } else {
                this.homey.app.log('Data Portal: update failed', this.name, 'ERROR', err.message);
            }
            return;
        }
        this.homey.app.log('Data Portal:', this.name, 'DEBUG', snap);

        const miles = this.usesMiles();
        const dist = (km) => (km === null || km === undefined ? null : Math.round((miles ? km * KM_TO_MILES : km) * 10) / 10);
        const set = async (cap, value) => {
            if (value === undefined || !this.hasCapability(cap)) return;
            try { await this.setCapabilityValue(cap, value); }
            catch (err) { this.homey.app.log(`Data Portal: could not set ${cap}`, this.name, 'ERROR', err.message); }
        };

        if (snap.averageConsumptionKwh100km !== undefined) {
            await set(DP_CAP.avgConsumption, snap.averageConsumptionKwh100km === null ? null : Math.round(snap.averageConsumptionKwh100km * 10) / 10);
        }
        if (snap.averageSpeedKmh !== undefined) await set(DP_CAP.avgSpeed, dist(snap.averageSpeedKmh));
        if (snap.tripManualKm !== undefined) await set(DP_CAP.tripManual, dist(snap.tripManualKm));
        if (snap.tripAutomaticKm !== undefined) await set(DP_CAP.tripAuto, dist(snap.tripAutomaticKm));

        if (typeof snap.alarmTriggered === 'boolean') await set(DP_CAP.carAlarm, snap.alarmTriggered);
        if (typeof snap.tailgateLocked === 'boolean') await set(DP_CAP.tailgateLock, snap.tailgateLocked);
        if (typeof snap.brakeFluidWarning === 'boolean') await set(DP_CAP.brakeFluid, snap.brakeFluidWarning);
        if (typeof snap.lightWarning === 'boolean') {
            if (snap.lightWarning && !this.getCapabilityValue(DP_CAP.lightFailure)) {
                this.homey.app.log('Data Portal: light failure reported', this.name, 'WARNING', snap.lightWarningLamps);
            }
            await set(DP_CAP.lightFailure, snap.lightWarning);
        }

        if (typeof snap.chargeTimerActive === 'boolean') {
            if (this.hasCapability(DP_CAP.chargeTimerActive)) {
                await this._setBoolAndTrigger(DP_CAP.chargeTimerActive, snap.chargeTimerActive,
                    '_chargeTimerActivatedTrigger', '_chargeTimerDeactivatedTrigger');
            }
            await set(DP_CAP.chargeTimer, snap.chargeTimerActive ? (snap.chargeTimerWindow || 'On') : 'Off');
        }
        if (snap.climateTimerCount !== undefined) await set(DP_CAP.climateTimers, snap.climateTimerCount);
        if (snap.climateStartReason !== undefined) await set(DP_CAP.climateStartReason, titleCase(snap.climateStartReason) || '');
        if (snap.usageMode !== undefined) await set(DP_CAP.usageMode, titleCase(snap.usageMode) || '');
    }

    async onAdded() {
        this.homey.app.log('PolestarVehicle has been added', 'PolestarVehicle');
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.homey.app.log('PolestarVehicle settings changed', 'PolestarVehicle', 'DEBUG', changedKeys);

        if (changedKeys.includes('windows_supported')) {
            if (newSettings.windows_supported === false) {
                await this._markFeatureUnsupported('windows', 'disabled via device setting');
            } else {
                // Manually re-enable: clear store flag then re-add capabilities.
                const store = { ...(this.getStoreValue('unsupportedFeatures') || {}) };
                delete store.windows;
                await this.setStoreValue('unsupportedFeatures', store);
                await this.fixCapabilities();
                this._registerWriteCapabilityListeners();
                this.homey.app.log('Windows remote control re-enabled — caps restored', this.name, 'DEBUG');
            }
        }
    }

    async onRenamed(name) {
        // Keep the cached log name in step, otherwise every later line keeps
        // using the old one until the app restarts.
        this.name = name;
        this.homey.app.log('PolestarVehicle was renamed', this.name);
    }

    async onDeleted() {
        this.homey.app.log('PolestarVehicle has been deleted', 'PolestarVehicle');
        this._cleanup();
    }

    async onUninit() {
        this._cleanup();
    }

    /** Stop all timers and close the gRPC session so stale polls can't hit a
     *  device that's already been removed or is re-initialising. */
    _cleanup() {
        this._destroyed = true;
        if (this._timerTimers) { try { this.homey.clearInterval(this._timerTimers); } catch (_) {} this._timerTimers = null; }
        if (this._timerHealth) { try { this.homey.clearInterval(this._timerHealth); } catch (_) {} this._timerHealth = null; }
        if (this._reconnectTimer) { try { this.homey.clearTimeout(this._reconnectTimer); } catch (_) {} this._reconnectTimer = null; }
        this._stopDataPortalTimer();
        if (this.polestar && typeof this.polestar.close === 'function') {
            try { this.polestar.close(); } catch (_) {}
        }
    }

}

module.exports = PolestarVehicle;
