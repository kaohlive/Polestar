'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeSnapshot, DataPortalClient } = require('../lib/dataportal');

// Shapes as returned by the live Data Portal (Nov 2026), VIN and ids removed.
const RAW = {
    battery: { averageEnergyConsumptionKwhPer100KmAutomatic: 33.29999923706055, batteryChargeLevelPercentage: 58.9 },
    odometer: { odometerMeters: 20698000, tripMeterManualKm: 690.2999877929688, tripMeterAutomaticKm: 6.900000095367432, averageSpeedKmPerHourAutomatic: 23 },
    exterior: { centralLock: 'LOCK_STATUS_LOCKED', alarm: 'ALARM_STATUS_IDLE', tailgateLock: 'LOCK_STATUS_LOCKED' },
    health: {
        brakeFluidLevelWarning: 'BRAKE_FLUID_LEVEL_WARNING_NO_WARNING',
        lightWarnings: {
            turnIndicatorLeft: 'EXTERIOR_LIGHT_WARNING_NO_WARNING',
            highBeamAny: 'EXTERIOR_LIGHT_WARNING_UNSPECIFIED',
        },
    },
    availability: { availabilityStatus: 'AVAILABILITY_STATUS_AVAILABLE', usageMode: 'USAGE_MODE_INACTIVE' },
    climate: { runningStatus: 'RUNNING_STATUS_OFF', startReason: 'START_REASON_TIMER' },
    chargeTimer: { globalChargeTimer: { start: { timeZone: { offsetMinutes: 60 } }, stop: { timeZone: { offsetMinutes: 60 } }, activated: false } },
    climateTimer: { id: 'x' },
};

test('live response shapes normalize to the device fields', () => {
    const s = normalizeSnapshot(RAW);
    assert.equal(s.averageConsumptionKwh100km.toFixed(1), '33.3');
    assert.equal(s.tripManualKm.toFixed(1), '690.3');
    assert.equal(s.averageSpeedKmh, 23);
    assert.equal(s.alarmStatus, 'IDLE');
    assert.equal(s.alarmTriggered, false);
    assert.equal(s.tailgateLocked, true);
    assert.equal(s.brakeFluidWarning, false);
    assert.equal(s.lightWarning, false, 'UNSPECIFIED is not a failure');
    assert.equal(s.usageMode, 'INACTIVE');
    assert.equal(s.climateStartReason, 'TIMER');
    assert.equal(s.chargeTimerActive, false);
    assert.equal(s.chargeTimerWindow, null);
    assert.equal(s.climateTimerCount, 0);
});

test('warnings, a triggered alarm and an active timer are picked up', () => {
    const s = normalizeSnapshot({
        exterior: { alarm: 'ALARM_STATUS_TRIGGERED', tailgateLock: 'LOCK_STATUS_UNLOCKED' },
        health: { brakeFluidLevelWarning: 'BRAKE_FLUID_LEVEL_WARNING_TOO_LOW', lightWarnings: { brakeLightAny: 'EXTERIOR_LIGHT_WARNING_FAILURE' } },
        chargeTimer: { globalChargeTimer: { activated: true, start: { hour: 22, minute: 5 }, stop: { hours: 6, minutes: 0 } } },
    });
    assert.equal(s.alarmTriggered, true);
    assert.equal(s.tailgateLocked, false);
    assert.equal(s.brakeFluidWarning, true);
    assert.equal(s.lightWarning, true);
    assert.deepEqual(s.lightWarningLamps, ['brakeLightAny']);
    assert.equal(s.chargeTimerActive, true);
    assert.equal(s.chargeTimerWindow, '22:05–06:00');
});

test('a domain without data leaves its fields out', () => {
    const s = normalizeSnapshot({ odometer: null, health: null });
    assert.equal('tripManualKm' in s, false);
    assert.equal('brakeFluidWarning' in s, false);
});

test('the client needs all three credentials', () => {
    assert.throws(() => new DataPortalClient({ clientId: 'a', clientSecret: 'b' }), /required/);
});
