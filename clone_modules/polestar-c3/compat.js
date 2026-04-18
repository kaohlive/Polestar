'use strict';

/**
 * Drop-in replacement for the legacy clone_modules/polestar.js/polestar.js
 * client. Exposes the same method names and object shapes so drivers/vehicle
 * can swap the require with minimal diff, while sourcing data from the C3
 * gRPC backend.
 *
 *   getBattery()     → { batteryChargeLevelPercentage, chargingStatus,
 *                        estimatedChargingTimeToFullMinutes,
 *                        estimatedDistanceToEmptyKm/Miles,
 *                        chargingCurrentAmps, chargingPowerWatts,
 *                        chargingVoltageVolts, totalEnergyConsumedKwh,
 *                        chargingType, chargerConnectionStatus }
 *   getOdometer()    → { odometerMeters, tripMeterManualKm, tripMeterAutomaticKm }
 *   getHealthData()  → { serviceWarning, daysToService, distanceToServiceKm,
 *                        tyrePressures: { fl/fr/rl/rr }, anyTyreWarning,
 *                        lowVoltageBatteryWarning }
 */

const { PolestarC3 } = require('./client');
const { ChargingStatus } = require('./messages');

// Throttle — the C3 servers return the latest cached value; we don't want to
// hammer them with one call per field from device.js.
const CACHE_MS = 60_000;

function toNumber(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'bigint') return Number(v);
    return Number(v);
}

class PolestarCompat {
    constructor(email, password) {
        this._client = new PolestarC3(email, password);
        this._vehicles = null;
        this._batteryCache = { at: 0, data: null };
    }

    async login() {
        await this._client.login();
        this._vehicles = await this._client.listVehicles();
        return true;
    }

    async getVehicles() {
        if (!this._vehicles) this._vehicles = await this._client.listVehicles();
        // Preserve the old shape used by drivers/vehicle/driver.js:94 so pairing
        // keeps working: it reads .vin, .registrationNo, .content.model.name,
        // .modelYear, .internalVehicleIdentifier, .content.images.studio.url,
        // .deliveryDate, .hasPerformancePackage. The app-backend GraphQL query
        // in discovery.js only supplies a subset; the missing keys resolve to
        // undefined and the driver handles that (with `||` fallbacks).
        return this._vehicles;
    }

    async setVehicle(vin) {
        if (!this._vehicles) this._vehicles = await this._client.listVehicles();
        const match = vin
            ? this._vehicles.find((v) => v.vin === vin)
            : this._vehicles[0];
        if (!match) throw new Error('Vehicle not found');
        await this._client.setVehicle(match.vin);
        return {
            vin: match.vin,
            id: match.internalVehicleIdentifier,
        };
    }

    _mapChargingStatus(code) {
        const label = ChargingStatus[code] || 'UNSPECIFIED';
        return `CHARGING_STATUS_${label}`;
    }

    async _fetchBattery() {
        const now = Date.now();
        if (this._batteryCache.data && now - this._batteryCache.at < CACHE_MS) {
            return this._batteryCache.data;
        }
        const resp = await this._client.getLatestBattery();
        this._batteryCache = { at: now, data: resp };
        return resp;
    }

    async getBattery() {
        const resp = await this._fetchBattery();
        const b = resp.battery || {};
        const whTotal = toNumber(b.total_consumption_wh);
        return {
            batteryChargeLevelPercentage: toNumber(b.charge_level),
            chargingStatus: this._mapChargingStatus(b.charging_status),
            estimatedChargingTimeToFullMinutes: toNumber(b.time_to_full),
            estimatedDistanceToEmptyKm: toNumber(b.range_km),
            estimatedDistanceToEmptyMiles: toNumber(b.range_miles),
            chargingCurrentAmps: toNumber(b.current_amps),
            chargingPowerWatts: toNumber(b.power_watts),
            chargingVoltageVolts: toNumber(b.voltage_volts),
            totalEnergyConsumedKwh: whTotal / 1000,
            chargingTypeLabel: b.charging_type_label || null,
            chargerConnectionStatusLabel: b.charger_connection_status_label || null,
            chargerPowerStatus: toNumber(b.charger_power_status),
            timestamp: b.timestamp || null,
        };
    }

    async getOdometer() {
        const resp = await this._client.getLatestOdometer();
        const o = resp.odometer || {};
        return {
            odometerMeters: toNumber(o.odometer_meters),
            tripMeterManualKm: toNumber(o.trip_meter_manual_km),
            tripMeterAutomaticKm: toNumber(o.trip_meter_automatic_km),
        };
    }

    async getHealthData() {
        const resp = await this._client.getLatestHealth();
        const h = resp.health;
        if (!h) return null;

        const tyre = {
            frontLeftKpa: toNumber(h.front_left_tyre_pressure_kpa),
            frontRightKpa: toNumber(h.front_right_tyre_pressure_kpa),
            rearLeftKpa: toNumber(h.rear_left_tyre_pressure_kpa),
            rearRightKpa: toNumber(h.rear_right_tyre_pressure_kpa),
        };
        const tyreWarns = [
            h.front_left_tyre_pressure_warning,
            h.front_right_tyre_pressure_warning,
            h.rear_left_tyre_pressure_warning,
            h.rear_right_tyre_pressure_warning,
        ];
        const anyTyreWarning = tyreWarns.some((w) => w !== undefined && w !== 0 && w !== 1);

        return {
            serviceWarning: `SERVICE_WARNING_${h.service_warning_label || 'UNSPECIFIED'}`,
            daysToService: toNumber(h.days_to_service),
            distanceToServiceKm: toNumber(h.distance_to_service_km),
            tyrePressures: tyre,
            anyTyreWarning,
            lowVoltageBatteryWarningLevel: toNumber(h.low_voltage_battery_warning),
            timestamp: h.timestamp || null,
        };
    }

    async getExterior() {
        const resp = await this._client.getLatestExterior();
        const e = resp.exterior;
        if (!e) return null;
        const isOpen = (v) => v === 1 || v === 3; // OPEN or AJAR
        return {
            isLocked: e.central_lock_label === 'LOCKED',
            lockStatusLabel: e.central_lock_label,
            doors: {
                frontLeftOpen:  isOpen(e.door_front_left),
                frontRightOpen: isOpen(e.door_front_right),
                rearLeftOpen:   isOpen(e.door_rear_left),
                rearRightOpen:  isOpen(e.door_rear_right),
            },
            windows: {
                frontLeftOpen:  isOpen(e.window_front_left),
                frontRightOpen: isOpen(e.window_front_right),
                rearLeftOpen:   isOpen(e.window_rear_left),
                rearRightOpen:  isOpen(e.window_rear_right),
                anyOpen: [e.window_front_left, e.window_front_right, e.window_rear_left, e.window_rear_right].some(isOpen),
            },
            hoodOpen: isOpen(e.hood),
            tailgateOpen: isOpen(e.tailgate),
            tankLidOpen: isOpen(e.tank_lid),
            sunroofOpen: isOpen(e.sunroof),
            anyDoorOpen: [e.door_front_left, e.door_front_right, e.door_rear_left, e.door_rear_right].some(isOpen),
        };
    }

    async getClimate() {
        const resp = await this._client.getLatestClimate();
        const c = resp.climate;
        if (!c) return null;
        const active = c.running_status_label === 'ACTIVE';
        // Temperatures are raw ints; Polestar typically uses tenths-of-celsius,
        // but we don't divide here — device.js decides based on plausibility.
        return {
            isActive: active,
            runningStatusLabel: c.running_status_label,
            requestTypeLabel: c.request_type_label,
            timeRemainingMinutes: c.time_remaining || 0,
            ventilationOnly: !!c.ventilation_only,
            currentTempRaw: c.current_temp,
            requestedTempRaw: c.requested_temp,
        };
    }

    // --- Write commands (C3-only; legacy client does not implement these) ---

    chargeStart() { return this._client.chargeStart(); }
    chargeStop() { return this._client.chargeStop(); }
    getTargetSoc() { return this._client.getTargetSoc(); }
    setTargetSoc(level, settingType) { return this._client.setTargetSoc(level, settingType); }
    getAmpLimit() { return this._client.getAmpLimit(); }
    setAmpLimit(amperage) { return this._client.setAmpLimit(amperage); }

    getAccessToken() { return this._client._auth.accessToken; }
    getVehicleVin() { return this._client._vin; }
}

module.exports = PolestarCompat;
